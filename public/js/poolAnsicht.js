// Visuelle Darstellung des Pools, zu dem der aktuelle Kampf gehört (Abschnitt "Pool-Übersicht" in
// steuerung.html): Jeder-gegen-Jeden als Kampfbogen (Matrix), Doppel-KO als Turnierbaum
// (Haupt- und Trostrunde), Gruppen-Überkreuz als zwei Kampfbögen plus Finalrunde. Arbeitet auf
// der Kampfliste der Matte (Datenzugriff.ladeKaempfeDerMatte), braucht also keine eigene Abfrage.
// Aufbau per DOM-Funktionen mit textContent (keine HTML-Strings aus Namen).
import { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } from '/js/shared/poolRunden.js';

function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}

const name = (k, slot) => {
    const nach = k[`kaempfer${slot}_nachname`];
    const vor = k[`kaempfer${slot}_vorname`];
    if (!nach && !vor) return '';
    return `${nach || ''}${nach && vor ? ', ' : ''}${vor || ''}`;
};
const punkte = (k, slot) => Number(k[`unterbewertung_kaempfer${slot}`]) || 0;
const istEnde = (k) => k.status === 'beendet' || k.status === 'freilos';

function statusKlasse(k, aktuellerKampfId) {
    const teile = ['pa-karte'];
    if (Number(k.id) === Number(aktuellerKampfId)) teile.push('pa-aktuell');
    if (k.status === 'gestartet') teile.push('pa-laeuft');
    else if (istEnde(k)) teile.push('pa-beendet');
    return teile.join(' ');
}

// --- Turnierbaum --------------------------------------------------------------------------

function kampfKarte(k, aktuellerKampfId) {
    if (!k) {
        const leer = el('div', 'pa-karte pa-leer');
        leer.style.visibility = 'hidden';
        return leer;
    }
    const karte = el('div', statusKlasse(k, aktuellerKampfId));
    karte.title = `Kampf ${k.reihenfolge_nummer}`;
    for (const slot of [1, 2]) {
        const zeile = el('div', 'pa-zeile');
        const gewinner = istEnde(k) && k.sieger_id != null && Number(k.sieger_id) === Number(k[`kaempfer${slot}_id`]);
        if (gewinner) zeile.classList.add('pa-sieger');
        const n = name(k, slot);
        zeile.appendChild(el('span', n ? 'pa-name' : 'pa-name pa-offen', n || 'offen'));
        if (k.status === 'beendet') zeile.appendChild(el('span', 'pa-pkt', String(punkte(k, slot))));
        karte.appendChild(zeile);
    }
    if (k.status === 'gestartet') karte.appendChild(el('span', 'pa-marke', 'läuft'));
    return karte;
}

function runden(rundenDef, nachNummer, aktuellerKampfId) {
    const reihe = el('div', 'pa-runden');
    for (const runde of rundenDef) {
        const spalte = el('div', 'pa-runde');
        spalte.appendChild(el('div', 'pa-runde-titel', runde.title));
        const liste = el('div', 'pa-runde-liste');
        for (const nr of runde.nummern) liste.appendChild(kampfKarte(nachNummer.get(String(nr)), aktuellerKampfId));
        spalte.appendChild(liste);
        reihe.appendChild(spalte);
    }
    return reihe;
}

// --- Kampfbogen (Jeder gegen Jeden) -------------------------------------------------------

function kampfbogen(titel, kaempfe, aktuellerKampfId) {
    const abschnitt = el('div', 'pa-abschnitt');
    if (titel) abschnitt.appendChild(el('div', 'pa-abschnitt-titel', titel));

    // Teilnehmer in der Reihenfolge ihres ersten Auftretens (stabile Zeilen/Spalten).
    const teilnehmer = [];
    const bekannt = new Set();
    const merke = (k, slot) => {
        const id = k[`kaempfer${slot}_id`];
        if (id == null || bekannt.has(id)) return;
        bekannt.add(id);
        teilnehmer.push({ id, name: name(k, slot), verein: k[`kaempfer${slot}_verein`] || '' });
    };
    [...kaempfe].sort((a, b) => Number(a.id) - Number(b.id)).forEach(k => { merke(k, 1); merke(k, 2); });
    if (teilnehmer.length === 0) {
        abschnitt.appendChild(el('div', 'pa-hinweis', 'Noch keine Paarungen.'));
        return abschnitt;
    }

    const paarung = new Map();
    for (const k of kaempfe) paarung.set(`${k.kaempfer1_id}|${k.kaempfer2_id}`, k);
    const finde = (a, b) => paarung.get(`${a}|${b}`) || paarung.get(`${b}|${a}`);

    const tabelle = el('table', 'pa-matrix');
    const kopf = el('tr');
    kopf.appendChild(el('th', 'pa-matrix-ecke', ''));
    teilnehmer.forEach((_, i) => kopf.appendChild(el('th', 'pa-matrix-nr', String(i + 1))));
    kopf.appendChild(el('th', 'pa-matrix-nr', 'Siege'));
    tabelle.appendChild(kopf);

    teilnehmer.forEach((zeileT, i) => {
        const tr = el('tr');
        const kopfzelle = el('th', 'pa-matrix-name');
        kopfzelle.appendChild(el('span', 'pa-matrix-index', `${i + 1}`));
        kopfzelle.appendChild(el('span', 'pa-matrix-text', zeileT.name || '—'));
        if (zeileT.verein) kopfzelle.appendChild(el('span', 'pa-matrix-verein', zeileT.verein));
        tr.appendChild(kopfzelle);

        let siege = 0;
        teilnehmer.forEach((spalteT, j) => {
            const td = el('td', 'pa-matrix-zelle');
            if (i === j) {
                td.classList.add('pa-diagonale');
            } else {
                const k = finde(zeileT.id, spalteT.id);
                if (!k) {
                    td.textContent = '';
                } else if (k.status === 'freilos') {
                    td.textContent = 'FL';
                } else if (k.status === 'beendet') {
                    const ichBinK1 = Number(k.kaempfer1_id) === Number(zeileT.id);
                    const meine = punkte(k, ichBinK1 ? 1 : 2);
                    const gegner = punkte(k, ichBinK1 ? 2 : 1);
                    const gewonnen = k.sieger_id != null && Number(k.sieger_id) === Number(zeileT.id);
                    if (gewonnen) { td.classList.add('pa-gewonnen'); siege += 1; } else td.classList.add('pa-verloren');
                    td.textContent = `${meine}:${gegner}`;
                } else {
                    td.classList.add(k.status === 'gestartet' ? 'pa-laeuft' : 'pa-offen-zelle');
                    td.textContent = k.status === 'gestartet' ? 'läuft' : `#${k.reihenfolge_nummer}`;
                }
                if (k && Number(k.id) === Number(aktuellerKampfId)) td.classList.add('pa-aktuell');
            }
            tr.appendChild(td);
        });
        tr.appendChild(el('td', 'pa-matrix-siege', String(siege)));
        tabelle.appendChild(tr);
    });

    const huelle = el('div', 'pa-scroll');
    huelle.appendChild(tabelle);
    abschnitt.appendChild(huelle);
    return abschnitt;
}

