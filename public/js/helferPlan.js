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
    zeilenEl.replaceChildren(...state.plan.taetigkeiten.map(baueZeile));
    if (state.slotId != null && !zeilenEl.querySelector(`.hp-slot[data-slot-id="${state.slotId}"]`)) state.slotId = null;
    markiereAuswahl();
    scrollEl.hidden = false;
}

function positioniere(element, von, bis) {
    const links = minutenZuProzent(von, state.bereich);
    element.style.left = `${links}%`;
    element.style.width = `${minutenZuProzent(bis, state.bereich) - links}%`;
}

// Turnierzeit hinterlegt, gestrichelte Linie je volle Stunde
function hintergrund(container, mitBeschriftung) {
    const { turnier } = state.plan;
    const { von, bis } = state.bereich;
    const zeit = el('div', 'hp-turnierzeit');
    positioniere(zeit, turnier.beginn_min, turnier.ende_min);
    container.append(zeit);
    for (let h = von; h <= bis; h += 60) {
        const linie = el('div', 'hp-stundenlinie');
        linie.style.left = `${minutenZuProzent(h, state.bereich)}%`;
        container.append(linie);
        if (mitBeschriftung && h > von && h < bis) {
            const marke = el('span', 'hp-stunde', formatiereMinuten(h));
            marke.style.left = `${minutenZuProzent(h, state.bereich)}%`;
            container.append(marke);
        }
    }
}

function renderAchse() {
    achseEl.replaceChildren();
    hintergrund(achseEl, true);
}

function baueZeile(taetigkeit) {
    const zeile = el('div', 'hp-zeile');
    zeile.dataset.taetigkeitId = String(taetigkeit.id);

    const label = el('div', 'hp-label');
    const text = el('div', 'hp-label-text');
    const bedarf = el('div', 'hp-bedarf', `min. ${taetigkeit.bedarf} Helfer`);
    if (taetigkeit.art !== 'frei') bedarf.append(el('span', 'hp-quelle', 'aus Turnier'));
    text.append(el('div', 'hp-name', taetigkeit.bezeichnung), bedarf);
    label.append(text);
    if (taetigkeit.art === 'frei') label.append(baueLabelMenue(taetigkeit));

    const spur = el('div', 'hp-spur');
    spur.dataset.taetigkeitId = String(taetigkeit.id);
    hintergrund(spur, false);
    for (const slot of taetigkeit.slots) spur.append(baueSlot(taetigkeit, slot));
    spur.addEventListener('dblclick', (e) => legeSlotPerDoppelklickAn(e, taetigkeit, spur));

    zeile.append(label, spur);
    return zeile;
}

function slotText(slot, von = slot.von_min, bis = slot.bis_min) {
    return `${formatiereMinuten(von)}–${formatiereMinuten(bis)} · ${slot.einsaetze.length}/${slot.bedarf}`;
}

function baueSlot(taetigkeit, slot) {
    const s = el('div', `hp-slot hp-${slotZustand(slot.einsaetze.length, slot.bedarf)}`);
    s.dataset.slotId = String(slot.id);
    s.tabIndex = 0;
    s.setAttribute('role', 'button');
    s.setAttribute('aria-label', `${taetigkeit.bezeichnung} ${slotText(slot)}`);
    positioniere(s, slot.von_min, slot.bis_min);
    const links = el('span', 'hp-griff links');
    links.title = 'Beginn ziehen';
    const rechts = el('span', 'hp-griff rechts');
    rechts.title = 'Ende ziehen';
    s.append(links, el('span', 'hp-slot-text', slotText(slot)), rechts);
    s.addEventListener('pointerdown', (e) => starteZiehen(e, taetigkeit, slot, s));
    s.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); waehleSlot(slot.id); }
    });
    return s;
}

// ---------------------------------------------------------------- Ziehen und Anlegen

function starteZiehen(e, taetigkeit, slot, element) {
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
        neu = ziehe(slot, modus, pixelZuMinuten(dx, breite, state.bereich), state.bereich, nachbarn);
        positioniere(element, neu.von_min, neu.bis_min);
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

async function legeSlotPerDoppelklickAn(e, taetigkeit, spur) {
    if (e.target.closest('.hp-slot')) return;
    const rect = spur.getBoundingClientRect();
    const { von, bis } = state.bereich;
    const minuten = von + ((e.clientX - rect.left) / rect.width) * (bis - von);
    const position = freiePositionFuerNeuenSlot(minuten, taetigkeit.slots, state.bereich);
    if (!position) {
        melde('Hier ist kein Platz für einen neuen Slot (mindestens 30 Minuten).');
        return;
    }
    const r = await sendeMitBestaetigung('POST', `/api/helfer-plan/taetigkeiten/${taetigkeit.id}/slots`, position);
    if (r.ok && r.daten.id != null) state.slotId = r.daten.id;
    await neuLaden();
}

// ---------------------------------------------------------------- Start

initDialoge({ turnierId, neuLaden, schliesseAuswahl });
if (!turnierId) {
    zeigeMeldung('Kein Turnier gewählt.');
} else {
    neuLaden();
    initCloudAktualisierung();
    document.getElementById('hpAusweise')?.addEventListener('click', () => {
        window.open(`/api/helfer-plan/${encodeURIComponent(turnierId)}/ausweise`, '_blank');
    });
}
