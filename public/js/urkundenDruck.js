// Vorschau und Druck des Urkunden-PDFs sowie die Vorlagen-Auswahl mit Mini-Ansicht — gemeinsam
// genutzt von urkunden.html, pools.html und mannschaften.html (dort über window.hajimeUrkunden, da pools.js/mannschaften.js klassische
// Skripte sind).

const GRUENDE = { zu_lang: 'Text zu lang', zeichen_fehlt: 'Zeichen fehlt in der Schrift' };

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function baueModal(id, inhaltHtml, maxBreite) {
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

// Erzeugt das PDF (und legt es am Server je Pool ab) und zeigt die Vorschau. Liefert true, wenn
// ein PDF erzeugt wurde.
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
        return false;
    }
    if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        meldeFehler(daten.error || 'Die Urkunden konnten nicht erzeugt werden.');
        return false;
    }
    await zeigePdfVorschau(res, { autoDruck });
    return true;
}

// Zeigt das zuletzt für einen Pool erzeugte und am Server abgelegte PDF.
export async function zeigeGespeichertesPdf({ turnierId, poolId }) {
    let res;
    try {
        res = await fetch(`/api/urkunden/pools/${poolId}/pdf?turnierId=${turnierId}`);
    } catch {
        meldeFehler('Netzwerkfehler beim Laden des PDFs.');
        return false;
    }
    if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        meldeFehler(daten.error || 'Das PDF konnte nicht geladen werden.');
        return false;
    }
    await zeigePdfVorschau(res);
    return true;
}

