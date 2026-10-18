// Orga-Aufgabe (orga-aufgabe.html): Posten einer Aufgabe, Fortschritt und - bei der Catering-Aufgabe - die
// Mitbringliste. Die Orga trägt Mitbringeinträge über /api/orga/aufgaben ein (funktioniert in jedem Betriebsmodus)
// und wird dabei mit dem eigenen Namen als Person eingetragen (zuweisen mit Namen, ohne Mail).
import {
    api, el, melde, turnierIdAusUrl, ladeKontext, baueZeile, oeffneAufgabeDialog, bestaetige, zeigeZugriffsFehler,
    faelligkeitText, formatiereDatum, istUeberfaellig
} from './orgaGemeinsam.js';

const turnierId = turnierIdAusUrl();
const aufgabeId = Number(new URLSearchParams(window.location.search).get('id'));
const state = { aufgabe: null, turnier: null, ctx: null };

const meldungEl = document.getElementById('ogMeldung');

async function neuLaden() {
    const r = await api('GET', `/api/orga?turnierId=${encodeURIComponent(turnierId)}`);
    if (!r.ok) {
        zeigeZugriffsFehler(meldungEl, r);
        document.getElementById('ogAufgabe').hidden = true;
        return;
    }
    const aufgabe = r.daten.phasen.flatMap((p) => p.aufgaben).find((a) => a.id === aufgabeId);
    if (!aufgabe) {
        meldungEl.textContent = 'Diese Aufgabe gibt es nicht (mehr).';
        document.getElementById('ogAufgabe').hidden = true;
        return;
    }
    meldungEl.textContent = '';
    state.aufgabe = aufgabe;
    state.turnier = r.daten.turnier;
    render();
}

function render() {
    const a = state.aufgabe;
    const turnierDatum = String(state.turnier.datum || '').slice(0, 10);
    document.getElementById('ogAufgabe').hidden = false;
    document.getElementById('ogAufgabeTitel').textContent = a.titel;
    const info = document.getElementById('ogAufgabeInfo');
    const ueberfaellig = istUeberfaellig(a);
    info.textContent = a.faellig_am
        ? `Fällig: ${formatiereDatum(a.faellig_am)} (${faelligkeitText(a, turnierDatum)})${ueberfaellig ? ' · überfällig' : ''}`
        : 'Keine Fälligkeit';
    info.classList.toggle('og-rot', ueberfaellig);

    const posten = a.kinder.filter((k) => k.art !== 'mitbringen');
    const fertig = posten.filter((k) => k.status.status === 'erledigt').length;
    const prozent = posten.length ? Math.round((fertig / posten.length) * 100) : 0;
    document.getElementById('ogFortschrittText').textContent = `${fertig} von ${posten.length}`;
    const balken = document.getElementById('ogBalken');
    balken.setAttribute('aria-valuenow', String(prozent));
    balken.setAttribute('aria-valuetext', `${fertig} von ${posten.length} Posten erledigt`);
    document.getElementById('ogBalkenFuellung').style.width = `${prozent}%`;
    balken.classList.toggle('og-balken-fertig', posten.length > 0 && fertig === posten.length);

    const liste = document.getElementById('ogPosten');
    liste.replaceChildren(...(posten.length
        ? posten.map((k) => baueZeile(k, state.ctx, { turnierDatum, neuLaden, postenModus: true }))
        : [el('p', 'og-leer', 'Noch keine Posten.')]));

    document.getElementById('ogAlleAufMich').hidden = !state.ctx.ich.id;

    const mitbring = document.getElementById('ogMitbringen');
    mitbring.hidden = !a.mitbringliste;
    if (a.mitbringliste) renderMitbringliste();
}

