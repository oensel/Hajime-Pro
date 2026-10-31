/**
 * Reine, seiteneffektfreie Kern-Logik für den einen Übergang im Gruppen-Überkreuz-Modus, der
 * sich NICHT auf einen einzelnen Quellkampf reduzieren lässt und daher außerhalb von
 * kampfProgression.js liegt: HF1/HF2 kommen aus einer N-zu-2-Ranglistenberechnung über die
 * Vorrundenkämpfe jeder Gruppe (Judo-Regelwerk: meiste Siege, dann höhere Unterbewertung), nicht
 * aus dem Ergebnis eines einzelnen Kampfes (siehe GruppenUeberKreuzManager.js).
 *
 * Bis zur Extraktion hierher existierte diese Berechnung NUR serverseitig in
 * GruppenUeberKreuzManager.js — der clientseitige Offline-Scoreboard (public/js/scoreboard.js)
 * kannte dadurch nur die generische kampfProgression.js-Kaskade und konnte Gruppen-Überkreuz-
 * Pools nie über die Vorrunde hinaus fortschreiben, solange die Matte offline lief (HF1/HF2
 * blieben unbefüllt und damit unspielbar, obwohl ihre Kämpfer:innen längst feststanden).
 *
 * Modus-unabhängig wie kampfProgression.js: erkennt seine Zuständigkeit rein strukturell an den
 * reihenfolge_nummer-Mustern ('V_A_*' … 'V_D_*'-Vorrunde + 'HF1'/'HF2'- bzw. 'VF1'-'VF4'-Hüllen), nicht an
 * einem separat mitgeführten pool.modus-Feld. Gilt für Gruppen-Überkreuz (2 Gruppen) und Gruppen-KO
 * (4 Gruppen); die Gruppen haben 3 bis 5 Teilnehmer.
 *
 * Keine Abhängigkeit von knex/DOM/localStorage — nutzbar sowohl server- (Node) als auch
 * client-seitig (Browser, ES-Modul).
 */
import { ordneEinzelRangfolge } from './jgjRangfolge.js';
import { pruefeGleichstand, leseEntscheidung, RELEVANT_BIS_GRUPPE } from './gleichstand.js';

// Vorrundengruppen (Präfix der Kampfnummern V_A_1, V_B_1, …); Gruppen-Überkreuz nutzt A und B, Gruppen-KO A bis D.
export const VORRUNDEN_GRUPPEN = ['A', 'B', 'C', 'D'];

// Endrunde: welcher Kampf welche Gruppenplätze bekommt (Kämpfer 1, Kämpfer 2), über Kreuz.
// Gruppen-Überkreuz (2 Gruppen): Halbfinale. Gruppen-KO (4 Gruppen): Viertelfinale, so dass sich Erster und Zweiter
// einer Gruppe erst im Finale treffen können (A1/B2 und C1/D2 oben, B1/A2 und D1/C2 unten); HF1/HF2/F1 folgen
// dort über die normale Kaskade (GRUPPEN_KO_TOPOLOGIE).
const ENDRUNDE_UEBERKREUZ = {
    HF1: [['A', 1], ['B', 2]],
    HF2: [['B', 1], ['A', 2]]
};
const ENDRUNDE_KO = {
    VF1: [['A', 1], ['B', 2]],
    VF2: [['C', 1], ['D', 2]],
    VF3: [['B', 1], ['A', 2]],
    VF4: [['D', 1], ['C', 2]]
};

// Welcher Plan gilt, erkennt der Pool an seinen Kämpfen (VF1 gibt es nur im Gruppen-KO).
export function endrundePlan(kaempfe) {
    return (kaempfe || []).some(k => k.reihenfolge_nummer === 'VF1') ? ENDRUNDE_KO : ENDRUNDE_UEBERKREUZ;
}

// Die Gruppen, die im Pool tatsächlich Vorrundenkämpfe haben.
export function gruppenImPool(kaempfe) {
    return VORRUNDEN_GRUPPEN.filter(g => (kaempfe || []).some(k => k.reihenfolge_nummer?.startsWith(`V_${g}_`)));
}

// Stichkämpfe einer Vorrundengruppe tragen die Nummer V_A_S1, V_A_S2, … (gehören nicht zu den regulären Vorrundenkämpfen).
const STICHKAMPF_NUMMER = /^V_[A-D]_S/;

export const gruppeDerNummer = nr => /^V_([A-D])_/.exec(String(nr ?? ''))?.[1] ?? null;

function nachNummer(kaempfe) {
    return [...kaempfe].sort((a, b) => String(a.reihenfolge_nummer).localeCompare(String(b.reihenfolge_nummer), 'de', { numeric: true }));
}

// Kämpfer einer Gruppe in der Reihenfolge der Kampfnummern (gilt bei unentschiedenem Gleichstand).
function gruppenTeilnehmerIds(gruppenKaempfe) {
    const ids = new Set();
    nachNummer(gruppenKaempfe).forEach(k => {
        if (k.kaempfer1_id) ids.add(k.kaempfer1_id);
        if (k.kaempfer2_id) ids.add(k.kaempfer2_id);
    });
    return Array.from(ids);
}

