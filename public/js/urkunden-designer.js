// Urkunden-Designer: pdf.js rendert Seite 1 der Vorlage als Hintergrund eines Fabric-Canvas, darauf
// einzeilige Textfelder (Textbox), waagerechte Linien (Line) und Bilder (FabricImage). Koordinaten der Felder in pt,
// Ursprung oben links — Umrechnung über state.scale (px pro pt). Generiert wird auf urkunden.html.
import {
    URKUNDEN_SCHRIFTEN, STANDARD_SCHRIFT_ID, SCHRIFT_FAMILIEN, SCHRIFT_STILE, findeSchrift, stileDerFamilie, schriftFuer
} from '/js/shared/urkundenSchriften.js';
import { ersetzePlatzhalter, passeGroesseAn, PLATZHALTER } from '/js/shared/urkundenText.js';
import { LINIEN_STILE, linienMuster, istLinie } from '/js/shared/urkundenLinien.js';
import { URKUNDEN_RAHMEN } from '/js/shared/urkundenRahmen.js';
import { baueModal, baueVorlagenRaster, pdfMiniatur } from '/js/urkundenDruck.js';

const fabric = window.fabric;
const turnierId = new URLSearchParams(location.search).get('turnierId');
const $ = id => document.getElementById(id);
const AUSRICHTUNG_FABRIC = { links: 'left', zentriert: 'center', rechts: 'right' };
const AUSWAHL_STIL = { borderColor: '#1565c0', cornerColor: '#1565c0', transparentCorners: false };
const MAX_BILD_BYTES = 2 * 1024 * 1024;
const istBild = feld => feld?.typ === 'bild';

const state = {
    vorlagen: [],
    vorlage: null,
    felder: [],
    scale: 1,
    canvas: null,
    hintergrund: null,
    beispiel: {},
    ausgewaehlt: null,
    bilder: new Map(), // bild_id → geladenes <img>
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
    $('feldSchrift').innerHTML = SCHRIFT_FAMILIEN.map(f => `<option value="${f}">${f}</option>`).join('');
}

// Schriftart (Familie) und Stil aus der gespeicherten Schrift-ID; Stile, die es in der Familie
// nicht gibt, sind gesperrt (Auswahl ganz gesperrt, wenn es nur einen Schnitt gibt).
function zeigeSchrift(schriftId) {
    const schrift = findeSchrift(schriftId) || findeSchrift(STANDARD_SCHRIFT_ID);
    const vorhanden = stileDerFamilie(schrift.familie);
    $('feldSchrift').value = schrift.familie;
    $('feldStil').innerHTML = SCHRIFT_STILE
        .map(s => `<option value="${s.id}" ${vorhanden.includes(s.id) ? '' : 'disabled'}>${s.anzeigename}</option>`).join('');
    $('feldStil').value = schrift.stil;
    $('feldStil').disabled = vorhanden.length < 2;
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

function ladeBildElement(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
        img.src = url;
    });
}

// Bilder vorab laden, damit die Fabric-Objekte synchron gebaut werden können.
async function ladeBilder() {
    state.bilder = new Map();
    const ids = [...new Set(state.felder.filter(istBild).map(f => f.bild_id))];
    await Promise.all(ids.map(async id => {
        try {
            state.bilder.set(id, await ladeBildElement(`/api/urkunden/vorlagen/${state.vorlage.id}/bilder/${id}?turnierId=${turnierId}`));
        } catch { /* fehlendes Bild: Feld wird nicht angezeigt */ }
    }));
}