function renderMitbringliste() {
    const eintraege = state.aufgabe.kinder.filter((k) => k.art === 'mitbringen');
    const liste = document.getElementById('ogMitbringListe');
    liste.replaceChildren(...(eintraege.length ? eintraege.map((k) => {
        const zeile = el('div', 'og-zeile og-mitbring-zeile');
        zeile.dataset.aufgabeId = k.id;
        const text = el('div', 'og-text');
        const kopf = el('div', 'og-titel-zeile');
        kopf.append(el('span', 'og-titel', k.titel));
        if (k.menge != null) kopf.append(el('span', 'og-menge', `${k.menge}×`));
        text.append(kopf);
        const wer = el('div', 'og-chips');
        wer.append(el('span', 'og-chip og-chip-person', k.name_frei || 'Unbekannt'));
        const loeschen = el('button', 'og-icon-knopf og-icon-gefahr');
        loeschen.type = 'button';
        loeschen.setAttribute('aria-label', `${k.titel} löschen`);
        loeschen.title = 'Löschen';
        loeschen.append(el('span', 'material-icons', 'delete_outline'));
        loeschen.addEventListener('click', async () => {
            if (!(await bestaetige(`"${k.titel}" aus der Mitbringliste löschen?`))) return;
            const r = await api('DELETE', `/api/orga/aufgaben/${k.id}`);
            if (!r.ok) return melde(r.daten.error || 'Löschen fehlgeschlagen.');
            await neuLaden();
        });
        const aktionen = el('div', 'og-aktionen');
        aktionen.append(loeschen);
        zeile.append(text, wer, aktionen);
        return zeile;
    }) : [el('p', 'og-leer', 'Noch nichts eingetragen.')]));
}

async function mitbringEintragen(e) {
    e.preventDefault();
    const fehler = document.getElementById('ogMitbringFehler');
    fehler.textContent = '';
    const titel = document.getElementById('ogMitbringTitel');
    const menge = document.getElementById('ogMitbringMenge');
    if (!titel.value.trim()) { fehler.textContent = 'Bitte eintragen, was Sie mitbringen.'; titel.focus(); return; }
    const neu = await api('POST', '/api/orga/aufgaben', {
        turnierId, art: 'mitbringen', eltern_id: aufgabeId, titel: titel.value.trim(),
        menge: menge.value === '' ? null : Number(menge.value)
    });
    if (!neu.ok) { fehler.textContent = neu.daten.error || 'Eintragen fehlgeschlagen.'; return; }
    const z = await api('POST', `/api/orga/aufgaben/${neu.daten.id}/zuweisen`, { name: state.ctx.ich.name });
    if (!z.ok) melde(z.daten.error || 'Der Name konnte nicht eingetragen werden.');
    titel.value = '';
    menge.value = '';
    await neuLaden();
}

async function alleAufMich() {
    const offen = state.aufgabe.kinder.filter((k) => k.art !== 'mitbringen' && k.status.status !== 'erledigt'
        && String(k.benutzer_id || '') !== state.ctx.ich.id);
    if (!offen.length) return melde('Alle offenen Posten liegen schon bei Ihnen.', 'success');
    let fehler = 0;
    for (const k of offen) {
        const r = await api('POST', `/api/orga/aufgaben/${k.id}/zuweisen`, { benutzerId: state.ctx.ich.id });
        if (!r.ok) fehler += 1;
    }
    if (fehler) melde(`${fehler} Posten konnten nicht zugewiesen werden.`);
    else melde(`${offen.length} Posten auf Sie zugewiesen.`, 'success');
    await neuLaden();
}

async function start() {
    if (!turnierId || !aufgabeId) {
        meldungEl.textContent = 'Aufgabe nicht gefunden.';
        return;
    }
    document.getElementById('ogZurueck').href = `/orga.html?turnierId=${encodeURIComponent(turnierId)}`;
    state.ctx = await ladeKontext(turnierId);
    document.getElementById('ogPostenNeu').addEventListener('click', () =>
        oeffneAufgabeDialog(state.ctx, { art: 'posten', elternId: aufgabeId }, () => neuLaden()));
    document.getElementById('ogAlleAufMich').addEventListener('click', alleAufMich);
    document.getElementById('ogMitbringForm').addEventListener('submit', mitbringEintragen);
    await neuLaden();
}

start();
