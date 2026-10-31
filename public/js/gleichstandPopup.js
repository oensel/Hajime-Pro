// Scoreboard-Steuerung: Popup, wenn nach dem letzten Kampf eines Pools (Jeder-gegen-Jeden: Platz 1 bis 3) bzw. einer
// Vorrundengruppe im Gruppen-Überkreuz (Platz 1 und 2) ein Gleichstand bleibt, den weder Siege, Wertungspunkte noch der
// direkte Vergleich auflösen. Die Turnierleitung entscheidet nach Siegzeit oder per Stichkampf (Prüfung und Regeln:
// js/shared/gleichstand.js, Ausführung am Server: services/gleichstandService.js).
import { pruefeGleichstand, leseEntscheidung, RELEVANT_BIS_POOL, RELEVANT_BIS_GRUPPE } from '/js/shared/gleichstand.js';
import { gruppenImPool, endrundeDerGruppe } from '/js/shared/gruppenUeberkreuzProgression.js';

const istJgj = modus => /^Jeder[- ]gegen[- ]Jeden$/.test(modus || '');
const nachNummer = (a, b) => String(a.reihenfolge_nummer).localeCompare(String(b.reihenfolge_nummer), 'de', { numeric: true });
const mmss = (sek) => Math.floor(sek / 60) + ':' + String(Math.round(sek % 60)).padStart(2, '0');

const geschlossen = new Set();   // "später entscheiden": bis zum nächsten "Nächsten Kampf holen" nicht erneut aufpoppen
let offenerSchluessel = null;

export function vergissGeschlossene() { geschlossen.clear(); }

// Offene Gleichstände der übergebenen Matten-Kämpfe (Einzel-Pools): [{ poolId, poolName, schluessel, gruppe, modus, pruefung, kaempfe }]
export function ermittleOffeneGleichstaende(kaempfe) {
    const nachPool = new Map();
    (kaempfe || []).filter(k => !k.mannschaftskampf_id).forEach(k => {
        if (!nachPool.has(k.pool_id)) nachPool.set(k.pool_id, []);
        nachPool.get(k.pool_id).push(k);
    });
    const ergebnis = [];
    nachPool.forEach((poolKaempfe, poolId) => {
        const erster = poolKaempfe[0];
        const entscheidung = leseEntscheidung(erster.pool_gleichstand_entscheidung);
        const poolName = erster.pool_bezeichnung;
        const idsAus = (liste) => [...new Set([...liste].sort(nachNummer).flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean))];
        if (istJgj(erster.pool_modus)) {
            if (erster.pool_status !== 'kaempfe_beendet') return;
            const pruefung = pruefeGleichstand(idsAus(poolKaempfe), poolKaempfe, { bis: RELEVANT_BIS_POOL, entscheidung: entscheidung.pool });
            if (pruefung.offen) ergebnis.push({ poolId, poolName, schluessel: 'pool', gruppe: null, modus: 'pool', pruefung, kaempfe: poolKaempfe });
        } else if (erster.pool_modus === 'Gruppen-Überkreuz' || erster.pool_modus === 'Gruppen-KO') {
            // je Gruppe, solange ihre Endrunden-Kämpfe noch nicht besetzt sind
            const nachNr = new Map(poolKaempfe.map(k => [k.reihenfolge_nummer, k]));
            gruppenImPool(poolKaempfe).forEach(g => {
                if (!endrundeDerGruppe(g, poolKaempfe).some(nr => nachNr.has(nr) && !nachNr.get(nr).kaempfer1_id)) return;
                const gruppe = poolKaempfe.filter(k => k.reihenfolge_nummer?.startsWith(`V_${g}_`));
                if (!gruppe.length) return;
                const pruefung = pruefeGleichstand(idsAus(gruppe), gruppe, { bis: RELEVANT_BIS_GRUPPE, entscheidung: entscheidung[g] });
                if (pruefung.offen) ergebnis.push({ poolId, poolName, schluessel: g, gruppe: g, modus: 'ueberkreuz', pruefung, kaempfe: gruppe });
            });
        }
    });
    return ergebnis;
}

