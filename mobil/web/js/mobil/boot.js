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

    // Handy (kürzeste Bildschirmseite < HANDY_MAX_DP): nur Teilnehmer/Waage. Scoreboard, Mattenleitung
    // und Anzeige sind für kleine Bildschirme nicht gedacht; Tablets bekommen alles und drehen frei.
    // Der Umschalter auf der Startseite überschreibt die automatische Erkennung (Gerät merkt sich 'handy'/'tablet').
    const HANDY_MAX_DP = 600;
    const MODUS_SCHLUESSEL = 'hajime_mobil_modus';
    const gespeicherterModus = (() => {
        try { const m = localStorage.getItem(MODUS_SCHLUESSEL); return m === 'handy' || m === 'tablet' ? m : null; } catch (e) { return null; }
    })();
    const automatischHandy = Math.min(window.screen.width, window.screen.height) < HANDY_MAX_DP;
    const istHandy = gespeicherterModus ? gespeicherterModus === 'handy' : automatischHandy;
    if (istHandy) {
        if (['steuerung.html', 'kampf.html', 'anzeige.html', 'overlay.html'].includes(seite)) {
            location.replace('/client.html');
            return;
        }
        const stil = document.createElement('style');
        stil.textContent = '#linkScoreboard, #linkMattenleitung, #nav-kampf, #nav-scoreboard { display: none !important; }';
        document.head.appendChild(stil);
    }
    if (seite === 'client.html') {
        document.addEventListener('DOMContentLoaded', () => {
            const ziel = istHandy ? 'tablet' : 'handy';
            const absatz = document.createElement('p');
            absatz.style.cssText = 'text-align:center;margin:16px 0 0;';
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = istHandy ? 'Zum Tablet-Modus wechseln (alle Funktionen)' : 'Zum Handy-Modus wechseln (nur Waage)';
            link.addEventListener('click', (e) => {
                e.preventDefault();
                try { localStorage.setItem(MODUS_SCHLUESSEL, ziel); } catch (err) { /* ohne Speicher: keine Umschaltung */ }
                location.reload();
            });
            absatz.appendChild(link);
            document.body.appendChild(absatz);
        });
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
