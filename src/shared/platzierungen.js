// Platzierungen je Pool — gemeinsame Berechnung für Siegerliste (Browser) und Urkunden (Server).
// Regeln: docs/specs/2026-09-29-urkunden-generator-design.md, "Platzierungen je Modus".
// Ein Platz wird gesetzt, sobald der entscheidende Kampf fertig ist; offene Plätze bleiben null.
import { berechneGruppenRangliste, VORRUNDEN_GRUPPEN } from './gruppenUeberkreuzProgression.js';
import { ordneEinzelRangfolge } from './jgjRangfolge.js';
import { leseEntscheidung } from './gleichstand.js';

const DK_SCHLUESSEL = {
    'Doppel-KO-8': { final: 'F', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] },
    'Doppel-KO-16': { final: 'F1', bronze: ['T11', 'T12'], trost: ['T9', 'T10'] },
    'Doppel-KO-32': { final: 'F1', bronze: ['T27', 'T28'], trost: ['T25', 'T26'] },
    // KO-Repechage: Bronzekämpfe T3/T4, Hoffnungsrunde T1/T2 (src/shared/koRepechage.js)
    'KO-Repechage-16': { final: 'F1', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] },
    'KO-Repechage-32': { final: 'F1', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] },
    'KO-Repechage-64': { final: 'F1', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] }
};

const istJgj = m => m === 'Jeder-gegen-Jeden' || m === 'Jeder gegen Jeden';
const istUeberkreuz = m => m === 'Gruppen-Überkreuz' || m === 'Gruppen-ueberkreuz' || m === 'Gruppen-KO';
const fertig = k => !!k && (k.status === 'beendet' || k.status === 'freilos');

const EINZEL = { a: k => k.kaempfer1_id, b: k => k.kaempfer2_id, sieger: k => k.sieger_id };
const MANNSCHAFT = { a: k => k.mannschaft1_id, b: k => k.mannschaft2_id, sieger: k => k.sieger_mannschaft_id };

// Aus einem Freilos (oder unvollständig besetzten Kampf) entsteht kein Verlierer.
function verlierer(k, ad) {
    if (!k || k.status !== 'beendet' || !ad.a(k) || !ad.b(k) || !ad.sieger(k)) return null;
    return ad.sieger(k) === ad.a(k) ? ad.b(k) : ad.a(k);
}

function setze(plaetze, id, platz) {
    if (id && !plaetze.has(id)) plaetze.set(id, platz);
}

// gleichstand: Ids, deren Rang auch nach allen Kriterien (inkl. direktem Vergleich) mit einem Nachbarn gleich bleibt.
function baueErgebnis(objekte, plaetze, abgeschlossen, schluessel, gleichstand = new Set()) {
    const eintraege = objekte.map(o => ({ platz: plaetze.get(o.id) ?? null, [schluessel]: o, gleichstand: gleichstand.has(o.id) }));
    eintraege.sort((x, y) => (x.platz ?? Infinity) - (y.platz ?? Infinity));
    return { abgeschlossen, eintraege };
}

// Finale → 1/2, Bronze → Sieger 3 / Verlierer 5, Trostrunde davor → Verlierer 7.
function berechneKo(kaempfe, schl, ad) {
    const nachNr = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k]));
    const plaetze = new Map();
    const finale = nachNr.get(schl.final);
    if (fertig(finale)) {
        setze(plaetze, ad.sieger(finale), 1);
        setze(plaetze, verlierer(finale, ad), 2);
    }
    const bronze = schl.bronze.map(nr => nachNr.get(nr));
    bronze.forEach(k => {
        if (!fertig(k)) return;
        setze(plaetze, ad.sieger(k), 3);
        setze(plaetze, verlierer(k, ad), 5);
    });
    schl.trost.map(nr => nachNr.get(nr)).forEach(k => {
        if (fertig(k)) setze(plaetze, verlierer(k, ad), 7);
    });
    return { plaetze, abgeschlossen: fertig(finale) && bronze.every(fertig) };
}

// Fortlaufende Rangfolge; erst wenn alle Kämpfe fertig sind, stehen die Plätze fest.
// sortiere(objekte) liefert { reihenfolge, gleichstand }: die Objekte in Rangfolge und die Ids, die auch
// nach allen Kriterien mit einem Nachbarn gleichauf bleiben (dort muss ein Stichkampf oder das Los entscheiden).
function berechneJgj(objekte, kaempfe, sortiere) {
    const plaetze = new Map();
    const abgeschlossen = kaempfe.length > 0 && kaempfe.every(fertig);
    let gleichstand = new Set();
    if (abgeschlossen) {
        const r = sortiere(objekte);
        r.reihenfolge.forEach((o, i) => plaetze.set(o.id, i + 1));
        gleichstand = r.gleichstand;
    }
    return { plaetze, abgeschlossen, gleichstand };
}

function jgjEinzelSortierung(kaempfe, entscheidung) {
    return objekte => {
        const nachId = new Map(objekte.map(o => [o.id, o]));
        const r = ordneEinzelRangfolge(objekte.map(o => o.id), kaempfe, { entscheidung });
        return { reihenfolge: r.reihenfolge.map(id => nachId.get(id)), gleichstand: r.gleichstand };
    };
}

