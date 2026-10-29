// Abrechnungsdaten eines Vereins (Startgeld-Rechnungen, Stufe 2). Server-Texte kommen nur über value/textContent in die Seite.
(function () {
    const $ = (id) => document.getElementById(id);
    const vereinId = new URLSearchParams(window.location.search).get('vereinId');
    const api = `/api/abrechnung/stammdaten/${encodeURIComponent(vereinId || '')}`;
    let ibanLoeschen = false;
    let naechsteNummer = 1;
    const eingebettet = new URLSearchParams(window.location.search).get('eingebettet') === '1';
    // Vorschlag für den Umsatzsteuer-Hinweis: gemeinnützige Sportvereine (§ 4 Nr. 22 Buchst. b UStG). Nur bei leerem gespeichertem Feld.
    const UST_VORSCHLAG = 'Steuerfrei nach § 4 Nr. 22 Buchst. b UStG.';

    const meldeFehler = (text) => { $('abrFehler').textContent = text || ''; };
    const meldung = (text, typ) => { if (window.zeigeNotification) window.zeigeNotification(text, typ); };

    function zeigeNaechsteNummer() {
        const praefix = $('abrPraefix').value.trim();
        $('abrNaechste').textContent = praefix ? `${praefix}${String(naechsteNummer).padStart(5, '0')}` : '-';
    }

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
        $('abrMandatVorschau').textContent = mandatText.baueMandatstext({
            glaeubigerName: $('abrAbsender').value.trim() || $('abrKontoinhaber').value.trim() || '(Name des Ausrichters)',
            glaeubigerId: $('abrGlaeubigerId').value.trim() || '(Gläubiger-ID)',
            mandatsreferenz: '(wird bei Erteilung vergeben)',
            vorabTage: 5,
            turnierBezeichnung: '(Turnier)',
            zahlenderVerein: '(zahlender Verein)',
            zusatztext: $('abrMandatZusatz').value
        });
    }
    import('/js/shared/mandatText.js').then((modul) => { mandatText = modul; zeigeMandatVorschau(); }).catch(() => { /* Vorschau ist optional */ });
    for (const id of ['abrMandatZusatz', 'abrAbsender', 'abrKontoinhaber', 'abrGlaeubigerId']) $(id).addEventListener('input', zeigeMandatVorschau);

    function fuelle(stammdaten) {
        const s = stammdaten || {};
        $('abrAbsender').value = s.absender_name || '';
        $('abrAnschrift').value = s.anschrift || '';
        $('abrEmail').value = s.rechnung_email || '';
        $('abrSteuernummer').value = s.steuernummer || '';
        $('abrUstHinweis').value = s.ust_hinweis || UST_VORSCHLAG;
        $('abrUstVorschlag').hidden = !!s.ust_hinweis;
        $('abrKontoinhaber').value = s.kontoinhaber || '';
        $('abrPraefix').value = s.rechnungs_praefix || '';
        $('abrGlaeubigerId').value = s.glaeubiger_id || '';
        $('abrMandatZusatz').value = s.mandat_zusatztext || '';
        zeigeMandatVorschau();
        naechsteNummer = s.naechste_rechnungsnummer || 1;
        zeigeIban(s);
        zeigeNaechsteNummer();
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
                meldeFehler(daten.error || 'Die Abrechnungsdaten konnten nicht geladen werden.');
                return;
            }
            fuelle(daten.stammdaten);
            $('abrForm').hidden = false;
        } catch {
            meldeFehler('Die Abrechnungsdaten konnten nicht geladen werden.');
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

    $('abrPraefix').addEventListener('input', zeigeNaechsteNummer);

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
            absender_name: $('abrAbsender').value,
            anschrift: $('abrAnschrift').value,
            rechnung_email: $('abrEmail').value,
            steuernummer: $('abrSteuernummer').value,
            ust_hinweis: $('abrUstHinweis').value,
            kontoinhaber: $('abrKontoinhaber').value,
            rechnungs_praefix: $('abrPraefix').value,
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
