/**
 * Reine, seiteneffektfreie Kern-Logik für den einen Übergang im Gruppen-Überkreuz-Modus, der
 * sich NICHT auf einen einzelnen Quellkampf reduzieren lässt und daher außerhalb von
 * kampfProgression.js liegt: HF1/HF2 kommen aus einer N-zu-2-Ranglistenberechnung über je drei
 * Vorrundenkämpfe pro Gruppe (Judo-Regelwerk: meiste Siege, dann höhere Unterbewertung), nicht
 * aus dem Ergebnis eines einzelnen Kampfes (siehe GruppenUeberKreuzManager.js).
 *
 * Bis zur Extraktion hierher existierte diese Berechnung NUR serverseitig in
 * GruppenUeberKreuzManager.js — der clientseitige Offline-Scoreboard (public/js/scoreboard.js)
 * kannte dadurch nur die generische kampfProgression.js-Kaskade und konnte Gruppen-Überkreuz-
 * Pools nie über die Vorrunde hinaus fortschreiben, solange die Matte offline lief (HF1/HF2
 * blieben unbefüllt und damit unspielbar, obwohl ihre Kämpfer:innen längst feststanden).
 *
 * Modus-unabhängig wie kampfProgression.js: erkennt seine Zuständigkeit rein strukturell an den
 * reihenfolge_nummer-Mustern ('V_A_*'/'V_B_*'-Vorrunde + 'HF1'/'HF2'-Hüllen), nicht an einem
 * separat mitgeführten pool.modus-Feld.
 *
 * Keine Abhängigkeit von knex/DOM/localStorage — nutzbar sowohl server- (Node) als auch
 * client-seitig (Browser, ES-Modul).
 */
import { ordneEinzelRangfolge } from './jgjRangfolge.js';
import { pruefeGleichstand, leseEntscheidung, RELEVANT_BIS_GRUPPE } from './gleichstand.js';

// Stichkämpfe einer Vorrundengruppe tragen die Nummer V_A_S1, V_A_S2, … (gehören nicht zu den sechs Vorrundenkämpfen).
const STICHKAMPF_NUMMER = /^V_[AB]_S/;

/**
 * Berechnet die Rangliste einer Vorrunden-Gruppe aus deren beendeten Kämpfen: meiste Siege, dann höhere
 * Unterbewertung, dann der direkte Vergleich der Punktgleichen (jgjRangfolge.js, sinngemäß DJB-WO 4.1.7.2).
 * Bleibt auch danach ein Gleichstand (z. B. Dreierkreis), ist `gleichstand` gesetzt und die Reihenfolge
 * die der Kampfnummern (V_A_1, V_A_2, …), unabhängig von der Reihenfolge des übergebenen Arrays (die DB
 * liefert sie ohne ORDER BY in beliebiger Reihenfolge, Server und Offline-Matte müssen gleich entscheiden);
 * ein Stichkampf ist in der Vorrunde nicht vorgesehen.
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools
 * @param {string} praefix - 'V_A_' oder 'V_B_'
 * @param {{ entscheidung?: Array<Array<number>> }} [optionen] - von der Turnierleitung entschiedene Gleichstände dieser Gruppe
 * @returns {Array<{id: number, siege: number, unterbewertung: number, gleichstand: boolean}>} absteigend sortiert
 */
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

export function berechneGruppenRangliste(kaempfe, praefix, optionen = {}) {
    const gruppenKaempfe = nachNummer(kaempfe.filter(k => k.status === 'beendet' && k.reihenfolge_nummer?.startsWith(praefix)));
    const teilnehmerIds = gruppenTeilnehmerIds(gruppenKaempfe);

    const { reihenfolge, gleichstand, wertung } = ordneEinzelRangfolge(teilnehmerIds, gruppenKaempfe, { entscheidung: optionen.entscheidung });
    return reihenfolge.map(id => ({ id, siege: wertung.get(id).siege, unterbewertung: wertung.get(id).punkte, gleichstand: gleichstand.has(id) }));
}