async function zeigeVorlage(id) {
    if (state.geaendert && !confirm('Ungespeicherte Änderungen verwerfen?')) {
        $('vorlagenAuswahl').value = String(state.vorlage.id);
        return;
    }
    state.vorlage = state.vorlagen.find(v => v.id === id);
    if (!state.vorlage) return leereEditor();
    state.felder = structuredClone(state.vorlage.felder || []);
    try {
        state.hintergrund = await renderHintergrund();
        await ladeBilder();
        $('editorLeer').style.display = 'none';
        await baueCanvas();
        state.geaendert = false;
    } catch (e) {
        // Ohne Meldung bliebe der Editor stumm leer (z.B. wenn der Browser pdf.js nicht ausführen kann).
        console.error('[Urkunden-Designer] Vorlage konnte nicht angezeigt werden:', e);
        melde(`Die Vorlage konnte nicht angezeigt werden: ${e.message}`, 'error');
    }
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
    state.felder.map(baueObjekt).filter(Boolean).forEach(obj => state.canvas.add(obj));
    state.canvas.requestRenderAll();
}

function anzeige(feld) {
    if (!$('schalterBeispiel').checked) return { text: feld.text, groesse: feld.groesse };
    const text = ersetzePlatzhalter(feld.text, state.beispiel);
    return { text, groesse: passeGroesseAn(text, feld.groesse, feld.breite, misstBreite(feld.schrift)).groesse };
}

function textEigenschaften(feld) {
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

function baueTextObjekt(feld) {
    const { text, ...eigenschaften } = textEigenschaften(feld);
    const obj = new fabric.Textbox(text, {
        ...eigenschaften,
        ...AUSWAHL_STIL,
        originX: 'left',
        originY: 'top',
        lineHeight: 1,
        editable: false,
        lockRotation: true,
        lockScalingY: true,
        splitByGrapheme: false
    });
    obj.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false, mtr: false });
    return obj;
}

// Linie von x bis x+breite auf Höhe y (Mitte). Mit strokeUniform bleibt die Strichstärke beim
// Ziehen gleich; die Breite wird nach dem Ziehen aus width × scaleX übernommen (uebernehmeObjekt).
function baueLinienObjekt(feld) {
    const s = state.scale;
    const { muster, kappe } = linienMuster(feld.stil, feld.staerke);
    const obj = new fabric.Line([0, 0, feld.breite * s, 0], {
        ...AUSWAHL_STIL,
        left: feld.x * s - (feld.staerke * s) / 2,
        top: feld.y * s,
        originX: 'left',
        originY: 'center',
        stroke: feld.farbe,
        strokeWidth: feld.staerke * s,
        strokeDashArray: muster ? muster.map(m => m * s) : null,
        strokeLineCap: kappe,
        strokeUniform: true,
        padding: 6,
        lockRotation: true,
        lockScalingY: true,
        hasBorders: true
    });
    obj.setControlsVisibility({ mt: false, mb: false, tl: false, tr: false, bl: false, br: false, mtr: false });
    return obj;
}

// Bild im Rahmen x/y/breite/hoehe; Größe nur über die Ecken (Seitenverhältnis bleibt).
function baueBildObjekt(feld) {
    const img = state.bilder.get(feld.bild_id);
    if (!img) return null;
    const s = state.scale;
    const obj = new fabric.FabricImage(img, {
        ...AUSWAHL_STIL,
        left: feld.x * s,
        top: feld.y * s,
        originX: 'left',
        originY: 'top',
        scaleX: (feld.breite * s) / img.naturalWidth,
        scaleY: (feld.hoehe * s) / img.naturalHeight,
        lockRotation: true,
        lockSkewingX: true,
        lockSkewingY: true
    });
    obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
    return obj;
}

function baueObjekt(feld) {
    const obj = istBild(feld) ? baueBildObjekt(feld) : istLinie(feld) ? baueLinienObjekt(feld) : baueTextObjekt(feld);
    if (obj) obj.feldId = feld.id;
    return obj;
}

const objektZu = id => state.canvas?.getObjects().find(o => o.feldId === id);
const feldZu = id => state.felder.find(f => f.id === id);
const runde = z => Math.round(z * 10) / 10;

