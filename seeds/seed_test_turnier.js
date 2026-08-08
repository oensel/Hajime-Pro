// seeds/seed_test_turnier.js
// Testdaten: ~90 Teilnehmer in 2 Altersklassen (weiblich U13, Männer)
// Ausführen: node seeds/seed_test_turnier.js

import knexLib from 'knex';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

const knex = knexLib(knexConfig.offline);

// --- HILFSFUNKTIONEN ---

/** Zufälliges Gewicht im Bereich [min, max], auf 1 Dezimale gerundet */
function zufallsGewicht(min, max) {
    return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

/** Zufälliges Geburtsjahr im Bereich [startJahr, endeJahr] */
function zufallsJahr(startJahr, endeJahr) {
    return startJahr + Math.floor(Math.random() * (endeJahr - startJahr + 1));
}

/** Fortlaufende Judopass-ID */
let passCounter = 10000;
function naechstePassId() {
    return `DE-BW-${++passCounter}`;
}

// --- NAMEN-POOLS ---

const weiblicheVornamen = [
    'Emma', 'Mia', 'Hannah', 'Sophia', 'Emilia', 'Lina', 'Anna', 'Marie',
    'Lea', 'Clara', 'Luisa', 'Johanna', 'Laura', 'Ella', 'Lena', 'Amelie',
    'Frieda', 'Ida', 'Nele', 'Maja', 'Charlotte', 'Mila', 'Greta', 'Helena',
    'Mathilda', 'Lotta', 'Finja', 'Pia', 'Juna', 'Rosalie', 'Stella', 'Lilly',
    'Thea', 'Antonia', 'Victoria', 'Zoe', 'Alina', 'Isabel', 'Klara', 'Marlene',
    'Paula', 'Romy', 'Sina', 'Tessa', 'Valentina', 'Ylva', 'Annika', 'Carlotta'
];

const maennlicheVornamen = [
    'Leon', 'Felix', 'Paul', 'Elias', 'Noah', 'Ben', 'Luis', 'Jonas',
    'Finn', 'Lukas', 'Maximilian', 'Moritz', 'Jan', 'Tim', 'David', 'Niklas',
    'Julian', 'Tom', 'Erik', 'Henrik', 'Anton', 'Theo', 'Emil', 'Jakob',
    'Karl', 'Oskar', 'Liam', 'Matteo', 'Alexander', 'Sebastian', 'Florian', 'Daniel',
    'Philipp', 'Tobias', 'Stefan', 'Michael', 'Christian', 'Markus', 'Andreas', 'Thomas',
    'Matthias', 'Patrick', 'Dominik', 'Kevin', 'Marcel', 'Dennis', 'Sven', 'Kai',
    'Oliver', 'Robert', 'Martin', 'Bastian', 'Jens', 'Marco', 'René', 'Torsten'
];

const nachnamen = [
    'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker',
    'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf',
    'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann',
    'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Schmid',
    'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber',
    'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung',
    'Hahn', 'Schubert', 'Vogel', 'Friedrich', 'Keller', 'Günther', 'Frank', 'Berger',
    'Roth', 'Beck', 'Lorenz', 'Baumann'
];

const vereine = [
    'JC Durlach', 'TV Ettlingen', 'PSV Karlsruhe', 'JC Rastatt', 'TSV Bruchsal',
    'KSV Mühlburg', 'SC Pforzheim', 'TV Baden-Baden', 'JC Bretten', 'SV Stutensee',
    'TG Ötigheim', 'JC Rheinstetten', 'TV Malsch', 'SC Gaggenau', 'JC Bühl'
];

function zufallsElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- TEILNEHMER-GENERIERUNG ---

/**
 * Erzeugt Teilnehmer für eine Gewichtsklasse.
 * @param {number} anzahl - Anzahl Teilnehmer
 * @param {string} geschlecht - 'weiblich' oder 'männlich'
 * @param {string} altersklasse - z.B. 'U13', 'Männer'
 * @param {string} gewichtsklasse - z.B. '-30', '+57'
 * @param {number} gewichtMin - Untere Gewichtsgrenze
 * @param {number} gewichtMax - Obere Gewichtsgrenze
 * @param {number} gebStartJahr - Frühestes Geburtsjahr
 * @param {number} gebEndeJahr - Spätestes Geburtsjahr
 */
function erzeugeTeilnehmer(anzahl, geschlecht, altersklasse, gewichtsklasse, gewichtMin, gewichtMax, gebStartJahr, gebEndeJahr) {
    const vornamenPool = geschlecht === 'weiblich' ? weiblicheVornamen : maennlicheVornamen;
    const teilnehmer = [];

    for (let i = 0; i < anzahl; i++) {
        teilnehmer.push({
            judopass_id: naechstePassId(),
            vorname: zufallsElement(vornamenPool),
            nachname: zufallsElement(nachnamen),
            geburtsjahr: zufallsJahr(gebStartJahr, gebEndeJahr),
            lizenz_ablauf: '2027-06-30',
            geschlecht,
            verein: zufallsElement(vereine),
            gewicht: zufallsGewicht(gewichtMin, gewichtMax),
            altersklasse,
            gewichtsklasse,
            startgeld_bezahlt: Math.random() < 0.7 ? 1 : 0
        });
    }

    return teilnehmer;
}

// =====================================================================
// VERTEILUNG: mixed U9  (7 Klassen, ~37 Teilnehmer)
//   Geburtsjahre 2018-2019 (Alter 7-8 in 2026)
// =====================================================================
function erzeugeMixedTeilnehmer(anzahl, altersklasse, gewichtsklasse, gewichtMin, gewichtMax, gebStartJahr, gebEndeJahr) {
    const teilnehmer = [];
    for (let i = 0; i < anzahl; i++) {
        const istWeiblich = Math.random() < 0.5;
        const vornamenPool = istWeiblich ? weiblicheVornamen : maennlicheVornamen;
        teilnehmer.push({
            judopass_id: naechstePassId(),
            vorname: zufallsElement(vornamenPool),
            nachname: zufallsElement(nachnamen),
            geburtsjahr: zufallsJahr(gebStartJahr, gebEndeJahr),
            lizenz_ablauf: '2027-06-30',
            geschlecht: 'mixed',
            verein: zufallsElement(vereine),
            gewicht: zufallsGewicht(gewichtMin, gewichtMax),
            altersklasse,
            gewichtsklasse,
            startgeld_bezahlt: Math.random() < 0.7 ? 1 : 0
        });
    }
    return teilnehmer;
}

const u9mixed = [
    //  Klasse    Anz   GewMin  GewMax
    ...erzeugeMixedTeilnehmer( 4, 'U9', '-20',  17.0, 20.0,  2018, 2019),
    ...erzeugeMixedTeilnehmer( 6, 'U9', '-22',  20.1, 22.0,  2018, 2019),
    ...erzeugeMixedTeilnehmer( 8, 'U9', '-25',  22.1, 25.0,  2018, 2019),
    ...erzeugeMixedTeilnehmer( 5, 'U9', '-28',  25.1, 28.0,  2018, 2019),
    ...erzeugeMixedTeilnehmer( 7, 'U9', '-31',  28.1, 31.0,  2018, 2019),
    ...erzeugeMixedTeilnehmer( 4, 'U9', '-34',  31.1, 34.0,  2018, 2019),
];

const u11m = [
    //  Klasse    Anz   GewMin  GewMax
    ...erzeugeTeilnehmer( 4, 'männlich', 'U11', '-25',  21.0, 25.0,  2016, 2017),
    ...erzeugeTeilnehmer( 6, 'männlich', 'U11', '-29',  25.1, 29.0,  2016, 2017),
    ...erzeugeTeilnehmer( 8, 'männlich', 'U11', '-34',  29.1, 34.0,  2016, 2017),
    ...erzeugeTeilnehmer( 5, 'männlich', 'U11', '-40',  34.1, 40.0,  2016, 2017),
    ...erzeugeTeilnehmer( 4, 'männlich', 'U11', '+46',  46.1, 55.0,  2016, 2017),
];

const u11w = [
    //  Klasse    Anz   GewMin  GewMax
    ...erzeugeTeilnehmer( 3, 'weiblich', 'U11', '-24',  20.0, 24.0,  2016, 2017),
    ...erzeugeTeilnehmer( 5, 'weiblich', 'U11', '-28',  24.1, 28.0,  2016, 2017),
    ...erzeugeTeilnehmer( 7, 'weiblich', 'U11', '-33',  28.1, 33.0,  2016, 2017),
    ...erzeugeTeilnehmer( 6, 'weiblich', 'U11', '-40',  33.1, 40.0,  2016, 2017),
    ...erzeugeTeilnehmer( 4, 'weiblich', 'U11', '+48',  48.1, 55.0,  2016, 2017),
];

const alleTeilnehmer = [...u9mixed, ...u11m, ...u11w];

// Set weight to 0.0 for 3 participants to simulate "not weighed in yet"
for (let i = 0; i < 3; i++) {
    if (alleTeilnehmer[i]) {
        alleTeilnehmer[i].gewicht = 0.0;
    }
}

// --- DATENBANK BEFÜLLEN ---

async function seed() {
    console.log('🧹 Lösche bestehende Testdaten...');

    // Reihenfolge wegen Foreign Keys: Kämpfe → Teilnehmer → Pools → Kampfflächen → Turniere
    await knex('kaempfe').del();
    await knex('turnier_teilnehmer').del();
    await knex('pools').del();
    await knex('kampfflaechen').del();
    await knex('turniere').del();

    console.log('🏯 Erstelle Turnier...');

    const [turnierIdObj] = await knex('turniere').insert({
        bezeichnung: '1. Lokaler Judo-CUP 2026',
        ort: 'Senden',
        datum: '2026-07-05',
        ausrichter: 'Judo Club Senden e.V.',
        nutze_gewichtsklassen: 0,
        altersklassen: JSON.stringify({
            "mixed_U9": "gewichtsnahe",
            "männlich_U11": "djb",
            "weiblich_U11": "djb"
        }),
        anzahl_kampfflaechen: 3
    }).returning('id');
    const turnierId = typeof turnierIdObj === 'object' ? turnierIdObj.id : turnierIdObj;

    console.log(`✅ Turnier erstellt (ID: ${turnierId})`);

    // Kampfflächen anlegen
    for (let m = 1; m <= 3; m++) {
        await knex('kampfflaechen').insert({
            turnier_id: turnierId,
            bezeichnung: `Matte ${m}`
        });
    }

    console.log('🥋 Füge Teilnehmer ein...');

    // Batch-Insert in Gruppen von 20
    for (let i = 0; i < alleTeilnehmer.length; i += 20) {
        const batch = alleTeilnehmer.slice(i, i + 20).map(t => ({
            ...t,
            turnier_id: turnierId
        }));
        await knex('turnier_teilnehmer').insert(batch);
    }

    // --- STATISTIK ---
    const u9Count = u9mixed.length;
    const u11mCount = u11m.length;
    const u11wCount = u11w.length;

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║          TESTDATEN ERFOLGREICH ERSTELLT          ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Turnier:    1. Lokaler Judo-CUP 2026           ║`);
    console.log(`║  Ort:        Karlsruhe-Durlach                  ║`);
    console.log(`║  Matten:     3                                  ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  mixed U9:        ${String(u9Count).padStart(3)} Teilnehmer               ║`);
    console.log(`║  männlich U11:    ${String(u11mCount).padStart(3)} Teilnehmer               ║`);
    console.log(`║  weiblich U11:    ${String(u11wCount).padStart(3)} Teilnehmer               ║`);
    console.log(`║  ─────────────────────────────────               ║`);
    console.log(`║  GESAMT:          ${String(u9Count + u11mCount + u11wCount).padStart(3)} Teilnehmer               ║`);
    console.log('╚══════════════════════════════════════════════════╝');
}

seed()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Fehler beim Seeden:', err);
        process.exit(1);
    });
