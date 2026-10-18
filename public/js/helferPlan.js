// Helferplan (helfer-plan.html, Spec docs/specs/2026-10-17-helferverwaltung-design.md Abschnitt 6):
// Zeitstrahl mit einer Zeile je Tätigkeit, Slots ziehen/verschieben (gespeichert beim Loslassen),
// Doppelklick legt einen Slot an, Klick öffnet die Detailleiste (helferPlanDialoge.js).
// Layout- und Zieh-Logik: src/shared/helferZeitstrahl.js.
import { zeitstrahlBereich, formatiereMinuten } from '/js/shared/helferZeit.js';
import {
    minutenZuProzent, pixelZuMinuten, ziehe, slotZustand, freiePositionFuerNeuenSlot
} from '/js/shared/helferZeitstrahl.js';
import {
    initDialoge, zeigeDetail, sendeMitBestaetigung, api, melde, el, baueLabelMenue, initCloudAktualisierung
} from './helferPlanDialoge.js';

const parameter = new URLSearchParams(window.location.search);
const turnierId = parameter.get('turnierId') || parameter.get('id') || localStorage.getItem('aktiveTurnierId');

// Der Vortag (tag_versatz -1: Aufbau u. Ä.) hat einen eigenen Streifen mit festem Bereich 06:00–24:00.
const BEREICH_VORTAG = Object.freeze({ von: 360, bis: 1440 });

const state = { plan: null, bereich: null, slotId: null };

const meldungEl = document.getElementById('hpMeldung');
const scrollEl = document.getElementById('hpScroll');
const achseEl = document.getElementById('hpAchse');
const zeilenEl = document.getElementById('hpZeilen');

function zeigeMeldung(...inhalt) {
    meldungEl.replaceChildren(...inhalt);
}

async function neuLaden() {
    const r = await api('GET', `/api/helfer-plan/${encodeURIComponent(turnierId)}`);
    if (!r.ok) {
        zeigeMeldung(r.daten.error || 'Der Helferplan konnte nicht geladen werden.');
        scrollEl.hidden = true;
        return;
    }
    state.plan = r.daten;
    render();
    await zeigeDetail(state);
}

function schliesseAuswahl() {
    state.slotId = null;
    markiereAuswahl();
    zeigeDetail(state);
}

function waehleSlot(slotId) {
    state.slotId = slotId;
    markiereAuswahl();
    zeigeDetail(state);
}

function markiereAuswahl() {
    zeilenEl.querySelectorAll('.hp-slot').forEach(s => {
        s.classList.toggle('hp-ausgewaehlt', Number(s.dataset.slotId) === state.slotId);
    });
}

// ---------------------------------------------------------------- Rendering

function render() {
    const { turnier } = state.plan;
    if (turnier.beginn_min == null || turnier.ende_min == null) {
        const link = el('a', null, 'Beginn und Ende in der Turnierverwaltung eintragen');
        link.href = `/turnier.html?id=${encodeURIComponent(turnierId)}`;
        zeigeMeldung('Für den Helferplan fehlen Beginn und Ende des Turniers. ', link);
        scrollEl.hidden = true;
        document.getElementById('hpDetail').hidden = true;
        return;
    }
    zeigeMeldung();
    state.bereich = zeitstrahlBereich(turnier.beginn_min, turnier.ende_min);
    renderAchse();
    const turniertag = state.plan.taetigkeiten.filter(t => (t.tag_versatz || 0) === 0);
    const vortag = state.plan.taetigkeiten.filter(t => (t.tag_versatz || 0) < 0);
    const zeilen = turniertag.map(t => baueZeile(t, state.bereich));
    if (vortag.length) zeilen.push(baueVortagKopf(), ...vortag.map(t => baueZeile(t, BEREICH_VORTAG)));
    zeilenEl.replaceChildren(...zeilen);
    if (state.slotId != null && !zeilenEl.querySelector(`.hp-slot[data-slot-id="${state.slotId}"]`)) state.slotId = null;
    markiereAuswahl();
    scrollEl.hidden = false;
}

function positioniere(element, von, bis, bereich = state.bereich) {
    const links = minutenZuProzent(von, bereich);
    element.style.left = `${links}%`;
    element.style.width = `${minutenZuProzent(bis, bereich) - links}%`;
}