function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
}

function schliesseOverlay() {
    document.getElementById('gleichstandOverlay')?.remove();
    offenerSchluessel = null;
}

// hilfe: { name(id) -> Anzeigename, entscheide(poolId, schluessel, regel) -> Promise<{ ok, fehler }>, danach() }
export function zeigeGleichstandPopup(eintrag, hilfe) {
    const schluessel = `${eintrag.poolId}:${eintrag.schluessel}`;
    schliesseOverlay();
    offenerSchluessel = schluessel;
    const { pruefung } = eintrag;
    const ueberkreuz = eintrag.modus === 'ueberkreuz';
    const von = Math.min(...pruefung.bloecke.map(b => b.vonPlatz));
    const bis = Math.max(...pruefung.bloecke.map(b => Math.min(b.bisPlatz, ueberkreuz ? RELEVANT_BIS_GRUPPE : RELEVANT_BIS_POOL)));

    const overlay = el('div', 'st-gleichstand-overlay');
    overlay.id = 'gleichstandOverlay';
    const dialog = el('div', 'st-gleichstand-dialog');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-labelledby', 'gleichstandTitel');
    const titel = el('div', 'st-gleichstand-titel', ueberkreuz
        ? `${eintrag.poolName}, Gruppe ${eintrag.gruppe}: Platz ${von === bis ? von : `${von} und ${bis}`} nicht eindeutig`
        : `${eintrag.poolName}: Gleichstand auf Platz ${von} bis ${Math.max(...pruefung.bloecke.map(b => b.bisPlatz))}`);
    titel.id = 'gleichstandTitel';
    const text = el('p', 'st-gleichstand-text', ueberkreuz
        ? `Alle Kämpfe der Gruppe ${eintrag.gruppe} sind beendet. Siege, Wertungspunkte und direkter Vergleich entscheiden nicht, wer ins Halbfinale kommt. Bis zur Entscheidung kann dieser Pool nicht weitergekämpft werden.`
        : 'Siege, Wertungspunkte und direkter Vergleich entscheiden nicht. Bis zur Entscheidung kann der Pool nicht abgeschlossen werden.');

    const liste = el('div', 'st-gleichstand-liste');
    pruefung.bloecke.forEach(b => b.ids.forEach(id => {
        const w = b.wertung[id];
        const zeile = el('div', 'st-gleichstand-zeile');
        zeile.append(el('span', null, hilfe.name(id)),
            el('span', 'st-gleichstand-detail', `${w.siege} ${w.siege === 1 ? 'Sieg' : 'Siege'} · ${w.punkte} Wertungspunkte · Siegzeit ${mmss(b.zeiten[id])}`));
        liste.appendChild(zeile);
    }));

    const fehler = el('div', 'st-gleichstand-fehler');
    fehler.hidden = true;
    const waehle = async (regel, knopf) => {
        fehler.hidden = true;
        dialog.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const r = await hilfe.entscheide(eintrag.poolId, eintrag.schluessel, regel).catch(err => ({ ok: false, fehler: err.message }));
        if (r && r.ok) {
            geschlossen.delete(schluessel);
            schliesseOverlay();
            if (hilfe.danach) await hilfe.danach(regel);
            return;
        }
        dialog.querySelectorAll('button').forEach(b => { b.disabled = false; });
        fehler.textContent = (r && r.fehler) || 'Die Entscheidung konnte nicht gespeichert werden.';
        fehler.hidden = false;
        if (knopf) knopf.focus();
    };

    const optionen = el('div', 'st-gleichstand-optionen');
    const siegzeitMoeglich = pruefung.bloecke.every(b => b.siegzeitEindeutig);
    if (siegzeitMoeglich) {
        const karte = el('div', 'st-gleichstand-option');
        karte.appendChild(el('div', 'st-gleichstand-option-titel', 'Nach Siegzeit'));
        karte.appendChild(el('p', 'st-gleichstand-option-text', 'Die kürzere Gesamtzeit der Siege steht vorn.'));
        const vorschau = el('div', 'st-gleichstand-vorschau');
        pruefung.bloecke.forEach(b => b.siegzeitReihenfolge.forEach((id, i) => vorschau.appendChild(el('div', null, `${b.vonPlatz + i}. ${hilfe.name(id)} ${mmss(b.zeiten[id])}`))));
        const knopf = el('button', 'btn-main', 'Nach Siegzeit entscheiden');
        knopf.type = 'button';
        knopf.addEventListener('click', () => waehle('siegzeit', knopf));
        karte.append(vorschau, knopf);
        optionen.appendChild(karte);
    }
    const stich = el('div', 'st-gleichstand-option');
    stich.appendChild(el('div', 'st-gleichstand-option-titel', 'Stichkampf'));
    stich.appendChild(el('p', 'st-gleichstand-option-text', siegzeitMoeglich
        ? 'Zusatzkämpfe unter den Betroffenen, danach wird neu geprüft. Sie werden unter Beachtung der Pausenzeiten in die Warteschlange der Matte eingeordnet.'
        : 'Die Siegzeit entscheidet hier nicht. Zusatzkämpfe unter den Betroffenen, danach wird neu geprüft. Sie werden unter Beachtung der Pausenzeiten eingeordnet.'));
    const paarungen = el('div', 'st-gleichstand-vorschau');
    pruefung.bloecke.forEach(b => b.paarungen.forEach(([a, c]) => paarungen.appendChild(el('div', null, `${hilfe.name(a)} – ${hilfe.name(c)}`))));
    const stichKnopf = el('button', 'btn-main', 'Stichkämpfe ansetzen');
    stichKnopf.type = 'button';
    stichKnopf.addEventListener('click', () => waehle('stichkampf', stichKnopf));
    stich.append(paarungen, stichKnopf);
    optionen.appendChild(stich);

    const fuss = el('div', 'st-gleichstand-fuss');
    const spaeter = el('button', 'btn-main st-btn-grau', 'Später entscheiden');
    spaeter.type = 'button';
    spaeter.addEventListener('click', () => { geschlossen.add(schluessel); schliesseOverlay(); });
    fuss.appendChild(spaeter);

    dialog.append(titel, text, liste, optionen, fehler, fuss);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    (siegzeitMoeglich ? optionen.querySelector('button') : stichKnopf).focus();
}

// Zeigt das Popup für den ersten offenen, nicht zurückgestellten Gleichstand (ein bereits offenes Popup bleibt unverändert).
export function pruefeUndZeigeGleichstandPopup(kaempfe, hilfe) {
    const offene = ermittleOffeneGleichstaende(kaempfe).filter(e => !geschlossen.has(`${e.poolId}:${e.schluessel}`));
    if (!offene.length) {
        if (offenerSchluessel) schliesseOverlay();
        return offene;
    }
    if (offenerSchluessel && offene.some(e => `${e.poolId}:${e.schluessel}` === offenerSchluessel)) return offene;
    zeigeGleichstandPopup(offene[0], hilfe);
    return offene;
}

// Für den Knopf im Pool-Panel: das Popup zu einem bestimmten Pool wieder öffnen.
export function oeffneGleichstandPopupFuerPool(poolId, kaempfe, hilfe) {
    const e = ermittleOffeneGleichstaende(kaempfe).find(x => Number(x.poolId) === Number(poolId));
    if (!e) return false;
    geschlossen.delete(`${e.poolId}:${e.schluessel}`);
    zeigeGleichstandPopup(e, hilfe);
    return true;
}
