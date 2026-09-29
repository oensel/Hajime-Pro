// Urkunden-Seite: Vorlagen-Editor (pdf.js rendert Seite 1 als Hintergrund eines Fabric-Canvas,
// Felder als einzeilige Textboxen) und Generieren (Vorschau über urkundenDruck.js).
// Koordinaten der Felder in pt, Ursprung oben links — Umrechnung über state.scale (px pro pt).
import { URKUNDEN_SCHRIFTEN, STANDARD_SCHRIFT_ID } from '/js/shared/urkundenSchriften.js';
import { ersetzePlatzhalter, passeGroesseAn, PLATZHALTER } from '/js/shared/urkundenText.js';
import { zeigeUrkundenVorschau } from '/js/urkundenDruck.js';

const fabric = window.fabric;
const turnierId = new URLSearchParams(location.search).get('turnierId');
const $ = id => document.getElementById(id);
const AUSRICHTUNG_FABRIC = { links: 'left', zentriert: 'center', rechts: 'right' };

const state = {
    vorlagen: [],
    vorlage: null,
    felder: [],
    scale: 1,
    canvas: null,
    hintergrund: null,
    beispiel: {},
    uebersicht: { pools: [] },
    ausgewaehlt: null,
    geaendert: false
};

const messCtx = document.createElement('canvas').getContext('2d');
const misstBreite = schrift => (text, groesse) => {
    messCtx.font = `${groesse}px "${schrift}"`;
    return messCtx.measureText(text).width;
};

function melde(text, typ = 'success') {
    if (window.zeigeNotification) window.zeigeNotification(text, typ);
    else if (typ === 'error') alert(text);
}

async function api(url, optionen = {}) {
    const trenner = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${trenner}turnierId=${turnierId}`, {
        ...optionen,
        headers: optionen.body ? { 'Content-Type': 'application/json' } : undefined,
        body: optionen.body ? JSON.stringify({ turnierId, ...optionen.body }) : undefined
    });
    if (!res.ok) {
        const daten = await res.json().catch(() => ({}));
        throw new Error(daten.error || `Fehler ${res.status}`);
    }
    return res;
}

// --- Schriften ---
async function ladeSchriften() {
    await Promise.all(URKUNDEN_SCHRIFTEN.map(async s => {
        const face = new FontFace(s.id, `url(/fonts/urkunden/${s.datei})`);
        document.fonts.add(await face.load());
    }));
    $('feldSchrift').innerHTML = URKUNDEN_SCHRIFTEN.map(s => `<option value="${s.id}">${s.anzeigename}</option>`).join('');
}

// --- Vorlagen-Liste ---
function fuelleAuswahl(select, ausgewaehlteId) {
    select.innerHTML = state.vorlagen.length === 0
        ? '<option value="">– keine Vorlage –</option>'
        : state.vorlagen.map(v => `<option value="${v.id}">${v.name.replace(/</g, '&lt;')}</option>`).join('');
    if (ausgewaehlteId) select.value = String(ausgewaehlteId);
}

async function ladeVorlagen(ausgewaehlteId) {
    state.vorlagen = await (await api('/api/urkunden/vorlagen')).json();
    const id = ausgewaehlteId || state.vorlage?.id || state.vorlagen[0]?.id;
    fuelleAuswahl($('vorlagenAuswahl'), id);
    fuelleAuswahl($('genVorlage'), $('genVorlage').value || id);
    uebernehmeGenVoreinstellungen();
    if (id) await zeigeVorlage(Number(id));
    else leereEditor();
}

function leereEditor() {
    state.vorlage = null;
    state.felder = [];
    state.canvas?.clear();
    $('editorLeer').style.display = 'block';
    waehleFeld(null);
}

// --- Editor ---
async function renderHintergrund() {
    const pdfjs = await import('/js/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.mjs';
    const res = await api(`/api/urkunden/vorlagen/${state.vorlage.id}/pdf`);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
    return pdf.getPage(1);
}

async function zeigeVorlage(id) {
    if (state.geaendert && !confirm('Ungespeicherte Änderungen verwerfen?')) {
        $('vorlagenAuswahl').value = String(state.vorlage.id);
        return;
    }
    state.vorlage = state.vorlagen.find(v => v.id === id);
    if (!state.vorlage) return leereEditor();
    state.felder = structuredClone(state.vorlage.felder || []);
    state.hintergrund = await renderHintergrund();
    $('vorlagePlatzbereich').value = state.vorlage.platzbereich;
    $('vorlageReihenfolge').value = state.vorlage.reihenfolge;
    $('vorlageBeiAbschluss').checked = !!state.vorlage.bei_abschluss_anbieten;
    $('editorLeer').style.display = 'none';
    await baueCanvas();
    state.geaendert = false;
}

async function baueCanvas() {
    const breitePx = $('editorContainer').clientWidth - 2;
    state.scale = breitePx / state.vorlage.seiten_breite_pt;
    // Das PDF liegt als CSS-Hintergrund unter der Fabric-Ebene (unabhängig von Fabrics
    // Retina-Skalierung), gerendert in Geräteauflösung für scharfe Darstellung.
    const dpr = window.devicePixelRatio || 1;
    const viewport = state.hintergrund.getViewport({ scale: state.scale * dpr });
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(viewport.width);
    offscreen.height = Math.round(viewport.height);
    await state.hintergrund.render({ canvasContext: offscreen.getContext('2d'), viewport }).promise;
    const breite = Math.round(viewport.width / dpr);
    const hoehe = Math.round(viewport.height / dpr);

    if (!state.canvas) {
        state.canvas = new fabric.Canvas('urkundenCanvas', { selection: false, preserveObjectStacking: true });
        state.canvas.on('selection:created', e => waehleFeld(e.selected?.[0]?.feldId));
        state.canvas.on('selection:updated', e => waehleFeld(e.selected?.[0]?.feldId));
        state.canvas.on('selection:cleared', () => waehleFeld(null));
        state.canvas.on('object:modified', e => uebernehmeObjekt(e.target));
    }
    state.canvas.clear();
    state.canvas.setDimensions({ width: breite, height: hoehe });
    Object.assign(state.canvas.wrapperEl.style, {
        backgroundImage: `url(${offscreen.toDataURL('image/png')})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
    });
    state.felder.forEach(feld => state.canvas.add(baueObjekt(feld)));
    state.canvas.requestRenderAll();
}

