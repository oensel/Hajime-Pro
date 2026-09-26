// Sync-Konfliktliste der Turnierleitung (matten.html, nur Hallen-Server mit SYNC_ROLLE=server):
// zeigt die offenen konflikt:-Dokumente der Brücke (Ablehnungen, Dubletten, Klärungsfälle,
// technische Fehler) mit beiden Versionen. "Erledigt" blendet einen Eintrag aus, "Erneut
// versuchen" spielt die damals abgelehnte Geräte-Version noch einmal ein (src/sync/bruecke.js).
document.addEventListener('DOMContentLoaded', async () => {
    const karte = document.getElementById('syncKonflikteKarte');
    const liste = document.getElementById('syncKonflikteListe');
    if (!karte || !liste) return;

    const status = await fetch('/api/sync/status').then(r => r.json()).catch(() => ({}));
    if (status.rolle !== 'server') return;
    karte.style.display = '';

    const TITEL = {
        klaerung: 'Klärung nötig: Kampf mit anderer Paarung gewertet',
        abgelehnt: 'Änderung vom Server abgelehnt',
        dublette: 'Nachmeldung war eine Dublette',
        bruecke_fehler: 'Technischer Fehler bei der Übernahme'
    };

    const text = (wert) => {
        const span = document.createElement('span');
        span.textContent = wert;
        return span.innerHTML;
    };

    async function aktion(id, was) {
        const resp = await fetch(`/api/sync/konflikte/${encodeURIComponent(id)}/${was}`, { method: 'POST' });
        const daten = await resp.json().catch(() => ({}));
        if (!resp.ok && window.zeigeNotification) window.zeigeNotification(daten.error || 'Aktion fehlgeschlagen.', 'error');
        await lade();
    }

    async function lade() {
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
                <details style="font-size: 12px; margin: 6px 0;"><summary>Versionen anzeigen</summary>
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <pre style="flex: 1; min-width: 240px; white-space: pre-wrap;">Gerät:\n${text(JSON.stringify(k.version_lokal, null, 2))}</pre>
                        <pre style="flex: 1; min-width: 240px; white-space: pre-wrap;">Server:\n${text(JSON.stringify(k.version_server, null, 2))}</pre>
                    </div>
                </details>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn btn-outlined konflikt-erledigt" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Erledigt</button>
                    ${k.konflikt_typ === 'bruecke_fehler' ? '<button type="button" class="btn btn-outlined konflikt-wiederholen" style="height: 30px; font-size: 12px; padding: 0 12px; margin: 0;">Erneut versuchen</button>' : ''}
                </div>`;
            eintrag.querySelector('.konflikt-erledigt').addEventListener('click', () => aktion(k._id, 'erledigt'));
            eintrag.querySelector('.konflikt-wiederholen')?.addEventListener('click', () => aktion(k._id, 'wiederholen'));
            liste.appendChild(eintrag);
        }
    }

    await lade();
    setInterval(lade, 10000);
});
