// Seite downloads.html (nur Cloud): Installer und Update-Pakete laden (API /api/downloads, src/routes/downloadRoutes.js) und
// Geräteschlüssel der Hallen-Server verwalten. Der Download läuft über einen einmaligen Link (Ticket), weil der Browser beim
// Herunterladen keinen Authorization-Header sendet.
(function () {
    const meldung = document.getElementById('dlMeldung');
    const inhalt = document.getElementById('dlInhalt');
    const GRUPPEN = [
        { id: 'server', titel: 'Hallen-Server', text: 'Das Notebook oder der Rechner in der Halle, auf dem das Turnier läuft. Der Dateiname der Windows- und Linux-Installer enthält einen persönlichen Code: bitte nicht umbenennen, er richtet das automatische Update ein.' },
        { id: 'client', titel: 'Client-Geräte', text: 'Matte, Waage und Anzeige. Die Clients holen sich ihre Programme normalerweise vom Hallen-Server (Seite „Download“ im Hallennetz); hier gibt es sie für die erste Installation.' }
    ];

    function zeige(text, art) {
        meldung.textContent = text || '';
        meldung.className = `dl-meldung ${art || ''}`.trim();
    }

    const groesse = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

    async function json(antwort) {
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) throw new Error(daten.error || daten.message || `Fehler ${antwort.status}`);
        return daten;
    }

    async function lade(datei, version) {
        zeige('Der Download wird vorbereitet …');
        try {
            const t = await json(await fetch('/api/downloads/ticket', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datei, version })
            }));
            zeige('Der Download startet. Er läuft im Browser weiter.', 'ok');
            window.location.assign(t.url);
        } catch (err) {
            zeige(err.message, 'fehler');
        }
    }

    function zelle(zeile, text, klasse) {
        const td = document.createElement('td');
        if (klasse) td.className = klasse;
        if (text instanceof Node) td.appendChild(text); else td.textContent = text;
        zeile.appendChild(td);
        return td;
    }

    function tabelle(dateien, version) {
        const t = document.createElement('table');
        t.className = 'dl-tabelle';
        const kopf = t.createTHead().insertRow();
        for (const text of ['System', 'Datei', 'Größe', '']) {
            const th = document.createElement('th');
            th.textContent = text;
            kopf.appendChild(th);
        }
        const koerper = t.createTBody();
        for (const d of dateien) {
            const zeile = koerper.insertRow();
            zelle(zeile, d.bezeichnung || d.plattform || '');
            const datei = document.createElement('span');
            datei.textContent = d.name;
            const sha = document.createElement('code');
            sha.textContent = ` SHA-256 ${d.sha256.slice(0, 16)}…`;
            sha.title = d.sha256;
            const wrap = document.createElement('span');
            wrap.append(datei, document.createElement('br'), sha);
            zelle(zeile, wrap);
            zelle(zeile, groesse(d.groesse), 'zahl');
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'btn btn-outlined mini';
            knopf.textContent = 'Herunterladen';
            knopf.addEventListener('click', () => lade(d.name, version));
            zelle(zeile, knopf, 'zahl');
        }
        return t;
    }

    async function ladeListe() {
        const daten = await json(await fetch('/api/downloads'));
        inhalt.textContent = '';
        if (!daten.version) {
            const p = document.createElement('p');
            p.textContent = 'Es ist noch keine Version bereitgestellt.' + (daten.spiegelKonfiguriert ? '' : ' Der Betreiber muss die Quelle der Releases einrichten (RELEASE_QUELLE_REPO).');
            inhalt.appendChild(p);
            return daten;
        }
        const kopf = document.createElement('p');
        kopf.textContent = `Aktuelle Version: ${daten.version}` + (daten.veroeffentlicht ? ` (veröffentlicht am ${new Date(daten.veroeffentlicht).toLocaleDateString('de-DE')})` : '');
        inhalt.appendChild(kopf);
        for (const gruppe of GRUPPEN) {
            const dateien = daten.dateien.filter(d => d.gruppe === gruppe.id && d.plattform !== 'linux-dienst');
            if (!dateien.length) continue;
            const box = document.createElement('div');
            box.className = 'dl-box';
            const h = document.createElement('h2');
            h.textContent = gruppe.titel;
            const p = document.createElement('p');
            p.textContent = gruppe.text;
            box.append(h, p, tabelle(dateien, daten.version));
            inhalt.appendChild(box);
        }
        document.getElementById('dlLinuxBox').hidden = !daten.dateien.some(d => d.name === 'hajime-holen.sh' || d.plattform === 'linux-dienst');
        document.getElementById('dlLinuxBox').dataset.version = daten.version;
        return daten;
    }

    async function ladeSchluessel() {
        const box = document.getElementById('dlSchluesselBox');
        const ziel = document.getElementById('dlSchluessel');
        const daten = await json(await fetch('/api/downloads/schluessel'));
        box.hidden = false;
        ziel.textContent = '';
        if (!daten.schluessel.length) {
            ziel.textContent = 'Noch kein Geräteschlüssel angelegt.';
            return;
        }
        const t = document.createElement('table');
        t.className = 'dl-tabelle';
        const kopf = t.createTHead().insertRow();
        for (const text of ['Gerät', 'Konto', 'Angelegt', 'Zuletzt benutzt', '']) {
            const th = document.createElement('th');
            th.textContent = text;
            kopf.appendChild(th);
        }
        const datum = (wert) => (wert ? new Date(wert).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
        const koerper = t.createTBody();
        for (const s of daten.schluessel) {
            const zeile = koerper.insertRow();
            zelle(zeile, s.bezeichnung || 'Hallen-Server');
            zelle(zeile, `${s.vorname} ${s.nachname}`.trim() || s.email);
            zelle(zeile, datum(s.erstellt_am));
            zelle(zeile, s.widerrufen_am ? `widerrufen ${datum(s.widerrufen_am)}` : datum(s.zuletzt_benutzt_am));
            if (s.widerrufen_am) {
                zelle(zeile, '', 'zahl');
                continue;
            }
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'btn btn-outlined mini';
            knopf.textContent = 'Widerrufen';
            knopf.addEventListener('click', async () => {
                if (!confirm('Diesen Geräteschlüssel widerrufen? Der Server kann sich danach nicht mehr aktualisieren, bis er einen neuen bekommt.')) return;
                try {
                    await json(await fetch(`/api/downloads/schluessel/${s.id}`, { method: 'DELETE' }));
                    await ladeSchluessel();
                } catch (err) {
                    zeige(err.message, 'fehler');
                }
            });
            zelle(zeile, knopf, 'zahl');
        }
        ziel.appendChild(t);
    }

    document.getElementById('dlBefehlKnopf').addEventListener('click', async () => {
        const version = document.getElementById('dlLinuxBox').dataset.version;
        try {
            const { schluessel } = await json(await fetch('/api/downloads/geraet', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bezeichnung: 'Linux-Server' })
            }));
            const basis = window.location.origin;
            const befehl = `curl -fsSL -H "Authorization: Bearer ${schluessel}" ${basis}/api/releases/v1/assets/${version}/hajime-holen.sh | sudo RELEASE_URL=${basis} RELEASE_SCHLUESSEL=${schluessel} bash`;
            const feld = document.getElementById('dlBefehl');
            feld.textContent = befehl;
            feld.hidden = false;
            zeige('Befehl erzeugt. Er enthält Ihren Geräteschlüssel und wird nur jetzt angezeigt: bitte nicht weitergeben.', 'ok');
            await ladeSchluessel();
        } catch (err) {
            zeige(err.message, 'fehler');
        }
    });

    // Super-Admins sehen den Stand der Spiegelung und können sie anstoßen (mit 2FA-Code wie bei der Sicherung).
    async function ladeSpiegel() {
        const antwort = await fetch('/api/downloads/spiegel');
        if (!antwort.ok) return;
        const { spiegel, versionen } = await antwort.json();
        document.getElementById('dlSpiegelBox').hidden = false;
        const info = document.getElementById('dlSpiegelInfo');
        const teile = [spiegel.konfiguriert ? `Quelle: ${spiegel.repo}` : 'Nicht eingerichtet (RELEASE_QUELLE_REPO fehlt).'];
        teile.push(`Bereitgestellt: ${versionen.length ? versionen.join(', ') : 'noch nichts'}`);
        if (spiegel.letzterLauf) teile.push(`Letzte Prüfung: ${new Date(spiegel.letzterLauf).toLocaleString('de-DE')}${spiegel.fehler ? ` – Fehler: ${spiegel.fehler}` : ''}`);
        info.textContent = teile.join(' · ');
        document.getElementById('dlSpiegelKnopf').disabled = !spiegel.konfiguriert;
    }

    document.getElementById('dlSpiegelKnopf').addEventListener('click', async () => {
        const code = document.getElementById('dlCode');
        zeige('Suche nach neuen Versionen …');
        try {
            const daten = await json(await fetch('/api/downloads/spiegel/pruefen', { method: 'POST', headers: { 'X-2FA-Code': code.value.trim() } }));
            const e = daten.ergebnis;
            zeige(e.status === 'gespiegelt' ? `Version ${e.version} wurde bereitgestellt.` : e.status === 'aktuell' ? `Version ${e.version} ist schon bereitgestellt.` : 'In der Quelle gibt es noch kein Release.', 'ok');
            await ladeListe();
            await ladeSpiegel();
        } catch (err) {
            zeige(err.message, 'fehler');
        } finally {
            code.value = '';
        }
    });

    ladeListe().then(ladeSchluessel).then(ladeSpiegel).catch((err) => zeige(err.message, 'fehler'));
})();