function anzeige(feld) {
    if (!$('schalterBeispiel').checked) return { text: feld.text, groesse: feld.groesse };
    const text = ersetzePlatzhalter(feld.text, state.beispiel);
    return { text, groesse: passeGroesseAn(text, feld.groesse, feld.breite, misstBreite(feld.schrift)).groesse };
}

function objektEigenschaften(feld) {
    const { text, groesse } = anzeige(feld);
    return {
        text,
        left: feld.x * state.scale,
        top: feld.y * state.scale,
        width: feld.breite * state.scale,
        fontSize: groesse * state.scale,
        fontFamily: feld.schrift,
        fill: feld.farbe,
        textAlign: AUSRICHTUNG_FABRIC[feld.ausrichtung]
    };
}

function baueObjekt(feld) {
    const { text, ...eigenschaften } = objektEigenschaften(feld);
    const obj = new fabric.Textbox(text, {
        ...eigenschaften,
        originX: 'left',
        originY: 'top',
        lineHeight: 1,
        editable: false,
        lockRotation: true,
        lockScalingY: true,
        splitByGrapheme: false,
        borderColor: '#1565c0',
        cornerColor: '#1565c0',
        transparentCorners: false
    });
    obj.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false, mtr: false });
    obj.feldId = feld.id;
    return obj;
}

const objektZu = id => state.canvas?.getObjects().find(o => o.feldId === id);
const feldZu = id => state.felder.find(f => f.id === id);
const runde = z => Math.round(z * 10) / 10;

function uebernehmeObjekt(obj) {
    const feld = feldZu(obj.feldId);
    if (!feld) return;
    const breite = obj.width * (obj.scaleX || 1);
    obj.set({ width: breite, scaleX: 1, scaleY: 1 });
    feld.x = Math.max(0, runde(obj.left / state.scale));
    feld.y = Math.max(0, runde(obj.top / state.scale));
    feld.breite = runde(breite / state.scale);
    state.geaendert = true;
}

function aktualisiereObjekt(feld) {
    const obj = objektZu(feld.id);
    if (!obj) return;
    obj.set(objektEigenschaften(feld));
    obj.setCoords();
    state.canvas.requestRenderAll();
}

function waehleFeld(id) {
    state.ausgewaehlt = id ? feldZu(id) : null;
    const feld = state.ausgewaehlt;
    $('werkzeugleiste').setAttribute('aria-disabled', feld ? 'false' : 'true');
    if (!feld) return;
    $('feldText').value = feld.text;
    $('feldSchrift').value = feld.schrift;
    $('feldGroesse').value = feld.groesse;
    $('feldFarbe').value = feld.farbe;
    $('feldAusrichtung').value = feld.ausrichtung;
}

function aendereFeld(aenderung) {
    const feld = state.ausgewaehlt;
    if (!feld) return;
    Object.assign(feld, aenderung);
    state.geaendert = true;
    aktualisiereObjekt(feld);
}

