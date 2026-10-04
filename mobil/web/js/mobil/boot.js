// Startet die Browser-Laufzeit der Android-App (siehe laufzeit.js) und lenkt alle /api/-Aufrufe
// der Seiten auf sie um. Klassisches Skript, steht als ERSTES im <head> jeder App-Seite (der Build
// scripts/baue-android-www.mjs fügt es ein): die Seiten rufen /api/sync/status, /api/turniere &
// Co. wie auf einem Node-Client auf — hier antwortet statt des Node-Prozesses die Laufzeit aus der
// lokalen Dokument-DB.
(function () {
    const SCHLUESSEL = 'hajime_mobil_verbindung';
    const echteFetch = window.fetch.bind(window);

    function ladeVerbindung() {
        try {
            const v = JSON.parse(localStorage.getItem(SCHLUESSEL));
            return v && v.serverUrl && v.secret ? v : null;
        } catch (e) {
            return null;
        }
    }

    const seite = location.pathname.split('/').pop() || 'index.html';
    const verbindung = ladeVerbindung();
    const mobil = window.HajimeMobil = {
        schluessel: SCHLUESSEL,
        verbindung,
        echteFetch,
        laufzeit: null,
        // Löst auf, sobald die Laufzeit steht (bei fehlender Kopplung ohne Datenbank).
        bereit: null,
        speichereVerbindung(neu) {
            localStorage.setItem(SCHLUESSEL, JSON.stringify(neu));
        },
        vergissVerbindung() {
            localStorage.removeItem(SCHLUESSEL);
        },
        // Für datenzugriff.js: die lokale Turnier-DB (statt /db am Node-Client).
        async holeDb() {
            const laufzeit = await mobil.bereit;
            return laufzeit.kern ? laufzeit.kern.zustand.db : null;
        }
    };

    if (!verbindung && seite !== 'verbinden.html') {
        location.replace('/verbinden.html');
        return;
    }

    // Eingebettete Seite (Live-Vorschau der Anzeigetafel in steuerung.html): die Laufzeit der
    // Elternseite mitnutzen, statt dieselbe Datenbank ein zweites Mal zu öffnen und zu replizieren.
    let eltern = null;
    try {
        if (window.parent !== window && window.parent.HajimeMobil && window.parent.HajimeMobil.bereit) eltern = window.parent.HajimeMobil;
    } catch (e) { /* andere Herkunft: eigene Laufzeit */ }

    mobil.bereit = (eltern ? eltern.bereit : import('/js/mobil/laufzeit.js').then(m => m.starteLaufzeit(mobil))).then((laufzeit) => {
        mobil.laufzeit = laufzeit;
        return laufzeit;
    });

    window.fetch = function (eingabe, optionen) {
        let url;
        try {
            url = new URL(typeof eingabe === 'string' ? eingabe : (eingabe.url || String(eingabe)), location.href);
        } catch (e) {
            return echteFetch(eingabe, optionen);
        }
        if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return echteFetch(eingabe, optionen);
        return mobil.bereit.then(laufzeit => laufzeit.behandle(eingabe, optionen, url));
    };
})();
