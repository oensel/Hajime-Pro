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

    // Handy (kürzeste Bildschirmseite < HANDY_MAX_DP): nur die Waage (Teilnehmerliste). Tablet: Waage, Kampf und
    // Scoreboard. Beide nutzen dieselbe Oberfläche (css/handy.css, js/handy.js: Top-Bar, Karten, Waage als Bogen);
    // das Menü der Top-Bar überschreibt die automatische Erkennung (Gerät merkt sich 'handy'/'tablet').
    const HANDY_MAX_DP = 600;
    const MODUS_SCHLUESSEL = 'hajime_mobil_modus';
    const gespeicherterModus = (() => {
        try { const m = localStorage.getItem(MODUS_SCHLUESSEL); return m === 'handy' || m === 'tablet' ? m : null; } catch (e) { return null; }
    })();
    const automatischHandy = Math.min(window.screen.width, window.screen.height) < HANDY_MAX_DP;
    const istHandy = gespeicherterModus ? gespeicherterModus === 'handy' : automatischHandy;
    if (istHandy && ['steuerung.html', 'kampf.html', 'anzeige.html', 'overlay.html'].includes(seite)) {
        location.replace('/client.html');
        return;
    }
    // Die Kopplungsseite und die eingebettete Anzeige-Vorschau behalten ihr eigenes Aussehen.
    if (seite !== 'verbinden.html' && seite !== 'anzeige.html' && seite !== 'overlay.html') {
        document.documentElement.classList.add('modus-app', istHandy ? 'modus-handy' : 'modus-tablet');
        const stil = document.createElement('link');
        stil.rel = 'stylesheet';
        stil.href = '/css/handy.css';
        document.head.appendChild(stil);
        const skript = document.createElement('script');
        skript.src = '/js/handy.js';
        skript.defer = true;
        document.head.appendChild(skript);
    }

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