// Turnierzeit hinterlegt (nur am Turniertag), gestrichelte Linie je volle Stunde
function hintergrund(container, mitBeschriftung, bereich = state.bereich, mitTurnierzeit = true) {
    const { turnier } = state.plan;
    const { von, bis } = bereich;
    if (mitTurnierzeit) {
        const zeit = el('div', 'hp-turnierzeit');
        positioniere(zeit, turnier.beginn_min, turnier.ende_min, bereich);
        container.append(zeit);
    }
    for (let h = von; h <= bis; h += 60) {
        const linie = el('div', 'hp-stundenlinie');
        linie.style.left = `${minutenZuProzent(h, bereich)}%`;
        container.append(linie);
        if (mitBeschriftung && h > von && h < bis) {
            const marke = el('span', 'hp-stunde', formatiereMinuten(h));
            marke.style.left = `${minutenZuProzent(h, bereich)}%`;
            container.append(marke);
        }
    }
}

// Überschriftszeile des Vortag-Streifens mit eigener Zeitachse
function baueVortagKopf() {
    const kopf = el('div', 'hp-kopf hp-vortag-kopf');
    kopf.append(el('div', 'hp-label hp-label-kopf', 'Vortag'));
    const achse = el('div', 'hp-achse');
    hintergrund(achse, true, BEREICH_VORTAG, false);
    kopf.append(achse);
    return kopf;
}

// Knopf „auf Vortag / auf Turniertag legen“ (Aufbau und eigene Tätigkeiten)
function baueVersatzKnopf(taetigkeit) {
    const aufVortag = (taetigkeit.tag_versatz || 0) === 0;
    const knopf = el('button', 'hp-versatz-knopf', aufVortag ? 'auf Vortag' : 'auf Turniertag');
    knopf.type = 'button';
    knopf.title = aufVortag ? 'Diese Tätigkeit auf den Vortag legen' : 'Diese Tätigkeit auf den Turniertag legen';
    knopf.setAttribute('aria-label', `${taetigkeit.bezeichnung} ${aufVortag ? 'auf den Vortag' : 'auf den Turniertag'} legen`);
    knopf.addEventListener('click', async () => {
        await sendeMitBestaetigung('PUT', `/api/helfer-plan/taetigkeiten/${taetigkeit.id}`, { tag_versatz: aufVortag ? -1 : 0 });
        await neuLaden();
    });
    return knopf;
}

function renderAchse() {
    achseEl.replaceChildren();
    hintergrund(achseEl, true);
}

function baueZeile(taetigkeit, bereich) {
    const zeile = el('div', 'hp-zeile');
    zeile.dataset.taetigkeitId = String(taetigkeit.id);

    const label = el('div', 'hp-label');
    const text = el('div', 'hp-label-text');
    const bedarf = el('div', 'hp-bedarf', `min. ${taetigkeit.bedarf} Helfer`);
    const name = el('div', 'hp-name', taetigkeit.bezeichnung);
    name.title = taetigkeit.bezeichnung;
    text.append(name, bedarf);
    label.append(text);
    if (taetigkeit.art === 'frei') label.append(baueLabelMenue(taetigkeit));
    if (taetigkeit.art === 'frei' || taetigkeit.art === 'aufbau') text.append(baueVersatzKnopf(taetigkeit));

    const spur = el('div', 'hp-spur');
    spur.dataset.taetigkeitId = String(taetigkeit.id);
    hintergrund(spur, false, bereich, (taetigkeit.tag_versatz || 0) === 0);
    for (const slot of taetigkeit.slots) spur.append(baueSlot(taetigkeit, slot, bereich));
    spur.addEventListener('dblclick', (e) => legeSlotPerDoppelklickAn(e, taetigkeit, spur, bereich));

    zeile.append(label, spur);
    return zeile;
}

function slotText(slot, von = slot.von_min, bis = slot.bis_min) {
    return `${formatiereMinuten(von)}–${formatiereMinuten(bis)} · ${slot.einsaetze.length}/${slot.bedarf}`;
}

function baueSlot(taetigkeit, slot, bereich) {
    const s = el('div', `hp-slot hp-${slotZustand(slot.einsaetze.length, slot.bedarf)}`);
    s.dataset.slotId = String(slot.id);
    s.tabIndex = 0;
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', `${taetigkeit.bezeichnung} ${slotText(slot)}`);
    positioniere(s, slot.von_min, slot.bis_min, bereich);
    const links = el('span', 'hp-griff links');
    links.title = 'Beginn ziehen';
    const rechts = el('span', 'hp-griff rechts');
    rechts.title = 'Ende ziehen';
    s.append(links, el('span', 'hp-slot-text', slotText(slot)), rechts);
    s.addEventListener('pointerdown', (e) => starteZiehen(e, taetigkeit, slot, s, bereich));
    s.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehleSlot(slot.id); }
    });
    return s;
}

