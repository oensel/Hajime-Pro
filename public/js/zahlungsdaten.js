// Zahlungsdaten eines Vereins: Konto, Lastschrift (Gläubiger-ID, Mandatstext). Die Angaben auf den Rechnungen stehen auf rechnungen.html;
// nur im Popup des Turnierformulars (?eingebettet=1) erscheinen sie hier zusätzlich (public/js/rechnungsAngaben.js) und werden zusammen
// gespeichert. Server-Texte kommen nur über value/textContent in die Seite.
(function () {
    const $ = (id) => document.getElementById(id);
    const params = new URLSearchParams(window.location.search);
    const vereinId = params.get('vereinId');
    const eingebettet = params.get('eingebettet') === '1';
    const api = `/api/abrechnung/stammdaten/${encodeURIComponent(vereinId || '')}`;
    let ibanLoeschen = false;
    let absenderName = ''; // für die Vorschau des Mandatstexts (die Seite selbst hat kein Feld dafür, im Popup schon)
    const angaben = eingebettet ? window.RechnungsAngaben.baue($('abrAngaben')) : null;

    const meldeFehler = (text) => { $('abrFehler').textContent = text || ''; };
    const meldung = (text, typ) => { if (window.zeigeNotification) window.zeigeNotification(text, typ); };

    if (!eingebettet) $('abrRechnungenLink').href = `/rechnungen.html?vereinId=${encodeURIComponent(vereinId || '')}`;

    function zeigeIban(stammdaten) {
        const vorhanden = !!(stammdaten && stammdaten.iban_vorhanden);
        ibanLoeschen = false;
        const feld = $('abrIban');
        feld.value = '';
        feld.placeholder = vorhanden ? (stammdaten.iban_maske || 'IBAN hinterlegt') : 'z.B. DE12345678901234567890';
        $('abrIbanEntfernen').hidden = !vorhanden;
        $('abrIbanHilfe').textContent = vorhanden
            ? 'Die IBAN ist hinterlegt und wird nicht angezeigt. Zum Ändern eine neue IBAN eintragen, sonst das Feld leer lassen.'
            : 'Noch keine IBAN hinterlegt.';
    }

    // Vorschau mit Platzhaltern; der Text kommt aus demselben Modul wie auf dem Server (src/shared/mandatText.js).
    let mandatText = null;
    function zeigeMandatVorschau() {
        if (!mandatText) return;
        const absender = (angaben ? angaben.werte().absender_name : absenderName).trim();
        $('abrMandatVorschau').textContent = mandatText.baueMandatstext({
            glaeubigerName: absender || $('abrKontoinhaber').value.trim() || '(Name des Ausrichters)',
            glaeubigerId: $('abrGlaeubigerId').value.trim() || '(Gläubiger-ID)',
            mandatsreferenz: '(wird bei Erteilung vergeben)',
            vorabTage: 5,
            turnierBezeichnung: '(Turnier)',
            zahlenderVerein: '(zahlender Verein)',
            zusatztext: $('abrMandatZusatz').value
        });
    }
    import('/js/shared/mandatText.js').then((modul) => { mandatText = modul; zeigeMandatVorschau(); }).catch(() => { /* Vorschau ist optional */ });
    for (const id of ['abrMandatZusatz', 'abrKontoinhaber', 'abrGlaeubigerId']) $(id).addEventListener('input', zeigeMandatVorschau);
    if (angaben) angaben.beiAbsender(zeigeMandatVorschau);

    function fuelle(stammdaten) {
        const s = stammdaten || {};
        absenderName = s.absender_name || '';
        if (angaben) angaben.fuelle(s);
        $('abrKontoinhaber').value = s.kontoinhaber || '';
        $('abrGlaeubigerId').value = s.glaeubiger_id || '';
        $('abrMandatZusatz').value = s.mandat_zusatztext || '';
        zeigeMandatVorschau();
        zeigeIban(s);
    }

    async function lade() {
        if (!/^\d+$/.test(String(vereinId || ''))) {
            meldeFehler('Es wurde kein Verein angegeben.');
            return;
        }
        try {
            const resp = await fetch(api);
            const daten = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                meldeFehler(daten.error || 'Die Zahlungsdaten konnten nicht geladen werden.');
                return;
            }
            fuelle(daten.stammdaten);
            $('abrForm').hidden = false;
        } catch {
            meldeFehler('Die Zahlungsdaten konnten nicht geladen werden.');
        }
        try {
            const resp = await fetch('/api/auth/me');
            const me = resp.ok ? (await resp.json()).user : null;
            const treffer = me && Array.isArray(me.vereine) ? me.vereine.find((v) => String(v.verein_id) === String(vereinId)) : null;
            if (treffer) $('abrVerein').textContent = treffer.name;
        } catch { /* der Name ist nur Zierde */ }
    }

    $('abrIbanEntfernen').addEventListener('click', async () => {
        if (typeof window.zeigeZentraleBestaetigung === 'function') {
            const ok = await window.zeigeZentraleBestaetigung('Die hinterlegte IBAN wirklich entfernen?', 'IBAN entfernen', 'warning');
            if (!ok) return;
        }
        ibanLoeschen = true;
        $('abrIban').value = '';
        $('abrIban').placeholder = 'IBAN wird beim Speichern entfernt';
        $('abrIbanEntfernen').hidden = true;
        $('abrIbanHilfe').textContent = 'Die IBAN wird beim Speichern entfernt.';
    });

    if (eingebettet) {
        const zurueck = $('abrZurueck');
        zurueck.textContent = 'Abbrechen';
        zurueck.removeAttribute('href');
        zurueck.style.cursor = 'pointer';
        zurueck.addEventListener('click', () => window.parent.postMessage({ typ: 'zahlungsdaten-schliessen' }, window.location.origin));
    }

    $('abrForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        meldeFehler('');
        const body = {
            ...(angaben ? angaben.werte() : {}),
            kontoinhaber: $('abrKontoinhaber').value,
            glaeubiger_id: $('abrGlaeubigerId').value,
            mandat_zusatztext: $('abrMandatZusatz').value
        };
        if (ibanLoeschen) body.iban_loeschen = true;
        else if ($('abrIban').value.trim()) body.iban = $('abrIban').value;
        try {
            const resp = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const daten = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                meldeFehler(daten.error || 'Speichern fehlgeschlagen.');
                return;
            }
            fuelle(daten.stammdaten);
            if (eingebettet) {
                window.parent.postMessage({ typ: 'zahlungsdaten-gespeichert' }, window.location.origin);
                return;
            }
            meldung('Zahlungsdaten gespeichert.', 'success');
        } catch {
            meldeFehler('Speichern fehlgeschlagen.');
        }
    });

    lade();
})();