/**
 * Berechnet die Rangliste einer Vorrunden-Gruppe aus deren beendeten Kämpfen: meiste Siege, dann höhere
 * Unterbewertung, dann der direkte Vergleich der Punktgleichen (jgjRangfolge.js, sinngemäß DJB-WO 4.1.7.2).
 * Bleibt auch danach ein Gleichstand (z. B. Dreierkreis), ist `gleichstand` gesetzt und die Reihenfolge
 * die der Kampfnummern (V_A_1, V_A_2, …), unabhängig von der Reihenfolge des übergebenen Arrays (die DB
 * liefert sie ohne ORDER BY in beliebiger Reihenfolge, Server und Offline-Matte müssen gleich entscheiden).
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools
 * @param {string} praefix - 'V_A_', 'V_B_', …
 * @param {{ entscheidung?: Array<Array<number>> }} [optionen] - von der Turnierleitung entschiedene Gleichstände dieser Gruppe
 * @returns {Array<{id: number, siege: number, unterbewertung: number, gleichstand: boolean}>} absteigend sortiert
 */
export function berechneGruppenRangliste(kaempfe, praefix, optionen = {}) {
    const gruppenKaempfe = nachNummer(kaempfe.filter(k => k.status === 'beendet' && k.reihenfolge_nummer?.startsWith(praefix)));
    const teilnehmerIds = gruppenTeilnehmerIds(gruppenKaempfe);

    const { reihenfolge, gleichstand, wertung } = ordneEinzelRangfolge(teilnehmerIds, gruppenKaempfe, { entscheidung: optionen.entscheidung });
    return reihenfolge.map(id => ({ id, siege: wertung.get(id).siege, unterbewertung: wertung.get(id).punkte, gleichstand: gleichstand.has(id) }));
}

/**
 * Ist die Vorrunde einer Gruppe ausgekämpft? Jeder gegen jeden: n Teilnehmer, n·(n-1)/2 reguläre Kämpfe, alle
 * beendet (Stichkämpfe der Gruppe eingeschlossen).
 */
export function gruppeFertig(kaempfe, gruppe) {
    const gruppenKaempfe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith(`V_${gruppe}_`));
    const regulaer = gruppenKaempfe.filter(k => !STICHKAMPF_NUMMER.test(k.reihenfolge_nummer));
    const n = gruppenTeilnehmerIds(regulaer).length;
    return n >= 2 && regulaer.length === (n * (n - 1)) / 2 && gruppenKaempfe.every(k => k.status === 'beendet');
}

/**
 * Berechnet die Kämpfer-Patches für die Endrunde (HF1/HF2), sobald die beiden Gruppen eines Endrunden-Kampfes
 * ausgekämpft sind. Rein additiv/idempotent wie berechneKaempferPatches: ein Kampf, der fehlt oder schon befüllt
 * ist, bleibt unberührt.
 * Solange in einer Gruppe Stichkämpfe offen sind oder Platz 1 und 2 nach Siegen, Wertungspunkten und direktem
 * Vergleich nicht eindeutig sind (und die Turnierleitung den Gleichstand nicht entschieden hat), bleiben die
 * Endrunden-Kämpfe dieser Gruppe unbefüllt.
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools: reihenfolge_nummer, status,
 *   kaempfer1_id, kaempfer2_id, sieger_id, unterbewertung_kaempfer1/2
 * @param {{ entscheidung?: Object|string }} [optionen] - pools.gleichstand_entscheidung, Schlüssel je Gruppe ('A', 'B')
 * @returns {Array<{id: number, kaempfer1_id: number, kaempfer2_id: number, status: string}>}
 */
export function berechneGruppenUeberkreuzHalbfinalPatches(kaempfe, optionen = {}) {
    const entscheidung = leseEntscheidung(optionen.entscheidung);
    const ranglisten = new Map();
    const platzIn = (gruppe, platz) => {
        if (!ranglisten.has(gruppe)) {
            let rangliste = null;
            if (gruppeFertig(kaempfe, gruppe)) {
                const gruppenKaempfe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith(`V_${gruppe}_`));
                const ids = gruppenTeilnehmerIds(gruppenKaempfe);
                const offen = pruefeGleichstand(ids, gruppenKaempfe, { bis: RELEVANT_BIS_GRUPPE, entscheidung: entscheidung[gruppe] }).offen;
                if (!offen) rangliste = berechneGruppenRangliste(kaempfe, `V_${gruppe}_`, { entscheidung: entscheidung[gruppe] });
            }
            ranglisten.set(gruppe, rangliste);
        }
        return ranglisten.get(gruppe)?.[platz - 1]?.id ?? null;
    };

    const patches = [];
    for (const [nummer, [slot1, slot2]] of Object.entries(endrundePlan(kaempfe))) {
        const kampf = kaempfe.find(k => k.reihenfolge_nummer === nummer);
        if (!kampf || kampf.kaempfer1_id || kampf.kaempfer2_id) continue;
        const k1 = platzIn(...slot1);
        const k2 = platzIn(...slot2);
        if (!k1 || !k2) continue;
        // status: 'bereit' ist Pflicht, nicht nur Kosmetik: planeKaempfeFuerKampfflaeche() (und die
        // "nächster Kampf"-Auswahl in kampf.js/scoreboard.js) filtern beim Aufbau der Matten-
        // Warteschlange strikt auf status === 'bereit'. Ohne dieses Feld blieben HF1/HF2 für immer
        // auf 'angelegt' stehen (berechneKaempferPatches() überspringt sie, da sie keine
        // kaempferN_quelle_kampf_id haben) und wären trotz bekannter Kämpfer nie startbar.
        patches.push({ id: kampf.id, kaempfer1_id: k1, kaempfer2_id: k2, status: 'bereit' });
    }
    return patches;
}

// Endrunden-Kämpfe, die Plätze dieser Gruppe aufnehmen (für Gleichstand und Korrektur).
export function endrundeDerGruppe(gruppe, kaempfe) {
    return Object.entries(endrundePlan(kaempfe)).filter(([, slots]) => slots.some(([g]) => g === gruppe)).map(([nr]) => nr);
}
