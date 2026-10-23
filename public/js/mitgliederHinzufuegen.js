// Knopf „Mitglieder hinzufügen“ auf admin-nutzer.html: eine oder mehrere E-Mail-Adressen für einen Verein eintragen.
// Neue Adressen bekommen eine Einladung (Link zur Registrierung, danach sofort als Helfer freigegeben), Adressen mit
// vorhandenem Konto werden dem Verein direkt zusätzlich zugeordnet (weitere Vereine bleiben bestehen).
// API: POST /api/vereine/einladungen { vereinId, emails } (Admins des Vereins und Super-Admins).
(function () {
    const knopf = document.getElementById('mitgliedHinzufuegenKnopf');
    const dialog = document.getElementById('mitgliedHinzufuegenDialog');
    if (!knopf || !dialog) return;
    const vereinWahl = document.getElementById('mitgliedHinzufuegenVerein');
    const vereinListe = document.getElementById('mitgliedHinzufuegenVereine');
    const vereinHinweis = document.getElementById('mitgliedHinzufuegenVereinHinweis');
    let istSuper = false;
    const adressen = document.getElementById('mitgliedHinzufuegenAdressen');
    const fehler = document.getElementById('mitgliedHinzufuegenFehler');
    const ergebnis = document.getElementById('mitgliedHinzufuegenErgebnis');
    const senden = document.getElementById('mitgliedHinzufuegenSenden');
    const STATUS_TEXT = {
        gesendet: 'Einladung gesendet',
        bereits_konto: 'hat schon ein Konto, keine Mail',
        zugeordnet: 'dem Verein zugeordnet',
        bereits_mitglied: 'ist schon Mitglied, keine Änderung',
        fehler: 'Mail konnte nicht gesendet werden'
    };

    let vereine = null;
    async function ladeVereine() {
        if (vereine) return vereine;
        const me = (await (await fetch('/api/auth/me')).json()).user;
        istSuper = !!me.super_admin_aktiv;
        if (me.super_admin_aktiv) {
            const antwort = await fetch('/api/vereine');
            if (!antwort.ok) throw new Error('Die Vereinsliste konnte nicht geladen werden.');
            vereine = (await antwort.json()).map(v => ({ id: v.id, name: v.name }));
        } else {
            const { rolleReicht } = await import('/js/shared/rollen.js');
            vereine = (me.vereine || [])
                .filter(v => v.freigegeben && rolleReicht(v.rolle, 'admin'))
                .map(v => ({ id: v.verein_id, name: v.name }));
        }
        vereine.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return vereine;
    }

    knopf.addEventListener('click', async () => {
        fehler.textContent = '';
        ergebnis.replaceChildren();
        ergebnis.hidden = true;
        try {
            const liste = await ladeVereine();
            if (liste.length === 0) throw new Error('Mitglieder können nur Admins eines Vereins und Super-Admins hinzufügen.');
            vereinListe.replaceChildren(...liste.map(v => {
                const option = document.createElement('option');
                option.value = v.name;
                return option;
            }));
            // Super-Admin: Verein leer und optional (leer = Einladung zur Registrierung ohne Verein); Admin: Pflicht, bei einem Verein vorbelegt
            vereinWahl.value = !istSuper && liste.length === 1 ? liste[0].name : '';
            vereinWahl.required = !istSuper;
            document.getElementById('mitgliedHinzufuegenVereinLabel').textContent = istSuper ? 'Verein (optional)' : 'Verein';
            vereinHinweis.textContent = istSuper
                ? 'Leer lassen: Die Personen registrieren sich selbst und wählen ihren Verein; der Vereins-Admin schaltet sie danach frei.'
                : '';
        } catch (err) {
            if (window.zeigeNotification) window.zeigeNotification(err.message, 'error'); else alert(err.message);
            return;
        }
        adressen.value = '';
        dialog.showModal();
        adressen.focus();
    });

    document.getElementById('mitgliedHinzufuegenSchliessen').addEventListener('click', () => dialog.close());
    document.getElementById('mitgliedHinzufuegenForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        fehler.textContent = '';
        if (!adressen.value.trim()) { fehler.textContent = 'Bitte mindestens eine E-Mail-Adresse eintragen.'; return; }
        const eingabe = vereinWahl.value.trim().toLowerCase();
        const verein = (vereine || []).find(v => v.name.toLowerCase() === eingabe) || null;
        if (eingabe && !verein) { fehler.textContent = 'Bitte einen Verein aus der Liste wählen' + (istSuper ? ' oder das Feld leer lassen.' : '.'); return; }
        if (!eingabe && !istSuper) { fehler.textContent = 'Bitte einen Verein wählen.'; return; }
        senden.disabled = true;
        try {
            const antwort = await fetch('/api/vereine/einladungen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(verein ? { vereinId: verein.id, emails: adressen.value } : { emails: adressen.value })
            });
            const daten = await antwort.json().catch(() => ({}));
            if (!antwort.ok) throw new Error(daten.error || 'Die Mitglieder konnten nicht hinzugefügt werden.');
            ergebnis.replaceChildren(...[
                ...daten.ergebnisse.map(r => `${r.email}: ${STATUS_TEXT[r.status] || r.status}`),
                ...daten.ungueltig.map(u => `${u}: keine gültige E-Mail-Adresse`)
            ].map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
            ergebnis.hidden = false;
            // Erledigte Adressen verschwinden aus dem Feld; Ungültige und Fehlgeschlagene bleiben zum Korrigieren stehen
            adressen.value = [
                ...daten.ergebnisse.filter(r => r.status === 'fehler').map(r => r.email),
                ...daten.ungueltig
            ].join('\n');
            if (daten.ergebnisse.some(r => r.status === 'zugeordnet')) document.dispatchEvent(new CustomEvent('nutzer:neuladen'));
        } catch (err) {
            fehler.textContent = err.message;
        } finally {
            senden.disabled = false;
        }
    });
})();
