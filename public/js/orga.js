// Orga-Planer Übersicht (orga.html, Spec docs/specs/2026-10-18-orga-planer-design.md, Abschnitt Oberfläche):
// Kennzahlen, Phasenblöcke, Abhaken, Zuweisen, Aufgaben anlegen/ändern/löschen.
import {
    api, el, melde, turnierIdAusUrl, ladeKontext, PHASEN, baueZeile, oeffneAufgabeDialog, istKategorie,
    heuteBerlin, tageZwischen, formatiereDatum, zeigeZugriffsFehler
} from './orgaGemeinsam.js';

const turnierId = turnierIdAusUrl();
const state = { daten: null, ctx: null, nurMeine: false };

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
    window.hajimeAktualisiereOrgaMenue?.();
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
    const zeile = baueZeile(aufgabe, state.ctx, { turnierDatum: String(state.daten.turnier.datum || '').slice(0, 10), neuLaden });
    if (istKategorie(aufgabe)) {
        // Kategorien lassen sich per Drag&Drop in eine andere Phase schieben (alternativ: Bearbeiten → Phase)
        zeile.draggable = true;
        // Links und Knöpfe in der Zeile starten sonst ihren eigenen Drag (Link-Drag liefert die URL statt der Aufgabe)
        zeile.querySelectorAll('a').forEach((a) => { a.draggable = false; });
        zeile.classList.add('og-kategorie');
        zeile.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-orga-aufgabe', String(aufgabe.id));
            e.dataTransfer.effectAllowed = 'move';
            zeile.classList.add('og-zieht');
        });
        zeile.addEventListener('dragend', () => zeile.classList.remove('og-zieht'));
    }
    return zeile;
}

async function verschiebeInPhase(aufgabeId, phase) {
    const gruppen = state.daten.phasen;
    const aktuell = gruppen.find((p) => p.aufgaben.some((a) => String(a.id) === String(aufgabeId)));
    if (!aktuell || aktuell.phase === phase) return;
    const r = await api('PUT', `/api/orga/aufgaben/${aufgabeId}`, { phase });
    if (!r.ok) { melde(r.daten.error || 'Verschieben fehlgeschlagen.'); return; }
    await neuLaden();
}

// Phasen mit lauter erledigten Aufgaben sind zunächst eingeklappt; eine Wahl des Nutzers bleibt beim Neuladen erhalten
const manuellZu = new Map();

function rendereNachPhase() {
    const bloecke = [];
    for (const def of PHASEN) {
        const gruppe = state.daten.phasen.find((p) => p.phase === def.key);
        const aufgaben = sichtbareAufgaben(gruppe ? gruppe.aufgaben : []);
        if (state.nurMeine && !aufgaben.length) continue;
        const block = el('section', `og-phase og-phase-${def.key}`);
        block.dataset.phase = def.key;
        block.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; block.classList.add('og-ziel'); });
        block.addEventListener('dragleave', (e) => { if (!block.contains(e.relatedTarget)) block.classList.remove('og-ziel'); });
        block.addEventListener('drop', (e) => {
            e.preventDefault();
            block.classList.remove('og-ziel');
            const id = e.dataTransfer.getData('application/x-orga-aufgabe');
            if (id) verschiebeInPhase(id, def.key);
        });
        const kopf = el('div', 'og-phase-kopf');
        const erledigt = aufgaben.filter((a) => a.status.status === 'erledigt').length;
        kopf.append(el('span', 'material-icons og-phase-pfeil', 'expand_more'), el('h2', null, def.label),
            el('span', 'og-phase-zaehler', `${erledigt} von ${aufgaben.length}`));
        kopf.tabIndex = 0;
        kopf.setAttribute('role', 'button');
        const liste = el('div', 'og-liste');
        const klappe = () => {
            const zu = !block.classList.contains('og-phase-zu');
            block.classList.toggle('og-phase-zu', zu);
            kopf.setAttribute('aria-expanded', String(!zu));
            manuellZu.set(def.key, zu);
        };
        kopf.addEventListener('click', klappe);
        kopf.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); klappe(); } });
        block.append(kopf);
        if (!aufgaben.length) liste.append(el('p', 'og-leer', 'Keine Aufgaben in dieser Phase.'));
        for (const a of aufgaben) liste.append(zeileFuer(a));
        block.append(liste);
        const alleErledigt = aufgaben.length > 0 && erledigt === aufgaben.length;
        const zu = manuellZu.has(def.key) ? manuellZu.get(def.key) : alleErledigt;
        kopf.setAttribute('aria-expanded', String(!zu));
        block.classList.toggle('og-phase-zu', zu);
        bloecke.push(block);
    }
    inhaltEl.replaceChildren(...bloecke);
}

function render() {
    kopfRendern();
    rendereNachPhase();
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
    document.getElementById('ogNeueKategorie').addEventListener('click', () =>
        oeffneAufgabeDialog(state.ctx, { art: 'kategorie', phase: 'vorbereitung' }, () => neuLaden()));
    document.getElementById('ogNeueAufgabe').addEventListener('click', () =>
        oeffneAufgabeDialog(state.ctx, { art: 'aufgabe', phase: 'vorbereitung' }, () => neuLaden()));
    document.getElementById('ogVorlageNachladen').addEventListener('click', async (e) => {
        const knopf = e.currentTarget;
        knopf.disabled = true;
        const r = await api('POST', '/api/orga/vorlage-nachladen', { turnierId: Number(turnierId) });
        knopf.disabled = false;
        if (!r.ok) { melde(r.daten.error || 'Vorlage konnte nicht nachgeladen werden.'); return; }
        const n = r.daten.angelegt || 0;
        melde(n ? `${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} aus der Vorlage ergänzt.` : 'Alle Aufgaben der Vorlage sind bereits vorhanden.', 'success');
        await neuLaden();
    });
    await neuLaden();
}

start();
