// Seite sicherung.html (nur Super-Admins, nur Cloud): Komplettsicherung herunterladen oder auf dem Server ablegen, Sicherungen auf
// dem Server verwalten und Wiedereinspielen (API /api/sicherung, src/routes/sicherungRoutes.js). Jede Aktion sendet den
// aktuellen 2FA-Code im Header X-2FA-Code, das Wiederherstellen zusätzlich X-Bestaetigung: WIEDERHERSTELLEN.
(function () {
    const WORT = 'WIEDERHERSTELLEN';
    const code = document.getElementById('sicherungCode');
    const meldung = document.getElementById('sicherungMeldung');
    const liste = document.getElementById('sicherungListe');
    const wort = document.getElementById('wiederWort');
    const knoepfe = ['herunterladenKnopf', 'ablegenKnopf', 'wiederKnopf', 'automatikJetztKnopf'].map((id) => document.getElementById(id));

    function zeige(text, art) {
        meldung.textContent = text || '';
        meldung.className = `sicherung-meldung ${art || ''}`.trim();
    }

    const groesse = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
    const kopf = (extra = {}) => ({ 'X-2FA-Code': code.value.trim(), ...extra });

    async function fehlerAus(response) {
        const daten = await response.json().catch(() => ({}));
        return new Error(daten.error || `Die Aktion ist fehlgeschlagen (${response.status}).`);
    }

    async function aktion(beschreibung, lauf) {
        zeige(`${beschreibung} …`);
        knoepfe.forEach((k) => { k.disabled = true; });
        try {
            await lauf();
        } catch (err) {
            zeige(err.message, 'fehler');
        } finally {
            knoepfe.forEach((k) => { k.disabled = false; });
            code.value = '';
        }
    }

    function speichereBlob(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }

    function dateiNameAus(response, standard) {
        const m = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '');
        return m ? m[1] : standard;
    }

    const automatikInfo = document.getElementById('automatikInfo');

    function zeichneAutomatik(a, verschluesselung) {
        automatikInfo.textContent = '';
        const zeile = (text, klasse) => {
            const p = document.createElement('div');
            p.textContent = text;
            if (klasse) p.className = klasse;
            p.style.margin = '3px 0';
            automatikInfo.appendChild(p);
        };
        if (verschluesselung) {
            if (verschluesselung.fehler) zeile(`Verschlüsselung eingestellt, aber unbrauchbar: ${verschluesselung.fehler} Sicherungen scheitern, bis das behoben ist.`, 'sicherung-meldung fehler');
            else if (verschluesselung.aktiv) zeile('Alle Sicherungen werden verschlüsselt (AES-256-GCM). Das Passwort steht nur in der Server-Einstellung SICHERUNG_PASSWORT.', 'sicherung-meldung ok');
            else zeile('Die Sicherungen sind NICHT verschlüsselt. Für eine Kopie an einem anderen Ort unbedingt SICHERUNG_PASSWORT setzen (mindestens 20 Zeichen).', 'sicherung-meldung fehler');
        }
        if (!a) { zeile('Keine Angaben.'); return; }
        zeile(a.aktiv
            ? `Täglich um ${a.uhrzeit} Uhr (Berliner Zeit); die letzten ${a.behalte} automatischen Sicherungen bleiben erhalten.`
            : 'Ausgeschaltet (SICHERUNG_AUTOMATISCH=false).');
        zeile(a.kopieVerzeichnis || a.befehl
            ? `Kopie an einem anderen Ort: ${[a.kopieVerzeichnis && `Verzeichnis ${a.kopieVerzeichnis}`, a.befehl && 'Befehl nach jeder Sicherung'].filter(Boolean).join(' und ')}.`
            : 'Keine Kopie an einem anderen Ort eingerichtet: geht der Server verloren, geht auch die Sicherung verloren.', a.kopieVerzeichnis || a.befehl ? '' : 'sicherung-meldung fehler');
        const s = a.status;
        if (!s) { zeile('Noch kein automatischer Lauf.'); return; }
        const wann = new Date(s.zeit).toLocaleString('de-DE');
        if (s.fehler) { zeile(`Letzter Lauf ${wann}: Sicherung fehlgeschlagen (${s.fehler}).`, 'sicherung-meldung fehler'); return; }
        zeile(`Letzter Lauf ${wann}: ${s.name} (${groesse(s.groesse)}).`, s.ok ? 'sicherung-meldung ok' : 'sicherung-meldung fehler');
        if (s.kopie) zeile(`Kopie nach ${s.kopie.ziel}: ${s.kopie.ok ? 'in Ordnung' : `fehlgeschlagen (${s.kopie.fehler})`}.`, s.kopie.ok ? '' : 'sicherung-meldung fehler');
        if (s.befehl) zeile(`Befehl nach der Sicherung: ${s.befehl.ok ? 'in Ordnung' : `fehlgeschlagen (${s.befehl.fehler})`}.`, s.befehl.ok ? '' : 'sicherung-meldung fehler');
    }

    async function ladeListe() {
        try {
            const response = await fetch('/api/sicherung');
            if (!response.ok) throw await fehlerAus(response);
            const daten = await response.json();
            document.getElementById('sicherungVerzeichnis').textContent = daten.verzeichnis;
            zeichneAutomatik(daten.automatik, daten.verschluesselung);
            liste.textContent = '';
            if (daten.dateien.length === 0) {
                const tr = liste.insertRow();
                const td = tr.insertCell();
                td.colSpan = 4;
                td.textContent = 'Noch keine Sicherung auf dem Server.';
                return;
            }
            for (const d of daten.dateien) {
                const tr = liste.insertRow();
                tr.insertCell().textContent = `${d.verschluesselt ? '🔒 ' : ''}${d.name}`;
                tr.insertCell().textContent = new Date(d.erstellt).toLocaleString('de-DE');
                const g = tr.insertCell();
                g.className = 'zahl';
                g.textContent = groesse(d.groesse);
                const aktionen = tr.insertCell();
                for (const [text, handler] of [
                    ['Herunterladen', () => ladeDatei(d.name)],
                    ['Wiederherstellen', () => stelleAusDatei(d.name)],
                    ['Löschen', () => loesche(d.name)]
                ]) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'btn btn-outlined mini';
                    b.textContent = text;
                    b.addEventListener('click', handler);
                    aktionen.append(b, ' ');
                }
            }
        } catch (err) {
            liste.textContent = '';
            zeige(err.message, 'fehler');
        }
    }

    document.getElementById('herunterladenKnopf').addEventListener('click', () => aktion('Sicherung wird erstellt', async () => {
        const response = await fetch('/api/sicherung/herunterladen', { method: 'POST', headers: kopf() });
        if (!response.ok) throw await fehlerAus(response);
        speichereBlob(await response.blob(), dateiNameAus(response, 'hajime-pro.hajime-sicherung.gz'));
        zeige('Die Sicherung wurde heruntergeladen.', 'ok');
    }));

    document.getElementById('ablegenKnopf').addEventListener('click', () => aktion('Sicherung wird abgelegt', async () => {
        const response = await fetch('/api/sicherung/erstellen', { method: 'POST', headers: kopf() });
        if (!response.ok) throw await fehlerAus(response);
        const daten = await response.json();
        zeige(`Abgelegt: ${daten.datei.name} (${groesse(daten.datei.groesse)}).`, 'ok');
        await ladeListe();
    }));

    document.getElementById('automatikJetztKnopf').addEventListener('click', () => aktion('Automatische Sicherung läuft', async () => {
        const response = await fetch('/api/sicherung/automatisch-jetzt', { method: 'POST', headers: kopf() });
        if (!response.ok) throw await fehlerAus(response);
        const daten = await response.json();
        zeige(daten.status.ok ? 'Der Probelauf war erfolgreich.' : 'Der Probelauf hatte Fehler, Einzelheiten stehen oben.', daten.status.ok ? 'ok' : 'fehler');
        await ladeListe();
    }));

    function ladeDatei(name) {
        return aktion('Datei wird geladen', async () => {
            const response = await fetch(`/api/sicherung/dateien/${encodeURIComponent(name)}/herunterladen`, { method: 'POST', headers: kopf() });
            if (!response.ok) throw await fehlerAus(response);
            speichereBlob(await response.blob(), name);
            zeige(`${name} wurde heruntergeladen.`, 'ok');
        });
    }

    function loesche(name) {
        return aktion('Sicherung wird gelöscht', async () => {
            const response = await fetch(`/api/sicherung/dateien/${encodeURIComponent(name)}`, { method: 'DELETE', headers: kopf() });
            if (!response.ok) throw await fehlerAus(response);
            zeige(`${name} wurde gelöscht.`, 'ok');
            await ladeListe();
        });
    }

    function meldeWiederhergestellt(daten) {
        zeige(`Wiederhergestellt: ${daten.tabellen} Tabellen, ${daten.zeilen} Zeilen. Vorher gesichert als ${daten.vorherSicherung}. Bitte laden Sie die Seite neu; bei Bedarf melden Sie sich neu an.`, 'ok');
        wort.value = '';
        return ladeListe();
    }

    function stelleAusDatei(name) {
        if (wort.value !== WORT) { zeige(`Zur Bestätigung bitte oben „${WORT}“ eingeben.`, 'fehler'); return Promise.resolve(); }
        return aktion('Sicherung wird eingespielt', async () => {
            const response = await fetch(`/api/sicherung/wiederherstellen?datei=${encodeURIComponent(name)}`, {
                method: 'POST', headers: kopf({ 'X-Bestaetigung': wort.value })
            });
            if (!response.ok) throw await fehlerAus(response);
            await meldeWiederhergestellt(await response.json());
        });
    }

    document.getElementById('wiederKnopf').addEventListener('click', () => {
        const datei = document.getElementById('wiederDatei').files[0];
        if (!datei) { zeige('Bitte zuerst eine Sicherungsdatei wählen.', 'fehler'); return; }
        if (wort.value !== WORT) { zeige(`Zur Bestätigung bitte „${WORT}“ eingeben.`, 'fehler'); return; }
        aktion('Sicherung wird eingespielt', async () => {
            const response = await fetch('/api/sicherung/wiederherstellen', {
                method: 'POST', body: datei, headers: kopf({ 'X-Bestaetigung': wort.value, 'Content-Type': 'application/octet-stream' })
            });
            if (!response.ok) throw await fehlerAus(response);
            await meldeWiederhergestellt(await response.json());
        });
    });

    ladeListe();
})();