// Mannschaften: Begegnungssiege, dann Einzelsiege, dann Wertungspunkte.
function jgjMannschaftSortierung(begegnungen) {
    const vergleich = jgjMannschaftVergleich(begegnungen);
    return objekte => ({ reihenfolge: [...objekte].sort(vergleich), gleichstand: new Set() });
}

function jgjMannschaftVergleich(begegnungen) {
    const wertung = new Map();
    const w = id => {
        if (!wertung.has(id)) wertung.set(id, { siege: 0, einzel: 0, punkte: 0 });
        return wertung.get(id);
    };
    begegnungen.forEach(b => {
        if (b.status !== 'beendet') return;
        if (b.sieger_mannschaft_id) w(b.sieger_mannschaft_id).siege += 1;
        if (b.mannschaft1_id) {
            w(b.mannschaft1_id).einzel += Number(b.siegpunkte_mannschaft1) || 0;
            w(b.mannschaft1_id).punkte += Number(b.wertungspunkte_mannschaft1) || 0;
        }
        if (b.mannschaft2_id) {
            w(b.mannschaft2_id).einzel += Number(b.siegpunkte_mannschaft2) || 0;
            w(b.mannschaft2_id).punkte += Number(b.wertungspunkte_mannschaft2) || 0;
        }
    });
    return (a, b) => (w(b.id).siege - w(a.id).siege) || (w(b.id).einzel - w(a.id).einzel) || (w(b.id).punkte - w(a.id).punkte);
}

// F1 → 1/2, beide Halbfinal-Verlierer → 3, Gruppenplatz 3 → 5, Gruppenplatz 4 → 7, Gruppenplatz 5 → 9
// (sobald die Gruppe fertig ist). Ältere Pools haben noch ein kleines Finale F2; dort gilt weiter F2 → 3/4.
// Gruppen-KO (Viertelfinale VF1-VF4): die vier Viertelfinal-Verlierer → 5, Gruppenplatz 3/4/5 → 9/13/17.
function berechneUeberkreuz(kaempfe, entscheidung = {}) {
    const nachNr = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k]));
    const plaetze = new Map();
    const f1 = nachNr.get('F1');
    const f2 = nachNr.get('F2');
    if (fertig(f1)) {
        setze(plaetze, f1.sieger_id, 1);
        setze(plaetze, verlierer(f1, EINZEL), 2);
    }
    if (!f2) {
        ['HF1', 'HF2'].forEach(nr => setze(plaetze, verlierer(nachNr.get(nr), EINZEL), 3));
    } else if (fertig(f2)) {
        setze(plaetze, f2.sieger_id, 3);
        setze(plaetze, verlierer(f2, EINZEL), 4);
    }
    const viertelfinale = ['VF1', 'VF2', 'VF3', 'VF4'].map(nr => nachNr.get(nr)).filter(Boolean);
    viertelfinale.forEach(k => setze(plaetze, verlierer(k, EINZEL), 5));
    const gruppenPlaetze = viertelfinale.length ? [9, 13, 17] : [5, 7, 9];
    for (const g of VORRUNDEN_GRUPPEN) {
        const praefix = `V_${g}_`;
        const gruppe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith(praefix));
        if (gruppe.length === 0 || !gruppe.every(fertig)) continue;
        const rangliste = berechneGruppenRangliste(kaempfe, praefix, { entscheidung: entscheidung[g] });
        gruppenPlaetze.forEach((platz, i) => setze(plaetze, rangliste[i + 2]?.id, platz));
    }
    return { plaetze, abgeschlossen: fertig(f1) && (!f2 || fertig(f2)) };
}

export function berechnePlatzierungen(pool, kaempfe, teilnehmer) {
    const objekte = [...teilnehmer].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
    if (objekte.length === 1) return baueErgebnis(objekte, new Map([[objekte[0].id, 1]]), true, 'teilnehmer');

    let r = { plaetze: new Map(), abgeschlossen: false };
    if (istJgj(pool.modus)) r = berechneJgj(objekte, kaempfe, jgjEinzelSortierung(kaempfe, leseEntscheidung(pool.gleichstand_entscheidung).pool));
    else if (DK_SCHLUESSEL[pool.modus]) r = berechneKo(kaempfe, DK_SCHLUESSEL[pool.modus], EINZEL);
    else if (istUeberkreuz(pool.modus)) r = berechneUeberkreuz(kaempfe, leseEntscheidung(pool.gleichstand_entscheidung));
    return baueErgebnis(objekte, r.plaetze, r.abgeschlossen, 'teilnehmer', r.gleichstand);
}

export function berechneMannschaftsPlatzierungen(pool, begegnungen, mannschaften) {
    if (mannschaften.length === 1) return baueErgebnis(mannschaften, new Map([[mannschaften[0].id, 1]]), true, 'mannschaft');

    let r = { plaetze: new Map(), abgeschlossen: false };
    if (istJgj(pool.modus)) r = berechneJgj(mannschaften, begegnungen, jgjMannschaftSortierung(begegnungen));
    else if (DK_SCHLUESSEL[pool.modus]) r = berechneKo(begegnungen, DK_SCHLUESSEL[pool.modus], MANNSCHAFT);
    return baueErgebnis(mannschaften, r.plaetze, r.abgeschlossen, 'mannschaft');
}
