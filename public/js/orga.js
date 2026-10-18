// Orga-Planer Übersicht (orga.html, Spec docs/specs/2026-10-18-orga-planer-design.md, Abschnitt Oberfläche):
// Kennzahlen, Phasenblöcke oder Gruppierung nach Person, Abhaken, Zuweisen, Aufgaben anlegen/ändern/löschen.
import {
    api, el, melde, turnierIdAusUrl, ladeKontext, PHASEN, baueZeile, oeffneAufgabeDialog, zustaendiger,
    heuteBerlin, tageZwischen, formatiereDatum, zeigeZugriffsFehler
} from './orgaGemeinsam.js';

const turnierId = turnierIdAusUrl();
const state = { daten: null, ctx: null, nurMeine: false, ansicht: 'phase' };

const meldungEl = document.getElementById('ogMeldung');
const inhaltEl = document.getElementById('ogInhalt');

async function neuLaden(optionen = {}) {
    const r = await api('GET', `/api/orga?turnierId=${encodeURIComponent(turnierId)}`);
    if (!r.ok) {
        zeigeZugriffsFehler(meldungEl, r);
        document.getElementById('ogKennzahlen').hidden = true;
        inhaltEl.replaceChildren();
        return;
    }
    meldungEl.textContent = '';
    state.daten = r.daten;
    render();
    if (optionen.pruefeErledigt != null) {
        const a = state.daten.phasen.flatMap((p) => p.aufgaben).find((x) => x.id === optionen.pruefeErledigt);
        if (a && a.status.status === 'erledigt') {
            melde('Der Status ergibt sich aus den Posten bzw. dem Helferplan und bleibt erledigt.', 'success');
        }
    }
}

function kopfRendern() {
    const t = state.daten.turnier;
    document.getElementById('ogTurnierName').textContent = t.bezeichnung || 'Orga-Planer';
    const datum = String(t.datum || '').slice(0, 10);
    let info = '';
    if (datum) {
        const tage = tageZwischen(heuteBerlin(), datum);
        const rest = tage > 1 ? `noch ${tage} Tage` : tage === 1 ? 'noch 1 Tag' : tage === 0 ? 'heute' : `vor ${-tage} ${tage === -1 ? 'Tag' : 'Tagen'}`;
        info = `${formatiereDatum(datum)} · ${rest}`;
    }
    document.getElementById('ogTurnierInfo').textContent = info;
    const k = state.daten.kennzahlen;
    document.getElementById('ogErledigt').textContent = `${k.erledigt} von ${k.gesamt}`;
    document.getElementById('ogUeberfaellig').textContent = String(k.ueberfaellig);
    document.getElementById('ogOhne').textContent = String(k.ohneZustaendigen);
    document.getElementById('ogKarteUeberfaellig').classList.toggle('og-karte-aktiv', k.ueberfaellig > 0);
    document.getElementById('ogKennzahlen').hidden = false;
}

function istMeine(aufgabe) {
    if (!state.ctx.ich.id) return true;
    const meine = (a) => a.benutzer_id && String(a.benutzer_id) === state.ctx.ich.id;
    return meine(aufgabe) || (aufgabe.kinder || []).some(meine);
}

function sichtbareAufgaben(aufgaben) {
    return state.nurMeine ? aufgaben.filter(istMeine) : aufgaben;
}

function zeileFuer(aufgabe) {
    return baueZeile(aufgabe, state.ctx, { turnierDatum: String(state.daten.turnier.datum || '').slice(0, 10), neuLaden });
}

function rendereNachPhase() {
    const bloecke = [];
    for (const def of PHASEN) {
        const gruppe = state.daten.phasen.find((p) => p.phase === def.key);
        const aufgaben = sichtbareAufgaben(gruppe ? gruppe.aufgaben : []);
        if (state.nurMeine && !aufgaben.length) continue;
        const block = el('section', `og-phase og-phase-${def.key}`);
        block.dataset.phase = def.key;
        const kopf = el('div', 'og-phase-kopf');
        const erledigt = aufgaben.filter((a) => a.status.status === 'erledigt').length;
        kopf.append(el('h2', null, def.label), el('span', 'og-phase-hinweis', def.hinweis),
            el('span', 'og-phase-zaehler', `${erledigt} von ${aufgaben.length}`));
        block.append(kopf);
        const liste = el('div', 'og-liste');
        if (!aufgaben.length) liste.append(el('p', 'og-leer', 'Keine Aufgaben in dieser Phase.'));
        for (const a of aufgaben) liste.append(zeileFuer(a));
        block.append(liste);
        bloecke.push(block);
    }
    inhaltEl.replaceChildren(...bloecke);
}

function rendereNachPerson() {
    const gruppen = new Map();
    const ohne = [];
    for (const p of state.daten.phasen) {
        for (const a of sichtbareAufgaben(p.aufgaben)) {
            const z = zustaendiger(a, state.ctx);
            if (!z) {
                if (a.status.status !== 'erledigt') ohne.push(a);
                continue;
            }
            if (!gruppen.has(z.schluessel)) gruppen.set(z.schluessel, { name: z.ich ? `${z.name} (Du)` : z.name, ich: z.ich, aufgaben: [] });
            gruppen.get(z.schluessel).aufgaben.push(a);
        }
    }
    const sortiert = [...gruppen.values()].sort((x, y) => (y.ich - x.ich) || x.name.localeCompare(y.name, 'de'));
    if (ohne.length) sortiert.push({ name: 'Ohne Zuständigen', ohne: true, aufgaben: ohne });
    const bloecke = sortiert.map((g) => {
        const block = el('section', 'og-phase og-person');
        if (g.ohne) block.classList.add('og-person-ohne');
        const kopf = el('div', 'og-phase-kopf');
        kopf.append(el('h2', null, g.name),
            el('span', 'og-phase-zaehler', `${g.aufgaben.filter((a) => a.status.status === 'erledigt').length} von ${g.aufgaben.length}`));
        const liste = el('div', 'og-liste');
        for (const a of g.aufgaben) liste.append(zeileFuer(a));
        block.append(kopf, liste);
        return block;
    });
    inhaltEl.replaceChildren(...(bloecke.length ? bloecke : [el('p', 'og-leer', 'Keine Aufgaben.')]));
}

function render() {
    kopfRendern();
    if (state.ansicht === 'person') rendereNachPerson();
    else rendereNachPhase();
}

function schalte(ansicht) {
    state.ansicht = ansicht;
    document.getElementById('ogNachPhase').setAttribute('aria-pressed', String(ansicht === 'phase'));
    document.getElementById('ogNachPerson').setAttribute('aria-pressed', String(ansicht === 'person'));
    if (state.daten) render();
}

async function start() {
    if (!turnierId) {
        meldungEl.textContent = 'Bitte zuerst ein Turnier wählen.';
        return;
    }
    state.ctx = await ladeKontext(turnierId);
    document.getElementById('ogNurMeine').addEventListener('click', (e) => {
        state.nurMeine = !state.nurMeine;
        e.currentTarget.setAttribute('aria-pressed', String(state.nurMeine));
        if (state.daten) render();
    });
    document.getElementById('ogNachPhase').addEventListener('click', () => schalte('phase'));
    document.getElementById('ogNachPerson').addEventListener('click', () => schalte('person'));
    document.getElementById('ogNeueAufgabe').addEventListener('click', () =>
        oeffneAufgabeDialog(state.ctx, { art: 'aufgabe', phase: 'vorbereitung' }, () => neuLaden()));
    await neuLaden();
}

start();
