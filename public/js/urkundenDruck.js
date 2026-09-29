// Vorschau und Druck des Urkunden-PDFs — gemeinsam genutzt von urkunden.html, pools.html und
// mannschaften.html (dort über window.hajimeUrkunden, da pools.js/mannschaften.js klassische
// Skripte sind).

const GRUENDE = { zu_lang: 'Text zu lang', zeichen_fehlt: 'Zeichen fehlt in der Schrift' };

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function baueModal(id, inhaltHtml, maxBreite) {
    document.getElementById(id)?.remove();
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 10000; display: flex; align-items: center; justify-content: center;';
    modal.innerHTML = `<div class="mdc-card" style="width: 95%; max-width: ${maxBreite}; max-height: 92vh; padding: 20px; border-radius: 4px; border: 2px solid var(--border); background-color: var(--bg-card); display: flex; flex-direction: column; gap: 12px;">${inhaltHtml}</div>`;
    document.body.appendChild(modal);
    return modal;
}

function meldeFehler(text) {
    if (window.zeigeNotification) window.zeigeNotification(text, 'error');
    else alert(text);
}

export async function zeigeUrkundenVorschau({ turnierId, vorlageId, platzbereich, reihenfolge, poolIds }, { autoDruck = false } = {}) {
    let res;
    try {
        res = await fetch('/api/urkunden/generieren', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnierId, vorlageId, platzbereich, reihenfolge, poolIds })
        });
    } catch {
        meldeFehler('Netzwerkfehler beim Erzeugen der Urkunden.');
        return;
    }
    if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        meldeFehler(daten.error || 'Die Urkunden konnten nicht erzeugt werden.');
        return;
    }

    const url = URL.createObjectURL(await res.blob());
    const anzahl = res.headers.get('X-Urkunden-Anzahl') || '?';
    let warnungen = [];
    try { warnungen = JSON.parse(decodeURIComponent(res.headers.get('X-Urkunden-Warnungen') || '%5B%5D')); } catch { warnungen = []; }

    const warnungsHtml = warnungen.length === 0 ? '' : `
        <div class="urkunden-hinweis" style="max-height: 120px; overflow: auto;">
            <strong>Hinweise:</strong>
            <ul style="margin: 4px 0 0; padding-left: 20px;">${warnungen.map(w =>
                `<li>Seite ${w.seite} – ${escapeHtml(w.name)} – Feld „${escapeHtml(w.feld)}“: ${GRUENDE[w.grund] || escapeHtml(w.grund)}</li>`).join('')}</ul>
        </div>`;

    const modal = baueModal('urkundenVorschauModal', `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <h2 style="margin: 0; font-size: 18px;">Urkunden-Vorschau (${escapeHtml(anzahl)} Seiten)</h2>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn btn-raised" data-aktion="drucken">Drucken</button>
                <button type="button" class="btn btn-outlined" data-aktion="tab">In neuem Tab öffnen</button>
                <a class="btn btn-outlined" data-aktion="download" href="${url}" download="urkunden.pdf">Herunterladen</a>
                <button type="button" class="btn btn-outlined" data-aktion="schliessen">Schließen</button>
            </div>
        </div>
        ${warnungsHtml}
        <iframe id="urkundenVorschauFrame" src="${url}" title="Urkunden-Vorschau" style="width: 100%; height: 70vh; border: 1px solid var(--border);"></iframe>
    `, '1100px');

    const frame = modal.querySelector('iframe');
    const drucke = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
    };
    modal.querySelector('[data-aktion="drucken"]').addEventListener('click', drucke);
    modal.querySelector('[data-aktion="tab"]').addEventListener('click', () => window.open(url, '_blank'));
    modal.querySelector('[data-aktion="schliessen"]').addEventListener('click', () => {
        modal.remove();
        URL.revokeObjectURL(url);
    });
    if (autoDruck) frame.addEventListener('load', () => setTimeout(drucke, 300), { once: true });
}

window.hajimeUrkunden = { ...(window.hajimeUrkunden || {}), zeigeUrkundenVorschau };
