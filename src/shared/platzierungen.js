// Platzierungen je Pool — gemeinsame Berechnung für Siegerliste (Browser) und Urkunden (Server).
// Regeln: docs/superpowers/specs/2026-09-29-urkunden-generator-design.md, "Platzierungen je Modus".
// Ein Platz wird gesetzt, sobald der entscheidende Kampf fertig ist; offene Plätze bleiben null.
import { berechneGruppenRangliste } from './gruppenUeberkreuzProgression.js';

const DK_SCHLUESSEL = {
    'Doppel-KO-8': { final: 'F', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] },
    'Doppel-KO-16': { final: 'F1', bronze: ['T11', 'T12'], trost: ['T9', 'T10'] },
    'Doppel-KO-32': { final: 'F1', bronze: ['T27', 'T28'], trost: ['T25', 'T26'] }
};

const istJgj = m => m === 'Jeder-gegen-Jeden' || m === 'Jeder gegen Jeden';
const istUeberkreuz = m => m === 'Gruppen-Überkreuz' || m === 'Gruppen-ueberkreuz';
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

function baueErgebnis(objekte, plaetze, abgeschlossen, schluessel) {
    const eintraege = objekte.map(o => ({ platz: plaetze.get(o.id) ?? null, [schluessel]: o }));
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
function berechneJgj(objekte, kaempfe, ranglisteVergleich) {
    const plaetze = new Map();
    const abgeschlossen = kaempfe.length > 0 && kaempfe.every(fertig);
    if (abgeschlossen) {
        [...objekte].sort(ranglisteVergleich).forEach((o, i) => plaetze.set(o.id, i + 1));
    }
    return { plaetze, abgeschlossen };
}

function jgjEinzelVergleich(kaempfe) {
    const wertung = new Map();
    kaempfe.forEach(k => {
        if (k.status !== 'beendet' || !k.sieger_id) return;
        const w = wertung.get(k.sieger_id) || { siege: 0, punkte: 0 };
        w.siege += 1;
        w.punkte += Number(k.sieger_id === k.kaempfer1_id ? k.unterbewertung_kaempfer1 : k.unterbewertung_kaempfer2) || 0;
        wertung.set(k.sieger_id, w);
    });
    const w = id => wertung.get(id) || { siege: 0, punkte: 0 };
    return (a, b) => (w(b.id).siege - w(a.id).siege) || (w(b.id).punkte - w(a.id).punkte);
}

// Mannschaften: Begegnungssiege, dann Einzelsiege, dann Wertungspunkte.
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

// F1 → 1/2, beide Halbfinal-Verlierer → 3, Gruppenplatz 3 → 5, Gruppenplatz 4 → 7 (sobald die
// Gruppe fertig ist). Ältere Pools haben noch ein kleines Finale F2; dort gilt weiter F2 → 3/4.
function berechneUeberkreuz(kaempfe) {
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
    for (const praefix of ['V_A_', 'V_B_']) {
        const gruppe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith(praefix));
        if (gruppe.length === 0 || !gruppe.every(fertig)) continue;
        const rangliste = berechneGruppenRangliste(kaempfe, praefix);
        setze(plaetze, rangliste[2]?.id, 5);
        setze(plaetze, rangliste[3]?.id, 7);
    }
    return { plaetze, abgeschlossen: fertig(f1) && (!f2 || fertig(f2)) };
}

export function berechnePlatzierungen(pool, kaempfe, teilnehmer) {
    const objekte = [...teilnehmer].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
    if (objekte.length === 1) return baueErgebnis(objekte, new Map([[objekte[0].id, 1]]), true, 'teilnehmer');

    let r = { plaetze: new Map(), abgeschlossen: false };
    if (istJgj(pool.modus)) r = berechneJgj(objekte, kaempfe, jgjEinzelVergleich(kaempfe));
    else if (DK_SCHLUESSEL[pool.modus]) r = berechneKo(kaempfe, DK_SCHLUESSEL[pool.modus], EINZEL);
    else if (istUeberkreuz(pool.modus)) r = berechneUeberkreuz(kaempfe);
    return baueErgebnis(objekte, r.plaetze, r.abgeschlossen, 'teilnehmer');
}

export function berechneMannschaftsPlatzierungen(pool, begegnungen, mannschaften) {
    if (mannschaften.length === 1) return baueErgebnis(mannschaften, new Map([[mannschaften[0].id, 1]]), true, 'mannschaft');

    let r = { plaetze: new Map(), abgeschlossen: false };
    if (istJgj(pool.modus)) r = berechneJgj(mannschaften, begegnungen, jgjMannschaftVergleich(begegnungen));
    else if (DK_SCHLUESSEL[pool.modus]) r = berechneKo(begegnungen, DK_SCHLUESSEL[pool.modus], MANNSCHAFT);
    return baueErgebnis(mannschaften, r.plaetze, r.abgeschlossen, 'mannschaft');
}
