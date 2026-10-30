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

/**
 * Berechnet die Rangliste einer Vorrunden-Gruppe aus deren beendeten Kämpfen: meiste Siege, dann höhere
 * Unterbewertung, dann der direkte Vergleich der Punktgleichen (jgjRangfolge.js, sinngemäß DJB-WO 4.1.7.2).
 * Bleibt auch danach ein Gleichstand (z. B. Dreierkreis), ist `gleichstand` gesetzt und die Reihenfolge
 * die der Kampfanlage; ein Stichkampf ist in der Vorrunde nicht vorgesehen.
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools
 * @param {string} praefix - 'V_A_' oder 'V_B_'
 * @returns {Array<{id: number, siege: number, unterbewertung: number, gleichstand: boolean}>} absteigend sortiert
 */
export function berechneGruppenRangliste(kaempfe, praefix) {
    const gruppenKaempfe = kaempfe.filter(k => k.status === 'beendet' && k.reihenfolge_nummer?.startsWith(praefix));

    const teilnehmerIds = new Set();
    gruppenKaempfe.forEach(k => {
        if (k.kaempfer1_id) teilnehmerIds.add(k.kaempfer1_id);
        if (k.kaempfer2_id) teilnehmerIds.add(k.kaempfer2_id);
    });

    const { reihenfolge, gleichstand, wertung } = ordneEinzelRangfolge(Array.from(teilnehmerIds), gruppenKaempfe);
    return reihenfolge.map(id => ({ id, siege: wertung.get(id).siege, unterbewertung: wertung.get(id).punkte, gleichstand: gleichstand.has(id) }));
}

/**
 * Berechnet die Kämpfer-Patches für HF1/HF2, sobald die Vorrunde (6 Kämpfe V_A_1..3/V_B_1..3)
 * komplett beendet ist. Rein additiv/idempotent wie berechneKaempferPatches: liefert eine leere
 * Liste, wenn HF1/HF2 nicht (mehr) existieren, die Vorrunde noch nicht komplett ist, oder HF1
 * bereits befüllt wurde.
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools: reihenfolge_nummer, status,
 *   kaempfer1_id, kaempfer2_id, sieger_id, unterbewertung_kaempfer1/2
 * @returns {Array<{id: number, kaempfer1_id: number, kaempfer2_id: number, status: string}>}
 */
export function berechneGruppenUeberkreuzHalbfinalPatches(kaempfe) {
    const hf1 = kaempfe.find(k => k.reihenfolge_nummer === 'HF1');
    const hf2 = kaempfe.find(k => k.reihenfolge_nummer === 'HF2');
    if (!hf1 || !hf2 || hf1.kaempfer1_id || hf2.kaempfer1_id) return [];

    const vorrundenKaempfe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith('V_'));
    const vorrundeFertig = vorrundenKaempfe.length === 6 && vorrundenKaempfe.every(k => k.status === 'beendet');
    if (!vorrundeFertig) return [];

    const ranglisteA = berechneGruppenRangliste(kaempfe, 'V_A_');
    const ranglisteB = berechneGruppenRangliste(kaempfe, 'V_B_');

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