function uebernehmeObjekt(obj) {
    const feld = feldZu(obj.feldId);
    if (!feld) return;
    const breite = obj.width * (obj.scaleX || 1);
    if (istBild(feld)) {
        feld.x = Math.max(0, runde(obj.left / state.scale));
        feld.y = Math.max(0, runde(obj.top / state.scale));
        feld.breite = runde(breite / state.scale);
        feld.hoehe = runde((obj.height * (obj.scaleY || 1)) / state.scale);
        state.geaendert = true;
        return;
    }
    if (istLinie(feld)) {
        feld.x = Math.max(0, runde(obj.left / state.scale + feld.staerke / 2));
        feld.y = Math.max(0, runde(obj.top / state.scale));
        feld.breite = runde(breite / state.scale);
        state.geaendert = true;
        ersetzeObjekt(feld);
        return;
    }
    obj.set({ width: breite, scaleX: 1, scaleY: 1 });
    feld.x = Math.max(0, runde(obj.left / state.scale));
    feld.y = Math.max(0, runde(obj.top / state.scale));
    feld.breite = runde(breite / state.scale);
    state.geaendert = true;
}

// Linien werden bei jeder Änderung neu aufgebaut (Fabric.Line richtet sich beim Ändern der
// Endpunkte neu um die Mitte aus); die Auswahl bleibt erhalten.
function ersetzeObjekt(feld) {
    const alt = objektZu(feld.id);
    if (!alt) return;
    const aktiv = state.canvas.getActiveObject() === alt;
    const index = state.canvas.getObjects().indexOf(alt);
    const neu = baueObjekt(feld);
    if (!neu) return;
    state.canvas.remove(alt);
    state.canvas.insertAt(index, neu);
    if (aktiv) state.canvas.setActiveObject(neu);
    state.canvas.requestRenderAll();
}

function aktualisiereObjekt(feld) {
    if (istLinie(feld) || istBild(feld)) return ersetzeObjekt(feld);
    const obj = objektZu(feld.id);
    if (!obj) return;
    obj.set(textEigenschaften(feld));
    obj.setCoords();
    state.canvas.requestRenderAll();
}

function waehleFeld(id) {
    state.ausgewaehlt = id ? feldZu(id) : null;
    const feld = state.ausgewaehlt;
    $('werkzeugleiste').setAttribute('aria-disabled', feld ? 'false' : 'true');
    const linie = istLinie(feld);
    const bild = istBild(feld);
    $('textWerkzeuge').style.display = linie || bild ? 'none' : 'block';
    $('linienWerkzeuge').style.display = linie ? 'grid' : 'none';
    $('farbeWerkzeug').style.display = bild ? 'none' : 'grid';
    if (!feld || bild) return;
    $('feldFarbe').value = feld.farbe;
    if (linie) {
        $('linieStil').value = feld.stil;
        $('linieStaerke').value = feld.staerke;
        return;
    }
    $('feldText').value = feld.text;
    zeigeSchrift(feld.schrift);
    $('feldGroesse').value = feld.groesse;
    $('feldAusrichtung').value = feld.ausrichtung;
}

function aendereFeld(aenderung) {
    const feld = state.ausgewaehlt;
    if (!feld) return;
    Object.assign(feld, aenderung);
    state.geaendert = true;
    aktualisiereObjekt(feld);
}

function fuegeHinzu(feld) {
    if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
    const obj = baueObjekt(feld);
    if (!obj) return;
    state.felder.push(feld);
    state.canvas.add(obj);
    state.canvas.setActiveObject(obj);
    waehleFeld(feld.id);
    state.geaendert = true;
}

const neueId = () => `f${Date.now().toString(36)}`;

function neuesTextFeld(text) {
    if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
    const breite = Math.round(state.vorlage.seiten_breite_pt * 0.6);
    fuegeHinzu({
        id: neueId(),
        typ: 'text',
        text,
        x: runde((state.vorlage.seiten_breite_pt - breite) / 2),
        y: runde(state.vorlage.seiten_hoehe_pt / 2),
        breite,
        schrift: STANDARD_SCHRIFT_ID,
        groesse: 24,
        farbe: '#1a1a1a',
        ausrichtung: 'zentriert'
    });
}

