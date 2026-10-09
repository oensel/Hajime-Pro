// Sync-Konfliktliste der Turnierleitung (sync-konflikte.html, nur Hallen-Server mit SYNC_ROLLE=server):
// zeigt die offenen konflikt:-Dokumente der Brücke (Ablehnungen, Dubletten, Klärungsfälle,
// technische Fehler) mit beiden Versionen nebeneinander, abweichende Felder hervorgehoben.
// "Erledigt" blendet einen Eintrag aus, "Erneut versuchen" spielt die damals abgelehnte
// Geräte-Version noch einmal ein (src/sync/bruecke.js).
document.addEventListener('DOMContentLoaded', async () => {
    const liste = document.getElementById('syncKonflikteListe');
    if (!liste) return;

    const status = await fetch('/api/sync/status').then(r => r.json()).catch(() => ({}));
    if (status.rolle !== 'server') {
        liste.innerHTML = '<p style="margin: 0;">Sync-Konflikte gibt es nur am Hallen-Server.</p>';
        return;
    }

    const TITEL = {
        klaerung: 'Klärung nötig: Kampf mit anderer Paarung gewertet',
        abgelehnt: 'Änderung vom Server abgelehnt',
        dublette: 'Nachmeldung war eine Dublette',
        bruecke_fehler: 'Technischer Fehler bei der Übernahme'
    };

    // Interne Sync-/Dokumentfelder, die für die Turnierleitung nichts aussagen.
    const TECHNISCH = new Set([
        '_id', '_rev', '_conflicts', '_revisions', 'dokumenttyp', 'bearbeitet_von', 'letzte_ablehnung',
        'geschrieben_von_knoten', 'sql_id', 'dokument_id', 'instanz_id', 'updated_at', 'created_at'
    ]);

    const FELDNAMEN = {
        kaempfer1_id: 'Kämpfer 1', kaempfer2_id: 'Kämpfer 2', sieger_id: 'Sieger', status: 'Status',
        unterbewertung_kaempfer1: 'Wertung Kämpfer 1', unterbewertung_kaempfer2: 'Wertung Kämpfer 2',
        kampfzeit_in_sekunden: 'Kampfzeit (s)', matten_reihenfolge: 'Reihenfolge auf der Matte',
        reihenfolge_nummer: 'Kampfnummer', gewicht: 'Gewicht (kg)', gewogen: 'Gewogen',
        vorname: 'Vorname', nachname: 'Nachname', verein: 'Verein', judopass_id: 'Judopass',
        altersklasse: 'Altersklasse', gewichtsklasse: 'Gewichtsklasse', pool_id: 'Pool'
    };
    const KAEMPFER_FELDER = new Set(['kaempfer1_id', 'kaempfer2_id', 'sieger_id']);
    let teilnehmerNamen = new Map();

    const text = (wert) => {
        const span = document.createElement('span');
        span.textContent = wert;
        return span.innerHTML;
    };

    const wertText = (wert, feld) => {
        if (wert === undefined) return '–';
        if (KAEMPFER_FELDER.has(feld) && wert !== null && teilnehmerNamen.has(wert)) return teilnehmerNamen.get(wert);
        if (wert === null || wert === '') return '(leer)';
        if (typeof wert === 'object') return JSON.stringify(wert);
        return String(wert);
    };

    // Gegenüberstellung Gerät / Server: eine Zeile je Feld, abweichende Zeilen oben und hervorgehoben.
    function vergleichsTabelle(lokal, server) {
        if (!lokal && !server) return '';
        const schluessel = [...new Set([...Object.keys(lokal || {}), ...Object.keys(server || {})])]
            .filter(s => !TECHNISCH.has(s));
        const zeilen = schluessel.map(s => {
            const a = lokal ? lokal[s] : undefined;
            const b = server ? server[s] : undefined;
            return { s, a, b, abweichend: JSON.stringify(a) !== JSON.stringify(b) };
        }).sort((x, y) => Number(y.abweichend) - Number(x.abweichend));
        if (!zeilen.length) return '';
        const kopf = '<tr style="text-align: left;"><th></th><th>Gerät</th><th>Server</th></tr>';
        const body = zeilen.map(z => `
            <tr${z.abweichend ? ' style="background: rgba(249, 168, 37, 0.18);"' : ''} data-abweichend="${z.abweichend}">
                <td style="color: var(--text-muted); padding: 2px 8px 2px 0;">${text(FELDNAMEN[z.s] || z.s)}</td>
                <td style="padding: 2px 8px;">${text(wertText(z.a, z.s))}</td>
                <td style="padding: 2px 8px;">${server ? text(wertText(z.b, z.s)) : '–'}</td>
            </tr>`).join('');
        return `<table class="konflikt-vergleich" style="width: 100%; font-size: 13px; border-collapse: collapse; margin: 6px 0;">${kopf}${body}</table>`;
    }

    const bestaetige = async (nachricht, titel) => (typeof window.zeigeZentraleBestaetigung === 'function'
        ? window.zeigeZentraleBestaetigung(nachricht, titel, 'help_outline')
        : confirm(nachricht));

    async function aktion(id, was, body) {
        const resp = await fetch(`/api/sync/konflikte/${encodeURIComponent(id)}/${was}`, {
            method: 'POST',
            ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
        });
        const daten = await resp.json().catch(() => ({}));
        if (!resp.ok && window.zeigeNotification) window.zeigeNotification(daten.error || 'Aktion fehlgeschlagen.', 'error');
        if (resp.ok && body && window.zeigeNotification) window.zeigeNotification('Entscheidung übernommen.', 'success');
        await lade();
        if (window.hajimeAktualisiereSyncKonflikte) window.hajimeAktualisiereSyncKonflikte();
    }

    async function ladeTeilnehmerNamen() {
        if (!status.turnier_id) return;
        const liste = await fetch(`/api/teilnehmer?turnierId=${encodeURIComponent(status.turnier_id)}`).then(r => (r.ok ? r.json() : [])).catch(() => []);
        teilnehmerNamen = new Map((Array.isArray(liste) ? liste : []).map(t => [t.id, `${t.vorname} ${t.nachname}${t.verein ? ` (${t.verein})` : ''}`]));
    }

    async function lade() {
        await ladeTeilnehmerNamen();
        const konflikte = await fetch('/api/sync/konflikte').then(r => (r.ok ? r.json() : [])).catch(() => []);
        if (!konflikte.length) {
            liste.innerHTML = '<p style="margin: 0;">Keine offenen Konflikte.</p>';
            return;
        }
        liste.innerHTML = '';
        for (const k of konflikte) {
            const eintrag = document.createElement('div');
            eintrag.className = 'sync-konflikt';
            eintrag.dataset.konfliktId = k._id;
            eintrag.dataset.typ = k.konflikt_typ;
            const hoch = k.prioritaet === 'hoch';
            eintrag.style.cssText = `border-left: 4px solid ${hoch ? '#c62828' : '#f9a825'}; padding: 8px 12px; margin-bottom: 10px; background: var(--surface, #fff);`;
            eintrag.innerHTML = `
                <div style="font-weight: 700;">${text(TITEL[k.konflikt_typ] || k.konflikt_typ)}${hoch ? ' <span style="color:#c62828;">(hoch)</span>' : ''}</div>
                <div style="font-size: 13px; margin: 4px 0;">${text(k.grund || '')}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${text(k.bezug_id || '')} · ${text(new Date(k.erstellt_am).toLocaleString('de-DE'))}</div>
                ${vergleichsTabelle(k.version_lokal, k.version_server)}
                <details style="font-size: 12px; margin: 6px 0;"><summary>Rohdaten anzeigen</summary>
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <pre style="flex: 1; min-width: 240px; white-space: pre-wrap;">Gerät:\n${text(JSON.stringify(k.version_lokal, null, 2))}</pre>
                        <pre style="flex: 1; min-width: 240px; white-space: pre-wrap;">Server:\n${text(JSON.stringify(k.version_server, null, 2))}</pre>
                    </div>
                </details>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${k.konflikt_typ === 'klaerung' ? `
                        <button type="button" class="btn btn-raised konflikt-geraet" title="Paarung und Ergebnis der Matte übernehmen; der Kampf wird damit beendet" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Ergebnis der Matte übernehmen</button>
                        <button type="button" class="btn btn-outlined konflikt-server" title="Server-Paarung behalten, das Ergebnis der Matte verwerfen; der Kampf wird neu ausgetragen" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Server-Paarung behalten</button>` : ''}
                    <button type="button" class="btn btn-outlined konflikt-erledigt" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Erledigt</button>
                    ${k.konflikt_typ === 'bruecke_fehler' ? '<button type="button" class="btn btn-outlined konflikt-wiederholen" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Erneut versuchen</button>' : ''}
                </div>`;
            eintrag.querySelector('.konflikt-erledigt').addEventListener('click', async () => {
                if (k.konflikt_typ === 'klaerung' && !(await bestaetige(
                    'Der Kampf bleibt dadurch auf "Klärung" stehen. Nur den Hinweis ausblenden, wenn der Kampf bereits anders gelöst wurde. Sonst oben entscheiden.',
                    'Nur Hinweis ausblenden?'
                ))) return;
                aktion(k._id, 'erledigt');
            });
            eintrag.querySelector('.konflikt-geraet')?.addEventListener('click', async () => {
                if (await bestaetige(
                    'Paarung und Ergebnis der Matte werden übernommen und der Kampf beendet. Die Vorkämpfe, aus denen der Server die Paarung berechnet, bleiben unverändert.',
                    'Ergebnis der Matte übernehmen?'
                )) aktion(k._id, 'entscheiden', { entscheidung: 'geraet' });
            });
            eintrag.querySelector('.konflikt-server')?.addEventListener('click', async () => {
                if (await bestaetige(
                    'Das Ergebnis der Matte wird verworfen. Der Kampf wird mit der Paarung des Servers neu ausgetragen.',
                    'Server-Paarung behalten?'
                )) aktion(k._id, 'entscheiden', { entscheidung: 'server' });
            });
            eintrag.querySelector('.konflikt-wiederholen')?.addEventListener('click', () => aktion(k._id, 'wiederholen'));
            liste.appendChild(eintrag);
        }
    }

    await lade();
    setInterval(lade, 10000);
});
