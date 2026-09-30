// Urkunden generieren: Vorlage (Auswahl-Popup mit Mini-Ansicht), Platzierungen, Reihenfolge und
// Pools wählen, Vorschau/Druck über urkundenDruck.js. Das zuletzt erzeugte PDF je Pool liegt am
// Server und lässt sich hier öffnen, neu erzeugen oder löschen. Vorlagen bearbeitet urkunden-designer.html.
import {
    zeigeUrkundenVorschau, zeigeGespeichertesPdf, waehleVorlage, vorausgewaehlteVorlage, merkeVorlage,
    PLATZBEREICH_OPTIONEN, REIHENFOLGE_OPTIONEN, urkundenAnzahlText
} from '/js/urkundenDruck.js';

const turnierId = new URLSearchParams(location.search).get('turnierId');
const $ = id => document.getElementById(id);

const state = { vorlagen: [], vorlageId: null, uebersicht: { pools: [] } };

function melde(text, typ = 'success') {
    if (window.zeigeNotification) window.zeigeNotification(text, typ);
    else if (typ === 'error') alert(text);
}

async function api(url) {
    const trenner = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${trenner}turnierId=${turnierId}`);
    if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        throw new Error(daten.error || `Fehler ${res.status}`);
    }
    return res.json();
}

const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function setzeVorlage(id) {
    const vorlage = state.vorlagen.find(v => v.id === id) || null;
    state.vorlageId = vorlage?.id ?? null;
    $('genVorlage').dataset.vorlageId = state.vorlageId ?? '';
    $('genVorlageName').textContent = vorlage?.name ?? '– keine Vorlage –';
    $('genFelderHinweis').style.display = vorlage && (vorlage.felder || []).length === 0 ? 'block' : 'none';
}

// Wählbar sind nur Pools, deren Plätze feststehen oder die abgeschlossen wurden (auch kampflos).
const istAbgeschlossen = p => p.abgeschlossen || p.status === 'abgeschlossen';

// gewaehlt: IDs der angehakten Pools; Standard sind die abgeschlossenen Pools.
function renderPoolListe(gewaehlt = new Set(state.uebersicht.pools.filter(p => p.status === 'abgeschlossen').map(p => p.id))) {
    const gruppen = [['einzel', 'Einzel'], ['mannschaft', 'Mannschaften']];
    $('genPoolListe').innerHTML = gruppen.map(([typ, titel]) => {
        const pools = state.uebersicht.pools.filter(p => p.typ === typ);
        if (pools.length === 0) return '';
        return `<h3>${titel}</h3>` + pools.map(p => `
            <div class="pool-eintrag${istAbgeschlossen(p) ? '' : ' gesperrt'}">
                <label>
                    <input type="checkbox" data-pool-id="${p.id}" ${istAbgeschlossen(p) ? (gewaehlt.has(p.id) ? 'checked' : '') : 'disabled'}>
                    <span>${escapeHtml(p.bezeichnung ?? `Pool ${p.id}`)}</span>
                    ${istAbgeschlossen(p) ? '' : '<span class="pool-hinweis">(noch nicht abgeschlossen)</span>'}
                </label>
                ${p.pdf ? pdfHtml(p) : ''}
            </div>`).join('');
    }).join('') || '<span>Keine Pools vorhanden.</span>';
    aktualisiereAnzahl();
}

const optionText = (optionen, wert) => optionen.find(([v]) => v === wert)?.[1] ?? wert;

function zeitText(iso) {
    const datum = new Date(iso);
    if (Number.isNaN(datum.getTime())) return '';
    return datum.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Markierung "PDF liegt vor" mit den Aktionen Öffnen, Neu erzeugen und Löschen.
function pdfHtml(pool) {
    const { pdf } = pool;
    const details = [
        urkundenAnzahlText(pdf.anzahl),
        `Platzierungen ${optionText(PLATZBEREICH_OPTIONEN, pdf.platzbereich)}`,
        optionText(REIHENFOLGE_OPTIONEN, pdf.reihenfolge),
        pdf.vorlage_name ? `Vorlage „${pdf.vorlage_name}“` : ''
    ].filter(Boolean).join(' · ');
    const knopf = (aktion, icon, titel) => `
        <button type="button" class="pool-pdf-knopf" data-pdf-aktion="${aktion}" title="${titel}" aria-label="${titel}">
            <span class="material-icons">${icon}</span>
        </button>`;
    return `
        <span class="pool-pdf" data-pool-pdf="${pool.id}" title="${escapeHtml(details)}">
            <span class="pool-pdf-marke"><span class="material-icons">picture_as_pdf</span>${escapeHtml(zeitText(pdf.erzeugt_am))}</span>
            ${knopf('oeffnen', 'visibility', 'PDF öffnen')}
            ${knopf('neu', 'refresh', 'PDF neu erzeugen')}
            ${knopf('loeschen', 'delete', 'PDF löschen')}
        </span>`;
}

// Lädt die Pool-Übersicht neu (nach Erzeugen/Löschen eines PDFs); die Auswahl bleibt erhalten.
async function ladeUebersichtNeu() {
    const gewaehlt = new Set(gewaehltePoolIds());
    state.uebersicht = await api('/api/urkunden/uebersicht');
    renderPoolListe(gewaehlt);
}

async function generiere(parameter) {
    if (await zeigeUrkundenVorschau({ turnierId, ...parameter })) await ladeUebersichtNeu();
}

async function pdfAktion(aktion, pool) {
    if (aktion === 'oeffnen') return zeigeGespeichertesPdf({ turnierId, poolId: pool.id });
    if (aktion === 'neu') {
        // Mit den Einstellungen des vorhandenen PDFs; gibt es dessen Vorlage nicht mehr, mit der gewählten.
        const vorlageId = state.vorlagen.some(v => v.id === pool.pdf.vorlage_id) ? pool.pdf.vorlage_id : state.vorlageId;
        if (!vorlageId) return melde('Bitte eine Vorlage wählen.', 'error');
        return generiere({ vorlageId, platzbereich: pool.pdf.platzbereich, reihenfolge: pool.pdf.reihenfolge, poolIds: [pool.id] });
    }
    if (!confirm(`Urkunden-PDF für „${pool.bezeichnung ?? `Pool ${pool.id}`}“ löschen?`)) return;
    const res = await fetch(`/api/urkunden/pools/${pool.id}/pdf?turnierId=${turnierId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        const daten = await res.json().catch(() => ({}));
        throw new Error(daten.error || `Fehler ${res.status}`);
    }
    await ladeUebersichtNeu();
}