/**
 * Berechnet die Kämpfer-Patches für HF1/HF2, sobald die Vorrunde (6 Kämpfe V_A_1..3/V_B_1..3)
 * komplett beendet ist. Rein additiv/idempotent wie berechneKaempferPatches: liefert eine leere
 * Liste, wenn HF1/HF2 nicht (mehr) existieren, die Vorrunde noch nicht komplett ist, oder HF1
 * bereits befüllt wurde.
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools: reihenfolge_nummer, status,
 *   kaempfer1_id, kaempfer2_id, sieger_id, unterbewertung_kaempfer1/2
 * Solange in einer Gruppe Stichkämpfe offen sind oder Platz 1 und 2 nach Siegen, Wertungspunkten und direktem Vergleich nicht
 * eindeutig sind (und die Turnierleitung den Gleichstand nicht entschieden hat), bleiben HF1/HF2 unbefüllt.
 * @param {{ entscheidung?: Object|string }} [optionen] - pools.gleichstand_entscheidung, Schlüssel 'A' und 'B'
 * @returns {Array<{id: number, kaempfer1_id: number, kaempfer2_id: number, status: string}>}
 */
export function berechneGruppenUeberkreuzHalbfinalPatches(kaempfe, optionen = {}) {
    const hf1 = kaempfe.find(k => k.reihenfolge_nummer === 'HF1');
    const hf2 = kaempfe.find(k => k.reihenfolge_nummer === 'HF2');
    if (!hf1 || !hf2 || hf1.kaempfer1_id || hf2.kaempfer1_id) return [];

    const vorrundenKaempfe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith('V_'));
    const regulaer = vorrundenKaempfe.filter(k => !STICHKAMPF_NUMMER.test(k.reihenfolge_nummer));
    const vorrundeFertig = regulaer.length === 6 && vorrundenKaempfe.every(k => k.status === 'beendet');
    if (!vorrundeFertig) return [];

    const entscheidung = leseEntscheidung(optionen.entscheidung);
    for (const gruppe of ['A', 'B']) {
        const gruppenKaempfe = vorrundenKaempfe.filter(k => k.reihenfolge_nummer.startsWith(`V_${gruppe}_`));
        const ids = gruppenTeilnehmerIds(gruppenKaempfe);
        if (pruefeGleichstand(ids, gruppenKaempfe, { bis: RELEVANT_BIS_GRUPPE, entscheidung: entscheidung[gruppe] }).offen) return [];
    }

    const ranglisteA = berechneGruppenRangliste(kaempfe, 'V_A_', { entscheidung: entscheidung.A });
    const ranglisteB = berechneGruppenRangliste(kaempfe, 'V_B_', { entscheidung: entscheidung.B });

    const ersterA = ranglisteA[0]?.id;
    const zweiterA = ranglisteA[1]?.id;
    const ersterB = ranglisteB[0]?.id;
    const zweiterB = ranglisteB[1]?.id;
    if (!ersterA || !zweiterA || !ersterB || !zweiterB) return [];

    // status: 'bereit' ist Pflicht, nicht nur Kosmetik: planeKaempfeFuerKampfflaeche() (und die
    // "nächster Kampf"-Auswahl in kampf.js/scoreboard.js) filtern beim Aufbau der Matten-
    // Warteschlange strikt auf status === 'bereit'. Ohne dieses Feld blieben HF1/HF2 für immer
    // auf 'angelegt' stehen (berechneKaempferPatches() überspringt sie, da sie keine
    // kaempferN_quelle_kampf_id haben) und wären trotz bekannter Kämpfer nie startbar.
    return [
        { id: hf1.id, kaempfer1_id: ersterA, kaempfer2_id: zweiterB, status: 'bereit' },
        { id: hf2.id, kaempfer1_id: ersterB, kaempfer2_id: zweiterA, status: 'bereit' }
    ];
}