function neuesFeld(text) {
    if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
    const breite = Math.round(state.vorlage.seiten_breite_pt * 0.6);
    const feld = {
        id: `f${Date.now().toString(36)}`,
        text,
        x: runde((state.vorlage.seiten_breite_pt - breite) / 2),
        y: runde(state.vorlage.seiten_hoehe_pt / 2),
        breite,
        schrift: STANDARD_SCHRIFT_ID,
        groesse: 24,
        farbe: '#1a1a1a',
        ausrichtung: 'zentriert'
    };
    state.felder.push(feld);
    const obj = baueObjekt(feld);
    state.canvas.add(obj);
    state.canvas.setActiveObject(obj);
    waehleFeld(feld.id);
    state.geaendert = true;
}

async function speichern() {
    if (!state.vorlage) return;
    try {
        await api(`/api/urkunden/vorlagen/${state.vorlage.id}`, {
            method: 'PUT',
            body: {
                felder: state.felder,
                platzbereich: $('vorlagePlatzbereich').value,
                reihenfolge: $('vorlageReihenfolge').value,
                bei_abschluss_anbieten: $('vorlageBeiAbschluss').checked
            }
        });
        state.geaendert = false;
        melde('Vorlage gespeichert.');
        await ladeVorlagen(state.vorlage.id);
    } catch (e) { melde(e.message, 'error'); }
}

// --- Vorlagen-Verwaltung ---
function leseDatei(datei) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(datei);
    });
}

async function neueVorlage(datei) {
    const name = prompt('Name der neuen Vorlage:', datei.name.replace(/\.pdf$/i, ''));
    if (!name) return;
    try {
        const res = await api('/api/urkunden/vorlagen', {
            method: 'POST',
            body: { name, pdf_base64: await leseDatei(datei), pdf_dateiname: datei.name }
        });
        state.geaendert = false;
        await ladeVorlagen((await res.json()).id);
    } catch (e) { melde(e.message, 'error'); }
}

async function vorlagenAktion(aktion) {
    const v = state.vorlage;
    if (!v) return;
    try {
        if (aktion === 'duplizieren') {
            const name = prompt('Name der Kopie:', `${v.name} (Kopie)`);
            if (!name) return;
            const res = await api(`/api/urkunden/vorlagen/${v.id}/duplizieren`, { method: 'POST', body: { name } });
            state.geaendert = false;
            await ladeVorlagen((await res.json()).id);
        } else if (aktion === 'umbenennen') {
            const name = prompt('Neuer Name:', v.name);
            if (!name) return;
            await api(`/api/urkunden/vorlagen/${v.id}`, { method: 'PUT', body: { name } });
            await ladeVorlagen(v.id);
        } else if (aktion === 'loeschen') {
            if (!confirm(`Vorlage „${v.name}“ löschen?`)) return;
            await api(`/api/urkunden/vorlagen/${v.id}`, { method: 'DELETE' });
            state.vorlage = null;
            state.geaendert = false;
            await ladeVorlagen();
        }
    } catch (e) { melde(e.message, 'error'); }
}

// --- Generieren ---
function uebernehmeGenVoreinstellungen() {
    const v = state.vorlagen.find(x => String(x.id) === $('genVorlage').value);
    if (!v) return;
    $('genPlatzbereich').value = v.platzbereich;
    $('genReihenfolge').value = v.reihenfolge;
    $('genFelderHinweis').style.display = (v.felder || []).length === 0 ? 'block' : 'none';
    aktualisiereAnzahl();
}

function renderPoolListe() {
    const gruppen = [['einzel', 'Einzel'], ['mannschaft', 'Mannschaften']];
    $('genPoolListe').innerHTML = gruppen.map(([typ, titel]) => {
        const pools = state.uebersicht.pools.filter(p => p.typ === typ);
        if (pools.length === 0) return '';
        return `<h3>${titel}</h3>` + pools.map(p => `
            <label>
                <input type="checkbox" data-pool-id="${p.id}" ${p.status === 'abgeschlossen' ? 'checked' : ''}>
                ${String(p.bezeichnung ?? `Pool ${p.id}`).replace(/</g, '&lt;')}
                ${p.abgeschlossen ? '' : '<span class="pool-hinweis">(noch nicht abgeschlossen)</span>'}
            </label>`).join('');
    }).join('') || '<span>Keine Pools vorhanden.</span>';
    aktualisiereAnzahl();
}

const gewaehltePoolIds = () => [...document.querySelectorAll('#genPoolListe input[data-pool-id]:checked')].map(i => Number(i.dataset.poolId));

function aktualisiereAnzahl() {
    const bereich = $('genPlatzbereich').value;
    const ids = new Set(gewaehltePoolIds());
    const summe = state.uebersicht.pools.filter(p => ids.has(p.id)).reduce((s, p) => s + (p.anzahl[bereich] || 0), 0);
    $('genAnzahl').textContent = `≈ ${summe} Urkunde${summe === 1 ? '' : 'n'}`;
}

async function ladeUebersicht() {
    state.uebersicht = await (await api('/api/urkunden/uebersicht')).json();
    state.beispiel = state.uebersicht.beispiel || {};
    renderPoolListe();
}