async function zeigePdfVorschau(res, { autoDruck = false } = {}) {
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
                <button type="button" class="btn btn-outlined" data-aktion="download">Herunterladen</button>
                <button type="button" class="btn btn-outlined" data-aktion="schliessen">Schließen</button>
            </div>
        </div>
        ${warnungsHtml}
        ${res.headers.get('X-Urkunden-Gespeichert') === '0' ? '<div class="urkunden-hinweis">Dieses PDF wurde nicht am Server abgelegt (Secondary oder Speicherfehler).</div>' : ''}
        <iframe id="urkundenVorschauFrame" src="${url}" title="Urkunden-Vorschau" style="width: 100%; height: 70vh; border: 1px solid var(--border);"></iframe>
    `, '1100px');

    const frame = modal.querySelector('iframe');
    const drucke = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
    };
    modal.querySelector('[data-aktion="drucken"]').addEventListener('click', drucke);
    modal.querySelector('[data-aktion="tab"]').addEventListener('click', () => window.open(url, '_blank'));
    modal.querySelector('[data-aktion="download"]').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'urkunden.pdf';
        link.click();
    });
    modal.querySelector('[data-aktion="schliessen"]').addEventListener('click', () => {
        modal.remove();
        URL.revokeObjectURL(url);
    });
    if (autoDruck) frame.addEventListener('load', () => setTimeout(drucke, 300), { once: true });
}

// --- Vorlagen-Auswahl mit Mini-Ansicht ---
export const PLATZBEREICH_OPTIONEN = [['3', '1.–3.'], ['5', '1.–5.'], ['7', '1.–7.'], ['alle', 'alle (ohne Platz: Teilnahme)']];
export const REIHENFOLGE_OPTIONEN = [['absteigend', 'letzter Platz zuerst'], ['aufsteigend', '1. Platz zuerst']];
const LETZTE_VORLAGE = 'hajimeUrkundenLetzteVorlage';
const miniaturen = new Map();

export function merkeVorlage(id) {
    try { localStorage.setItem(LETZTE_VORLAGE, String(id)); } catch { /* ohne Speicher: keine Vorauswahl */ }
}

// Zuletzt genutzte Vorlage, sonst die erste der Liste.
export function vorausgewaehlteVorlage(vorlagen) {
    let letzte = null;
    try { letzte = localStorage.getItem(LETZTE_VORLAGE); } catch { letzte = null; }
    return (vorlagen.find(v => String(v.id) === letzte) || vorlagen[0])?.id ?? null;
}

export function stilEinmal() {
    if (document.getElementById('urkundenVorlagenStil')) return;
    const stil = document.createElement('style');
    stil.id = 'urkundenVorlagenStil';
    stil.textContent = `
        .urkunden-vorlagen-raster { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; overflow: auto; max-height: 55vh; padding: 2px; }
        .urkunden-vorlage-karte { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border: 2px solid var(--border); border-radius: 4px; background: var(--bg-card); color: inherit; cursor: pointer; font: inherit; }
        .urkunden-vorlage-karte:hover { border-color: var(--primary); }
        .urkunden-vorlage-karte[aria-pressed="true"] { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary); }
        .urkunden-vorlage-bild { width: 130px; height: 130px; display: flex; align-items: center; justify-content: center; background: #f4f4f4; }
        .urkunden-vorlage-bild img { max-width: 130px; max-height: 130px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .urkunden-vorlage-name { font-size: 13px; font-weight: 700; text-align: center; word-break: break-word; }
        .urkunden-optionen { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
        .urkunden-optionen label { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; font-weight: 700; }
        .urkunden-optionen select { width: auto; margin: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-card); color: inherit; }
    `;
    document.head.appendChild(stil);
}

// Seite 1 eines PDFs als kleines Bild (Data-URL), je Schlüssel einmal pro Seitenaufruf.
export function pdfMiniatur(url, schluessel = url) {
    if (!miniaturen.has(schluessel)) {
        const laden = (async () => {
            const pdfjs = await import('/js/pdfjs/pdf.min.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.mjs';
            const res = await fetch(url);
            if (!res.ok) throw new Error('Vorschau nicht verfügbar');
            const pdf = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
            const seite = await pdf.getPage(1);
            const basis = seite.getViewport({ scale: 1 });
            const faktor = (130 / Math.max(basis.width, basis.height)) * (window.devicePixelRatio || 1);
            const viewport = seite.getViewport({ scale: faktor });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await seite.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return canvas.toDataURL('image/png');
        })();
        laden.catch(() => miniaturen.delete(schluessel));
        miniaturen.set(schluessel, laden);
    }
    return miniaturen.get(schluessel);
}

// Mini-Ansicht einer Vorlage: Beispiel-Urkunde, vom Server mit Beispieldaten gerendert.
const vorlagenMiniatur = turnierId => v =>
    pdfMiniatur(`/api/urkunden/vorlagen/${v.id}/vorschau?turnierId=${turnierId}`, `${v.id}:${v.updated_at ?? ''}`);

// Füllt container mit je einer Karte (Mini-Ansicht + Name) pro Vorlage; onWahl(id) beim Klick.
// miniatur(v) liefert die Data-URL des Vorschaubilds (Standard: Beispiel-Urkunde der Vorlage).
export function baueVorlagenRaster(container, { turnierId, vorlagen, ausgewaehlt, onWahl, miniatur = vorlagenMiniatur(turnierId) }) {
    stilEinmal();
    container.classList.add('urkunden-vorlagen-raster');
    container.innerHTML = vorlagen.map(v => `
        <button type="button" class="urkunden-vorlage-karte" data-vorlage-id="${v.id}" aria-pressed="${String(v.id) === String(ausgewaehlt)}">
            <span class="urkunden-vorlage-bild"><span class="material-icons" style="color: #999;">hourglass_empty</span></span>
            <span class="urkunden-vorlage-name">${escapeHtml(v.name)}</span>
        </button>`).join('');
    container.onclick = e => {
        const karte = e.target.closest('[data-vorlage-id]');
        const vorlage = karte && vorlagen.find(v => String(v.id) === karte.dataset.vorlageId);
        if (!vorlage) return;
        container.querySelectorAll('[data-vorlage-id]').forEach(k => k.setAttribute('aria-pressed', String(k === karte)));
        onWahl(vorlage.id);
    };
    vorlagen.forEach(async v => {
        const platz = container.querySelector(`[data-vorlage-id="${v.id}"] .urkunden-vorlage-bild`);
        try {
            const bild = new Image();
            bild.alt = '';
            bild.src = await miniatur(v);
            platz.replaceChildren(bild);
        } catch {
            platz.innerHTML = '<span class="material-icons" style="color: #999;">broken_image</span>';
        }
    });
}

// Kleines Popup zur Auswahl einer Vorlage; liefert die gewählte ID oder null (abgebrochen).
export function waehleVorlage({ turnierId, vorlagen, ausgewaehlt }) {
    return new Promise(resolve => {
        const modal = baueModal('urkundenVorlagenAuswahlModal', `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <h2 style="margin: 0; font-size: 18px;">Vorlage wählen</h2>
                <button type="button" class="btn btn-outlined" data-aktion="abbrechen">Abbrechen</button>
            </div>
            <div data-raster></div>
        `, '720px');
        const schliesse = id => { modal.remove(); resolve(id); };
        baueVorlagenRaster(modal.querySelector('[data-raster]'), { turnierId, vorlagen, ausgewaehlt, onWahl: schliesse });
        modal.querySelector('[data-aktion="abbrechen"]').addEventListener('click', () => schliesse(null));
        modal.addEventListener('click', e => { if (e.target === modal) schliesse(null); });
    });
}

const optionenHtml = (optionen, wert) => optionen
    .map(([v, text]) => `<option value="${v}" ${v === wert ? 'selected' : ''}>${text}</option>`).join('');
export const urkundenAnzahlText = n => `${n} Urkunde${n === 1 ? '' : 'n'}`;

// Nach "Pool abschließen": gibt es beim Ausrichter-Verein mindestens eine Vorlage, wird der Druck
// der Urkunden dieses Pools angeboten — mit Wahl von Vorlage, Platzierungen und Reihenfolge.
// Ohne Vorlage oder bei Fehlern passiert nichts; der Abschluss selbst ist davon unabhängig.
export async function bieteUrkundenNachAbschlussAn(turnierId, poolId, poolBezeichnung) {
    let angebot;
    try {
        const res = await fetch(`/api/urkunden/abschluss-angebot?turnierId=${turnierId}&poolId=${poolId}`);
        if (!res.ok) return;
        angebot = await res.json();
    } catch { return; }
    if (!angebot?.vorlagen?.length) return;

    const wahl = { vorlageId: vorausgewaehlteVorlage(angebot.vorlagen), platzbereich: '3', reihenfolge: 'absteigend' };
    const modal = baueModal('urkundenAngebotModal', `
        <div style="display: flex; align-items: center; gap: 12px;">
            <span class="material-icons" style="font-size: 28px; color: var(--primary);">workspace_premium</span>
            <h2 style="margin: 0; font-size: 18px;">Urkunden für ${escapeHtml(poolBezeichnung || 'diesen Pool')} drucken?</h2>
        </div>
        <div data-raster></div>
        <div class="urkunden-optionen">
            <label>Platzierungen <select data-feld="platzbereich">${optionenHtml(PLATZBEREICH_OPTIONEN, wahl.platzbereich)}</select></label>
            <label>Reihenfolge <select data-feld="reihenfolge">${optionenHtml(REIHENFOLGE_OPTIONEN, wahl.reihenfolge)}</select></label>
            <span data-anzahl style="margin-left: auto;"></span>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn btn-outlined" data-aktion="spaeter">Später</button>
            <button type="button" class="btn btn-raised" data-aktion="drucken">Drucken</button>
        </div>
    `, '760px');

    const drucken = modal.querySelector('[data-aktion="drucken"]');
    const aktualisiere = () => {
        const anzahl = angebot.anzahl?.[wahl.platzbereich] ?? 0;
        modal.querySelector('[data-anzahl]').textContent = urkundenAnzahlText(anzahl);
        drucken.disabled = !wahl.vorlageId || anzahl === 0;
    };
    baueVorlagenRaster(modal.querySelector('[data-raster]'), {
        turnierId, vorlagen: angebot.vorlagen, ausgewaehlt: wahl.vorlageId,
        onWahl: id => { wahl.vorlageId = id; aktualisiere(); }
    });
    modal.querySelectorAll('[data-feld]').forEach(select => select.addEventListener('change', () => {
        wahl[select.dataset.feld] = select.value;
        aktualisiere();
    }));
    aktualisiere();

    modal.querySelector('[data-aktion="spaeter"]').addEventListener('click', () => modal.remove());
    drucken.addEventListener('click', async () => {
        modal.remove();
        merkeVorlage(wahl.vorlageId);
        await zeigeUrkundenVorschau({
            turnierId,
            vorlageId: wahl.vorlageId,
            platzbereich: wahl.platzbereich,
            reihenfolge: wahl.reihenfolge,
            poolIds: [Number(poolId)]
        }, { autoDruck: true });
    });
}

window.hajimeUrkunden = { ...(window.hajimeUrkunden || {}), zeigeUrkundenVorschau, bieteUrkundenNachAbschlussAn };
