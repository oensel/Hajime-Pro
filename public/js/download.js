// Download-Seite des Desktop-Clients (turnier.local/download): erkennt das Betriebssystem am
// User-Agent und bietet die passende Installationsdatei der aktuellen Serverversion an.
(async () => {
    const NAMEN = { 'win32-x64': 'Windows', 'darwin-universal': 'macOS', 'linux-x64': 'Linux' };
    const ANLEITUNG = {
        'win32-x64': 'Datei öffnen. Erscheint „Der Computer wurde durch Windows geschützt“: <b>Weitere Informationen → Trotzdem ausführen</b>. Danach liegt „Hajime Pro“ auf dem Desktop.',
        'darwin-universal': 'Datei öffnen und „Hajime Pro“ in den Ordner <b>Programme</b> ziehen. Beim ersten Start: <b>Systemeinstellungen → Datenschutz &amp; Sicherheit → Trotzdem öffnen</b>.',
        'linux-x64': 'Datei ausführbar machen und starten. Unter Ubuntu ab 22.04 einmalig nötig: <code>sudo apt install libfuse2</code> (ab 24.04: <code>sudo apt install libfuse2t64</code>).'
    };
    const ua = navigator.userAgent;
    const hinweis = document.getElementById('downloadHinweis');
    // Tablets zuerst: Android meldet sich zusätzlich als "Linux", iPadOS als "Macintosh" (mit Touch)
    // — sonst bekämen sie AppImage bzw. .dmg angeboten, die dort nicht laufen.
    const istTablet = /Android|iPad|iPhone/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (istTablet) {
        hinweis.textContent = 'Tablets und Smartphones werden nicht unterstützt – bitte diese Seite auf einem Windows-, macOS- oder Linux-Notebook öffnen.';
        return;
    }
    const eigene = /Windows/i.test(ua) ? 'win32-x64' : /Mac OS X|Macintosh/i.test(ua) ? 'darwin-universal' : /Linux|X11/i.test(ua) ? 'linux-x64' : null;

    const resp = await fetch('/api/client/version').catch(() => null);
    if (!resp || !resp.ok) {
        hinweis.textContent = 'Auf diesem Server liegen noch keine Client-Dateien vor. Bitte die Turnierleitung, „npm run client:holen“ auszuführen.';
        return;
    }
    const { version, dateien } = await resp.json();
    const link = (schluessel) => `/downloads/${encodeURIComponent(version)}/${encodeURIComponent(dateien[schluessel].installieren.datei)}`;
    hinweis.textContent = `Version ${version}`;

    if (eigene && dateien[eigene]) {
        const a = document.createElement('a');
        a.id = 'downloadHauptlink';
        a.className = 'btn btn-raised';
        a.href = link(eigene);
        a.textContent = `Für ${NAMEN[eigene]} herunterladen`;
        document.getElementById('downloadEmpfehlung').appendChild(a);
        const anleitung = document.getElementById('downloadAnleitung');
        anleitung.innerHTML = ANLEITUNG[eigene];
        anleitung.style.display = '';
    }
    const weitere = document.getElementById('downloadWeitere');
    for (const schluessel of Object.keys(NAMEN)) {
        if (schluessel === eigene || !dateien[schluessel]) continue;
        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = link(schluessel);
        a.textContent = NAMEN[schluessel];
        p.appendChild(a);
        weitere.appendChild(p);
    }
})();