// --- Start ---
async function start() {
    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        location.href = '/turniere.html';
        return;
    }
    const config = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
    $('hallenHinweis').style.display = config.isOffline && config.syncRolle !== 'client' ? 'block' : 'none';

    $('platzhalterKnoepfe').innerHTML = '<label>Platzhalter einfügen</label>' + PLATZHALTER
        .map(p => `<button type="button" class="btn btn-outlined platzhalter-btn" data-platzhalter="${p}">{${p}}</button>`).join('');

    await ladeSchriften();
    await ladeUebersicht();
    await ladeVorlagen();

    $('vorlagenAuswahl').addEventListener('change', e => zeigeVorlage(Number(e.target.value)));
    $('btnVorlageNeu').addEventListener('click', () => $('vorlageDatei').click());
    $('vorlageDatei').addEventListener('change', e => {
        const datei = e.target.files[0];
        e.target.value = '';
        if (datei) neueVorlage(datei);
    });
    $('btnVorlageDuplizieren').addEventListener('click', () => vorlagenAktion('duplizieren'));
    $('btnVorlageUmbenennen').addEventListener('click', () => vorlagenAktion('umbenennen'));
    $('btnVorlageLoeschen').addEventListener('click', () => vorlagenAktion('loeschen'));
    $('btnFeldPlatzhalter').addEventListener('click', () => neuesFeld('{Name}'));
    $('btnFeldText').addEventListener('click', () => neuesFeld('Text'));
    $('btnVorlageSpeichern').addEventListener('click', speichern);
    ['vorlagePlatzbereich', 'vorlageReihenfolge', 'vorlageBeiAbschluss'].forEach(id =>
        $(id).addEventListener('change', () => { state.geaendert = true; }));

    $('feldText').addEventListener('input', e => aendereFeld({ text: e.target.value }));
    $('feldSchrift').addEventListener('change', e => aendereFeld({ schrift: e.target.value }));
    $('feldGroesse').addEventListener('change', e => {
        const g = Math.min(200, Math.max(4, Number(e.target.value) || 24));
        aendereFeld({ groesse: g });
    });
    $('feldFarbe').addEventListener('input', e => aendereFeld({ farbe: e.target.value }));
    $('feldAusrichtung').addEventListener('change', e => aendereFeld({ ausrichtung: e.target.value }));
    $('btnFeldZentrieren').addEventListener('click', () => {
        const feld = state.ausgewaehlt;
        if (feld) aendereFeld({ x: runde((state.vorlage.seiten_breite_pt - feld.breite) / 2) });
    });
    $('btnFeldLoeschen').addEventListener('click', () => {
        const feld = state.ausgewaehlt;
        if (!feld) return;
        state.felder = state.felder.filter(f => f.id !== feld.id);
        state.canvas.remove(objektZu(feld.id));
        state.canvas.discardActiveObject();
        waehleFeld(null);
        state.geaendert = true;
    });
    $('platzhalterKnoepfe').addEventListener('click', e => {
        const knopf = e.target.closest('[data-platzhalter]');
        if (!knopf || !state.ausgewaehlt) return;
        const input = $('feldText');
        const pos = input.selectionStart ?? input.value.length;
        const einfuegen = `{${knopf.dataset.platzhalter}}`;
        input.value = input.value.slice(0, pos) + einfuegen + input.value.slice(input.selectionEnd ?? pos);
        aendereFeld({ text: input.value });
        input.focus();
        input.setSelectionRange(pos + einfuegen.length, pos + einfuegen.length);
    });
    $('schalterBeispiel').addEventListener('change', () => state.felder.forEach(aktualisiereObjekt));

    $('genVorlage').addEventListener('change', uebernehmeGenVoreinstellungen);
    $('genPlatzbereich').addEventListener('change', aktualisiereAnzahl);
    $('genPoolListe').addEventListener('change', aktualisiereAnzahl);
    $('btnGenerieren').addEventListener('click', () => {
        const vorlageId = Number($('genVorlage').value);
        if (!vorlageId) return melde('Bitte eine Vorlage wählen.', 'error');
        zeigeUrkundenVorschau({
            turnierId,
            vorlageId,
            platzbereich: $('genPlatzbereich').value,
            reihenfolge: $('genReihenfolge').value,
            poolIds: gewaehltePoolIds()
        });
    });

    window.addEventListener('beforeunload', e => {
        if (state.geaendert) e.preventDefault();
    });
    let breiteVorher = $('editorContainer').clientWidth;
    let timer;
    window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const breite = $('editorContainer').clientWidth;
            if (state.vorlage && breite !== breiteVorher) {
                breiteVorher = breite;
                baueCanvas();
            }
        }, 200);
    });
}

start().catch(e => melde(e.message, 'error'));