// ---------------------------------------------------------------- Ziehen und Anlegen

function starteZiehen(e, taetigkeit, slot, element, bereich) {
    if (e.button !== 0) return;
    e.preventDefault();
    const modus = e.target.classList.contains('links') ? 'links'
        : e.target.classList.contains('rechts') ? 'rechts' : 'mitte';
    const breite = element.parentElement.getBoundingClientRect().width;
    const nachbarn = taetigkeit.slots.filter(x => x.id !== slot.id);
    const startX = e.clientX;
    let neu = { von_min: slot.von_min, bis_min: slot.bis_min };
    let bewegt = false;
    element.setPointerCapture?.(e.pointerId);
    element.classList.add('hp-zieht');
    const textEl = element.querySelector('.hp-slot-text');

    const bewegen = (ev) => {
        const dx = ev.clientX - startX;
        if (!bewegt && Math.abs(dx) < 4) return;
        bewegt = true;
        neu = ziehe(slot, modus, pixelZuMinuten(dx, breite, bereich), bereich, nachbarn);
        positioniere(element, neu.von_min, neu.bis_min, bereich);
        textEl.textContent = slotText(slot, neu.von_min, neu.bis_min);
    };
    const ende = async (ev) => {
        element.removeEventListener('pointermove', bewegen);
        element.removeEventListener('pointerup', ende);
        element.removeEventListener('pointercancel', ende);
        element.classList.remove('hp-zieht');
        if (ev.type === 'pointercancel') { render(); return; }
        if (!bewegt) { waehleSlot(slot.id); return; }
        if (neu.von_min === slot.von_min && neu.bis_min === slot.bis_min) return;
        // Gespeichert wird erst beim Loslassen; bei Fehler/Abbruch stellt das Neuladen den alten Stand her.
        await sendeMitBestaetigung('PUT', `/api/helfer-plan/slots/${slot.id}`, neu);
        await neuLaden();
    };
    element.addEventListener('pointermove', bewegen);
    element.addEventListener('pointerup', ende);
    element.addEventListener('pointercancel', ende);
}

async function legeSlotPerDoppelklickAn(e, taetigkeit, spur, bereich) {
    if (e.target.closest('.hp-slot')) return;
    const rect = spur.getBoundingClientRect();
    const { von, bis } = bereich;
    const minuten = von + ((e.clientX - rect.left) / rect.width) * (bis - von);
    const position = freiePositionFuerNeuenSlot(minuten, taetigkeit.slots, bereich);
    if (!position) {
        melde('Hier ist kein Platz für einen neuen Slot (mindestens 30 Minuten).');
        return;
    }
    const r = await sendeMitBestaetigung('POST', `/api/helfer-plan/taetigkeiten/${taetigkeit.id}/slots`, position);
    if (r.ok && r.daten.id != null) state.slotId = r.daten.id;
    await neuLaden();
}

// Helferausweise als PDF: per fetch (Auth-Header kommt aus dem fetch-Wrapper in menu.js), Anzeige im neuen Tab.
async function oeffneAusweise() {
    // Tab sofort öffnen (Popup-Blocker), danach mit der blob:-URL füllen
    const tab = window.open('about:blank', '_blank');
    try {
        const res = await fetch(`/api/helfer-plan/${encodeURIComponent(turnierId)}/ausweise`);
        if (!res.ok) {
            const daten = await res.json().catch(() => ({}));
            if (tab) tab.close();
            melde(daten.error || 'Die Helferausweise konnten nicht erzeugt werden.');
            return;
        }
        const url = URL.createObjectURL(await res.blob());
        if (tab) tab.location.href = url; else window.open(url, '_blank');
    } catch {
        if (tab) tab.close();
        melde('Server nicht erreichbar.');
    }
}

// ---------------------------------------------------------------- Start

initDialoge({ turnierId, neuLaden, schliesseAuswahl });
if (!turnierId) {
    zeigeMeldung('Kein Turnier gewählt.');
} else {
    neuLaden();
    initCloudAktualisierung();
    document.getElementById('hpAusweise')?.addEventListener('click', oeffneAusweise);
}