const gewaehltePoolIds = () => [...document.querySelectorAll('#genPoolListe input[data-pool-id]:checked')].map(i => Number(i.dataset.poolId));

function aktualisiereAnzahl() {
    const bereich = $('genPlatzbereich').value;
    const ids = new Set(gewaehltePoolIds());
    const summe = state.uebersicht.pools.filter(p => ids.has(p.id)).reduce((s, p) => s + (p.anzahl[bereich] || 0), 0);
    $('genAnzahl').textContent = `≈ ${urkundenAnzahlText(summe)}`;
}

async function start() {
    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        location.href = '/turniere.html';
        return;
    }
    $('linkDesigner').href = `/urkunden-designer.html?turnierId=${turnierId}`;
    $('genPlatzbereich').innerHTML = PLATZBEREICH_OPTIONEN.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    $('genReihenfolge').innerHTML = REIHENFOLGE_OPTIONEN.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');

    $('genVorlage').addEventListener('click', async () => {
        if (state.vorlagen.length === 0) return melde('Es gibt noch keine Vorlage.', 'error');
        const id = await waehleVorlage({ turnierId, vorlagen: state.vorlagen, ausgewaehlt: state.vorlageId });
        if (id) setzeVorlage(id);
    });
    $('genPlatzbereich').addEventListener('change', aktualisiereAnzahl);
    $('genPoolListe').addEventListener('change', aktualisiereAnzahl);
    $('genPoolListe').addEventListener('click', e => {
        const knopf = e.target.closest('[data-pdf-aktion]');
        if (!knopf) return;
        const poolId = Number(knopf.closest('[data-pool-pdf]').dataset.poolPdf);
        const pool = state.uebersicht.pools.find(p => p.id === poolId);
        if (pool?.pdf) pdfAktion(knopf.dataset.pdfAktion, pool).catch(fehler => melde(fehler.message, 'error'));
    });
    $('btnGenerieren').addEventListener('click', () => {
        if (!state.vorlageId) return melde('Bitte eine Vorlage wählen.', 'error');
        merkeVorlage(state.vorlageId);
        generiere({
            vorlageId: state.vorlageId,
            platzbereich: $('genPlatzbereich').value,
            reihenfolge: $('genReihenfolge').value,
            poolIds: gewaehltePoolIds()
        }).catch(fehler => melde(fehler.message, 'error'));
    });

    const [vorlagen, uebersicht] = await Promise.all([api('/api/urkunden/vorlagen'), api('/api/urkunden/uebersicht')]);
    state.vorlagen = vorlagen;
    state.uebersicht = uebersicht;
    $('keineVorlageHinweis').style.display = vorlagen.length === 0 ? 'block' : 'none';
    setzeVorlage(vorausgewaehlteVorlage(vorlagen));
    renderPoolListe();
}

start().catch(e => melde(e.message, 'error'));
