// Download-Seite des Clients (turnier.local/download): erkennt das Betriebssystem am User-Agent und
// bietet die passende Installationsdatei der aktuellen Serverversion an (Desktop-Installer bzw.
// Android-App als APK). Wurde die Seite über den Kopplungs-QR-Code geöffnet (…/download#code=123456),
// steht der Code in der Anleitung. Stellt der Server die Dateien gerade bereit (erster Start nach der
// Installation), zeigt die Seite den Fortschritt und lädt sich danach von selbst.
(async () => {
    const NAMEN = { 'win32-x64': 'Windows', 'darwin-universal': 'macOS', 'linux-x64': 'Linux', android: 'Android' };
    const ANLEITUNG = {
        'win32-x64': 'Datei öffnen. Erscheint „Der Computer wurde durch Windows geschützt“: <b>Weitere Informationen → Trotzdem ausführen</b>. Danach liegt „Hajime Pro“ auf dem Desktop.',
        'darwin-universal': 'Datei öffnen und „Hajime Pro“ in den Ordner <b>Programme</b> ziehen. Beim ersten Start: <b>Systemeinstellungen → Datenschutz &amp; Sicherheit → Trotzdem öffnen</b>.',
        'linux-x64': 'Datei ausführbar machen und starten. Unter Ubuntu ab 22.04 einmalig nötig: <code>sudo apt install libfuse2</code> (ab 24.04: <code>sudo apt install libfuse2t64</code>).',
        android: 'Datei öffnen und <b>Installieren</b> tippen. Beim ersten Mal fragt Android, ob dieser Browser Apps installieren darf: <b>Einstellungen → Aus dieser Quelle zulassen</b>, dann zurück und erneut installieren. Danach „Hajime Pro“ öffnen und den QR-Code auf der Seite <b>Matten</b> des Hallen-Servers scannen%CODE%.'
    };
    const ua = navigator.userAgent;
    const hinweis = document.getElementById('downloadHinweis');
    const istAndroid = /Android/i.test(ua);
    // iPhone und iPadOS (meldet sich als "Macintosh", nur die Touch-Punkte verraten das Tablet):
    // für Apple-Geräte gibt es noch keine App.
    const istApple = /iPad|iPhone/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (istApple) {
        hinweis.textContent = 'Für iPhone und iPad gibt es noch keine App. Bitte ein Android-Gerät oder ein Windows-, macOS- oder Linux-Notebook verwenden.';
        return;
    }
    const eigene = istAndroid ? 'android'
        : /Windows/i.test(ua) ? 'win32-x64'
        : /Mac OS X|Macintosh/i.test(ua) ? 'darwin-universal'
        : /Linux|X11/i.test(ua) ? 'linux-x64' : null;

    const resp = await fetch('/api/client/version').catch(() => null);
    if (!resp || !resp.ok) {
        // Der Server stellt die Client-Dateien beim ersten Start selbst bereit (src/sync/clientDateien.js).
        const status = resp ? (await resp.json().catch(() => ({}))).status : null;
        if (status && ['unbekannt', 'kopiere', 'lade'].includes(status.phase)) {
            hinweis.textContent = status.gesamt
                ? `Der Server stellt die Client-Dateien bereit (${Math.min(status.fertig + 1, status.gesamt)} von ${status.gesamt}) – diese Seite aktualisiert sich selbst.`
                : 'Der Server stellt die Client-Dateien bereit – diese Seite aktualisiert sich selbst.';
            setTimeout(() => location.reload(), 3000);
        } else if (status && status.phase === 'fehler') {
            hinweis.textContent = `Die Client-Dateien konnten noch nicht bereitgestellt werden (${status.fehler}). Der Server versucht es regelmäßig erneut.`;
        } else {
            hinweis.textContent = 'Auf diesem Server liegen keine Client-Dateien vor. Bitte die Turnierleitung, „npm run client:holen“ auszuführen.';
        }
        return;
    }
    const { version, dateien } = await resp.json();
    const link = (schluessel) => `/downloads/${encodeURIComponent(version)}/${encodeURIComponent(dateien[schluessel].installieren.datei)}`;
    hinweis.textContent = `Version ${version}`;

    if (istAndroid && !dateien.android) {
        hinweis.textContent = 'Für Android liegt auf diesem Server noch keine App vor. Bitte die Turnierleitung, „npm run client:holen“ auszuführen.';
        return;
    }

    if (eigene && dateien[eigene]) {
        const a = document.createElement('a');
        a.id = 'downloadHauptlink';
        a.className = 'btn btn-raised';
        a.href = link(eigene);
        a.textContent = `Für ${NAMEN[eigene]} herunterladen`;
        document.getElementById('downloadEmpfehlung').appendChild(a);
        const anleitung = document.getElementById('downloadAnleitung');
        const code = new URLSearchParams(location.hash.replace(/^#/, '')).get('code');
        const codeText = /^\d{6}$/.test(code || '') ? ` (oder den Code <b>${code.slice(0, 3)} ${code.slice(3)}</b> eintragen)` : '';
        anleitung.innerHTML = ANLEITUNG[eigene].replace('%CODE%', codeText);
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
