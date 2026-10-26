// Bestätigungsseite für ein SEPA-Lastschriftmandat (Link aus der Mail, ohne Anmeldung, Token trägt die Berechtigung).
// Alle Texte vom Server kommen ausschließlich über textContent in die Seite.
(function () {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    const el = (id) => document.getElementById(id);
    const anfrage = el('anfrage');
    const mandatstext = el('mandatstext');
    const vertretungGruppe = el('vertretungGruppe');
    const vertretung = el('vertretung');
    const knoepfe = el('knoepfe');
    const bestaetigenKnopf = el('bestaetigenKnopf');
    const ablehnenKnopf = el('ablehnenKnopf');
    const ergebnis = el('ergebnis');
    const errDiv = el('errorMessage');

    function zeigeFehler(text) {
        errDiv.textContent = text;
        errDiv.style.display = 'block';
    }

    function aktualisiereKnoepfe(bedienbar) {
        bestaetigenKnopf.disabled = !bedienbar || !vertretung.checked;
        ablehnenKnopf.disabled = !bedienbar;
        vertretung.disabled = !bedienbar;
    }

    function zeigeErgebnis(text) {
        anfrage.style.display = 'none';
        mandatstext.style.display = 'none';
        vertretungGruppe.style.display = 'none';
        knoepfe.style.display = 'none';
        errDiv.style.display = 'none';
        ergebnis.textContent = text;
        ergebnis.style.display = 'block';
    }

    async function lade() {
        if (!token) {
            zeigeFehler('Der Link ist unvollständig. Bitte öffnen Sie den Link aus der E-Mail erneut.');
            return;
        }
        try {
            const response = await fetch(`/api/mandat/${encodeURIComponent(token)}`);
            const data = await response.json().catch(() => ({}));
            if (response.status === 410) { zeigeErgebnis(data.error || 'Über dieses Mandat wurde schon entschieden.'); return; }
            if (!response.ok) throw new Error(data.error || 'Das Mandat konnte nicht geladen werden.');
            el('mandatVerein').textContent = data.vereinName;
            el('mandatTurnier').textContent = data.turnierBezeichnung;
            el('mandatKonto').textContent = data.mandat.iban_maske || '';
            el('mandatInhaber').textContent = data.mandat.kontoinhaber_maske || '';
            el('mandatReferenz').textContent = data.mandat.mandatsreferenz || '';
            mandatstext.textContent = data.mandatstext;
            anfrage.style.display = 'block';
            mandatstext.style.display = 'block';
            vertretungGruppe.style.display = 'block';
            knoepfe.style.display = 'flex';
            aktualisiereKnoepfe(true);
        } catch (err) {
            zeigeFehler(err.message);
        }
    }

    async function entscheide(entscheidung) {
        errDiv.style.display = 'none';
        aktualisiereKnoepfe(false);
        try {
            const response = await fetch(`/api/mandat/${encodeURIComponent(token)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entscheidung, vertretung_bestaetigt: vertretung.checked })
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 410) { zeigeErgebnis(data.error || 'Über dieses Mandat wurde schon entschieden.'); return; }
            if (!response.ok) throw new Error(data.error || 'Die Entscheidung ist fehlgeschlagen.');
            zeigeErgebnis(entscheidung === 'bestaetigen'
                ? 'Das Lastschriftmandat ist bestätigt. Vielen Dank.'
                : 'Das Lastschriftmandat wurde abgelehnt.');
        } catch (err) {
            aktualisiereKnoepfe(true);
            zeigeFehler(err.message);
        }
    }

    vertretung.addEventListener('change', () => aktualisiereKnoepfe(true));
    bestaetigenKnopf.addEventListener('click', () => entscheide('bestaetigen'));
    ablehnenKnopf.addEventListener('click', () => {
        if (confirm('Mandat wirklich ablehnen?')) entscheide('ablehnen');
    });

    lade();
})();