// --- Einstieg -----------------------------------------------------------------------------

/**
 * Zeichnet den Pool des aktuellen Kampfes in den Container.
 * @param {HTMLElement} container Ziel (wird komplett neu befüllt)
 * @param {Array} kaempfe Kampfliste der Matte (aus baueMattenAnsicht, mit pool_id/pool_modus)
 * @param {number|null} aktuellerKampfId der geladene Kampf; ohne ihn der laufende bzw. nächste der Matte
 */
export function renderPoolAnsicht(container, kaempfe, aktuellerKampfId) {
    container.textContent = '';
    const einzel = (kaempfe || []).filter(k => !k.mannschaftskampf_id);
    const bezug = einzel.find(k => Number(k.id) === Number(aktuellerKampfId))
        || einzel.find(k => k.status === 'gestartet')
        || einzel.find(k => k.status === 'bereit')
        || einzel.find(k => k.status === 'angelegt');
    if (!bezug) {
        container.appendChild(el('div', 'pa-hinweis', 'Kein Einzel-Pool auf dieser Matte aktiv.'));
        return;
    }

    const poolKaempfe = einzel.filter(k => Number(k.pool_id) === Number(bezug.pool_id));
    const modus = bezug.pool_modus || '';
    const beendet = poolKaempfe.filter(istEnde).length;

    const kopf = el('div', 'pa-kopf');
    kopf.appendChild(el('span', 'pa-pool-name', bezug.pool_bezeichnung || ''));
    kopf.appendChild(el('span', 'pa-pool-info', `${modus ? modus + ' · ' : ''}${beendet}/${poolKaempfe.length} Kämpfe beendet`));
    container.appendChild(kopf);

    const nachNummer = new Map(poolKaempfe.map(k => [String(k.reihenfolge_nummer), k]));
    const aktuell = Number(bezug.id);

    if (POOL_RUNDEN[modus]) {
        const haupt = el('div', 'pa-abschnitt');
        haupt.appendChild(el('div', 'pa-abschnitt-titel', 'Hauptrunde'));
        const hauptScroll = el('div', 'pa-scroll');
        hauptScroll.appendChild(runden(POOL_RUNDEN[modus].winner, nachNummer, aktuell));
        haupt.appendChild(hauptScroll);
        container.appendChild(haupt);

        const trost = el('div', 'pa-abschnitt');
        trost.appendChild(el('div', 'pa-abschnitt-titel', 'Trostrunde'));
        const trostScroll = el('div', 'pa-scroll');
        trostScroll.appendChild(runden(POOL_RUNDEN[modus].loser, nachNummer, aktuell));
        trost.appendChild(trostScroll);
        container.appendChild(trost);
    } else if (/^Gruppen-(Ü|ue|Ue)berkreuz$/.test(modus)) {
        for (const gruppe of UEBERKREUZ_GRUPPEN) {
            const gruppenKaempfe = poolKaempfe.filter(k => String(k.reihenfolge_nummer).startsWith(gruppe.praefix));
            if (gruppenKaempfe.length) container.appendChild(kampfbogen(gruppe.titel, gruppenKaempfe, aktuell));
        }
        const finale = el('div', 'pa-abschnitt');
        finale.appendChild(el('div', 'pa-abschnitt-titel', 'Finalrunde'));
        const finaleScroll = el('div', 'pa-scroll');
        finaleScroll.appendChild(runden(UEBERKREUZ_FINALRUNDE.filter(r => r.nummern.some(n => nachNummer.has(n))), nachNummer, aktuell));
        finale.appendChild(finaleScroll);
        container.appendChild(finale);
    } else {
        // Jeder-gegen-Jeden (und alles Unbekannte): ein Kampfbogen
        container.appendChild(kampfbogen('', poolKaempfe, aktuell));
    }
}
