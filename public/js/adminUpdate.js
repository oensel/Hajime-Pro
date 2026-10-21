// Server-Update auf server-update.html (nur Super-Admins, nur Cloud): zeigt laufende Version und neuestes Release und
// startet das Update (POST /api/cloud-update/start). Der Server startet danach neu; die Seite wartet, bis er wieder
// antwortet. API: GET /api/cloud-update/status. Der Authorization-Header kommt aus dem fetch-Wrapper in menu.js.
(function () {
    const box = document.getElementById('updateBox');
    if (!box) return;
    const aktuell = document.getElementById('updateAktuell');
    const neueste = document.getElementById('updateNeueste');
    const hinweis = document.getElementById('updateHinweis');
    const knopf = document.getElementById('updateKnopf');
    const log = document.getElementById('updateLog');
    const keine = document.getElementById('updateKeine');
    let wartetAufNeustart = false;
    let zielVersion = null;
    let takt = null;

    function zeige(st) {
        box.hidden = false;
        if (keine) keine.hidden = true;
        aktuell.textContent = st.aktuelleVersion || '–';
        neueste.textContent = st.neuesteVersion || 'nicht prüfbar';
        log.textContent = (st.meldungen || []).join('\n');
        log.scrollTop = log.scrollHeight;
        const laeuft = st.zustand === 'laeuft' || st.zustand === 'neustart';
        knopf.disabled = !st.moeglich || !st.updateVerfuegbar || laeuft;
        if (!st.moeglich) hinweis.textContent = st.grund || 'Update hier nicht möglich.';
        else if (st.zustand === 'fehler') hinweis.textContent = `Letztes Update fehlgeschlagen: ${st.fehler || 'unbekannter Fehler'}`;
        else if (laeuft) hinweis.textContent = 'Update läuft – der Server startet am Ende neu.';
        else if (st.updateVerfuegbar) hinweis.textContent = 'Ein neueres Release ist verfügbar.';
        else hinweis.textContent = 'Der Server ist aktuell.';
    }

    async function lade() {
        try {
            const antwort = await fetch('/api/cloud-update/status', { cache: 'no-store' });
            if (!antwort.ok) {
                // 404: kein Cloud-Betrieb, 401/403: kein Super-Admin → Bereich bleibt versteckt.
                if (wartetAufNeustart) return;
                box.hidden = true;
                if (keine) keine.textContent = 'Das Server-Update gibt es nur im Cloud-Betrieb und für Super-Admins.';
                return;
            }
            const st = await antwort.json();
            if (wartetAufNeustart && st.aktuelleVersion === zielVersion) {
                wartetAufNeustart = false;
                st.meldungen = [...(st.meldungen || []), `Server läuft jetzt mit Version ${st.aktuelleVersion}.`];
            }
            zeige(st);
            const laeuft = wartetAufNeustart || st.zustand === 'laeuft' || st.zustand === 'neustart';
            if (laeuft && !takt) takt = setInterval(lade, 2000);
            if (!laeuft && takt) { clearInterval(takt); takt = null; }
        } catch {
            // Server beim Neustart nicht erreichbar: weiter abfragen.
            if (wartetAufNeustart && !takt) takt = setInterval(lade, 2000);
        }
    }

    knopf.addEventListener('click', async () => {
        if (!window.confirm('Server jetzt aktualisieren? Er ist während des Neustarts kurz nicht erreichbar.')) return;
        knopf.disabled = true;
        try {
            const antwort = await fetch('/api/cloud-update/start', { method: 'POST' });
            const daten = await antwort.json();
            if (!antwort.ok) throw new Error(daten.error || 'Start fehlgeschlagen');
            wartetAufNeustart = true;
            zielVersion = daten.ziel;
        } catch (err) {
            hinweis.textContent = err.message;
        }
        lade();
        if (!takt) takt = setInterval(lade, 2000);
    });

    lade();
})();