function neueLinie() {
    if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
    const breite = Math.round(state.vorlage.seiten_breite_pt * 0.5);
    fuegeHinzu({
        id: neueId(),
        typ: 'linie',
        x: runde((state.vorlage.seiten_breite_pt - breite) / 2),
        y: runde(state.vorlage.seiten_hoehe_pt * 0.6),
        breite,
        staerke: 1,
        stil: 'durchgezogen',
        farbe: '#1a1a1a'
    });
}

// pdf-lib kann kein GIF einbetten: GIFs werden hier in PNG umgewandelt (Canvas mit Alphakanal,
// transparente Pixel bleiben transparent; bei animierten GIFs zählt das erste Bild).
async function gifAlsPng(datei) {
    const url = URL.createObjectURL(datei);
    try {
        const img = await ladeBildElement(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
    } finally {
        URL.revokeObjectURL(url);
    }
}

// Lädt das Bild sofort zur Vorlage hoch (bleibt nur beim Speichern mit Bildfeld erhalten) und
// setzt es oben mittig mit höchstens 150 pt Breite bzw. Höhe ein.
async function neuesBild(datei) {
    if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
    if (!['image/png', 'image/jpeg', 'image/gif'].includes(datei.type)) return melde('Nur PNG-, JPEG- und GIF-Bilder werden unterstützt.', 'error');
    if (datei.size > MAX_BILD_BYTES) return melde('Ein Bild darf höchstens 2 MB groß sein.', 'error');
    try {
        const gif = datei.type === 'image/gif';
        const daten = gif ? await gifAlsPng(datei) : await leseDatei(datei);
        const typ = gif ? 'image/png' : datei.type;
        const res = await api(`/api/urkunden/vorlagen/${state.vorlage.id}/bilder`, { method: 'POST', body: { daten_base64: daten } });
        const { bild_id: bildId } = await res.json();
        const img = await ladeBildElement(`data:${typ};base64,${daten}`);
        state.bilder.set(bildId, img);
        const faktor = Math.min(150 / img.naturalWidth, 150 / img.naturalHeight, 1);
        const breite = runde(Math.min(img.naturalWidth * faktor, state.vorlage.seiten_breite_pt));
        const hoehe = runde(img.naturalHeight * (breite / img.naturalWidth));
        fuegeHinzu({
            id: neueId(),
            typ: 'bild',
            bild_id: bildId,
            x: runde((state.vorlage.seiten_breite_pt - breite) / 2),
            y: runde(Math.min(60, Math.max(0, state.vorlage.seiten_hoehe_pt - hoehe))),
            breite,
            hoehe
        });
    } catch (e) { melde(e.message, 'error'); }
}

async function speichern() {
    if (!state.vorlage) return;
    try {
        await api(`/api/urkunden/vorlagen/${state.vorlage.id}`, { method: 'PUT', body: { felder: state.felder } });
        state.geaendert = false;
        // Kein Neuladen/Neurendern: der Editor hält bereits den gespeicherten Stand; ein
        // asynchrones Neuladen würde währenddessen hinzugefügte Felder wieder überschreiben.
        state.vorlage.felder = structuredClone(state.felder);
        melde('Vorlage gespeichert.');
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

async function vorlageAusRahmen(rahmen) {
    const name = prompt('Name der neuen Vorlage:', rahmen.name);
    if (!name) return;
    try {
        const res = await api('/api/urkunden/vorlagen', { method: 'POST', body: { name, rahmen_id: rahmen.id } });
        state.geaendert = false;
        await ladeVorlagen((await res.json()).id);
    } catch (e) { melde(e.message, 'error'); }
}

const rahmenMiniatur = r => pdfMiniatur(`/urkunden-rahmen/${r.datei}`);

function baueRahmenRaster(container, beiWahl) {
    baueVorlagenRaster(container, {
        vorlagen: URKUNDEN_RAHMEN.map(r => ({ ...r })),
        ausgewaehlt: null,
        miniatur: rahmenMiniatur,
        onWahl: id => beiWahl(URKUNDEN_RAHMEN.find(r => r.id === id))
    });
}

// "Neue Vorlage": Standard-Design wählen oder eigenes PDF hochladen.
function neueVorlageDialog() {
    const modal = baueModal('urkundenNeueVorlageModal', `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <h2 style="margin: 0; font-size: 18px;">Neue Vorlage</h2>
            <button type="button" class="btn btn-outlined" data-aktion="abbrechen">Abbrechen</button>
        </div>
        <p style="margin: 0;">Standard-Design wählen (nur Rahmen) oder eine eigene Blanko-Urkunde hochladen.</p>
        <div data-raster></div>
        <div style="display: flex; justify-content: flex-end;">
            <button type="button" class="btn btn-raised" data-aktion="hochladen">Eigenes PDF hochladen</button>
        </div>
    `, '860px');
    const schliesse = () => modal.remove();
    baueRahmenRaster(modal.querySelector('[data-raster]'), rahmen => { schliesse(); vorlageAusRahmen(rahmen); });
    modal.querySelector('[data-aktion="abbrechen"]').addEventListener('click', schliesse);
    modal.querySelector('[data-aktion="hochladen"]').addEventListener('click', () => { schliesse(); $('vorlageDatei').click(); });
    modal.addEventListener('click', e => { if (e.target === modal) schliesse(); });
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

// Export: lädt die gewählte Vorlage als .hajime-urkunde.json herunter (Format siehe
// src/services/urkundenVorlagenDatei.js).
async function exportiereVorlage() {
    const v = state.vorlage;
    if (!v) return melde('Bitte zuerst eine Vorlage wählen.', 'error');
    try {
        const blob = await (await api(`/api/urkunden/vorlagen/export?ids=${v.id}`)).blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${v.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'vorlage'}.hajime-urkunde.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (e) { melde(e.message, 'error'); }
}

async function importiereVorlage(datei) {
    let inhalt;
    try {
        inhalt = JSON.parse(await datei.text());
    } catch {
        return melde('Die Datei ist keine gültige Vorlagendatei.', 'error');
    }
    try {
        const ergebnis = await (await api('/api/urkunden/vorlagen/import', { method: 'POST', body: { datei: inhalt } })).json();
        await ladeVorlagen(ergebnis.angelegt[0]?.id);
        if (ergebnis.angelegt.length > 0) {
            melde(`Importiert: ${ergebnis.angelegt.map(a => `„${a.name}“`).join(', ')}`);
        }
        if (ergebnis.abgelehnt.length > 0) {
            melde(`Nicht importiert: ${ergebnis.abgelehnt.map(a => `„${a.name}“ (${a.grund})`).join('; ')}`, 'error');
        }
    } catch (e) { melde(e.message, 'error'); }
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
    $('linieStil').innerHTML = LINIEN_STILE.map(s => `<option value="${s.id}">${s.anzeigename}</option>`).join('');

    // Knöpfe zuerst binden, damit z. B. der PDF-Upload auch dann funktioniert, wenn das Laden
    // der Vorlagen noch läuft oder fehlschlägt.
    $('vorlagenAuswahl').addEventListener('change', e => zeigeVorlage(Number(e.target.value)));
    $('btnVorlageNeu').addEventListener('click', neueVorlageDialog);
    baueRahmenRaster($('rahmenStart'), vorlageAusRahmen);
    $('btnVorlageNeuLeer').addEventListener('click', () => $('vorlageDatei').click());
    $('vorlageDatei').addEventListener('change', e => {
        const datei = e.target.files[0];
        e.target.value = '';
        if (datei) neueVorlage(datei);
    });
    $('btnVorlageDuplizieren').addEventListener('click', () => vorlagenAktion('duplizieren'));
    $('btnVorlageUmbenennen').addEventListener('click', () => vorlagenAktion('umbenennen'));
    $('btnVorlageLoeschen').addEventListener('click', () => vorlagenAktion('loeschen'));
    $('btnVorlageExport').addEventListener('click', exportiereVorlage);
    $('btnVorlageImport').addEventListener('click', () => $('importDatei').click());
    $('importDatei').addEventListener('change', e => {
        const datei = e.target.files[0];
        e.target.value = '';
        if (datei) importiereVorlage(datei);
    });
    $('btnFeldPlatzhalter').addEventListener('click', () => neuesTextFeld('{Name}'));
    $('btnFeldText').addEventListener('click', () => neuesTextFeld('Text'));
    $('btnFeldLinie').addEventListener('click', neueLinie);
    $('btnFeldBild').addEventListener('click', () => {
        if (!state.vorlage) return melde('Bitte zuerst eine Vorlage anlegen oder wählen.', 'error');
        $('bildDatei').click();
    });
    $('bildDatei').addEventListener('change', e => {
        const datei = e.target.files[0];
        e.target.value = '';
        if (datei) neuesBild(datei);
    });
    $('btnVorlageSpeichern').addEventListener('click', speichern);

    $('feldText').addEventListener('input', e => aendereFeld({ text: e.target.value }));
    // Beim Familienwechsel den Stil behalten, sofern die neue Familie ihn hat.
    $('feldSchrift').addEventListener('change', e => {
        const schrift = schriftFuer(e.target.value, $('feldStil').value);
        aendereFeld({ schrift });
        zeigeSchrift(schrift);
    });
    $('feldStil').addEventListener('change', e => aendereFeld({ schrift: schriftFuer($('feldSchrift').value, e.target.value) }));
    $('feldGroesse').addEventListener('change', e => {
        const g = Math.min(200, Math.max(4, Number(e.target.value) || 24));
        aendereFeld({ groesse: g });
    });
    $('feldFarbe').addEventListener('input', e => aendereFeld({ farbe: e.target.value }));
    $('feldAusrichtung').addEventListener('change', e => aendereFeld({ ausrichtung: e.target.value }));
    $('linieStil').addEventListener('change', e => aendereFeld({ stil: e.target.value }));
    $('linieStaerke').addEventListener('change', e => {
        const s = Math.min(10, Math.max(0.5, Number(e.target.value) || 1));
        e.target.value = s;
        aendereFeld({ staerke: s });
    });
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
        if (!knopf || !state.ausgewaehlt || istLinie(state.ausgewaehlt) || istBild(state.ausgewaehlt)) return;
        const input = $('feldText');
        const pos = input.selectionStart ?? input.value.length;
        const einfuegen = `{${knopf.dataset.platzhalter}}`;
        input.value = input.value.slice(0, pos) + einfuegen + input.value.slice(input.selectionEnd ?? pos);
        aendereFeld({ text: input.value });
        input.focus();
        input.setSelectionRange(pos + einfuegen.length, pos + einfuegen.length);
    });
    $('schalterBeispiel').addEventListener('change', () => state.felder.filter(f => !istLinie(f) && !istBild(f)).forEach(aktualisiereObjekt));

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

    await ladeSchriften();
    state.beispiel = (await (await api('/api/urkunden/uebersicht')).json()).beispiel || {};
    await ladeVorlagen();
}

start().catch(e => {
    $('editorLeerText').textContent = `Der Urkunden-Designer konnte nicht geladen werden: ${e.message}`;
    $('btnVorlageNeuLeer').style.display = 'none';
    $('rahmenStart').style.display = 'none';
    melde(e.message, 'error');
});
