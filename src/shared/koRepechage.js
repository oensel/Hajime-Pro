/**
 * KO-System mit Hoffnungsrunde (IJF-Repechage) für 16, 32 und 64 TeilnehmerInnen.
 *
 * Hauptrunde: einfaches KO in vier Pools (A-D = Viertel des Rasters), deren Sieger das Viertelfinale bilden.
 * Hoffnungsrunde: nur die vier Viertelfinal-Verlierer. Verlierer VF1 (Pool A) gegen Verlierer VF2 (Pool B) und
 * VF3 (C) gegen VF4 (D); die Sieger kämpfen um Bronze gegen den Halbfinal-Verlierer der anderen Hälfte.
 * Platzierung: Finale 1/2, Sieger der Bronzekämpfe 3, deren Verlierer 5, Verlierer der Hoffnungsrunde 7.
 *
 * Kampfnummern wie im Doppel-KO: Hauptrunde fortlaufend H1..H(n-2), Finale F1. Hoffnungsrunde T1/T2,
 * Bronzekämpfe T3/T4. Rein deklarativ und DOM-frei (Server, Pool-Ansicht in pools.js und poolAnsicht.js).
 */
export const KO_REPECHAGE_RASTER = { 'KO-Repechage-16': 16, 'KO-Repechage-32': 32, 'KO-Repechage-64': 64 };

export const istKoRepechage = modus => Object.hasOwn(KO_REPECHAGE_RASTER, modus || '');

// Kleinstes KO-Repechage-Raster für die Teilnehmerzahl (null über 64).
export function koRepechageModusFuer(anzahl) {
    if (anzahl <= 16) return 'KO-Repechage-16';
    if (anzahl <= 32) return 'KO-Repechage-32';
    if (anzahl <= 64) return 'KO-Repechage-64';
    return null;
}

// Titel nach Anzahl der Kämpfe der Runde; davor zählen die Runden durch (64er: 1. und 2. Runde).
const RUNDEN_TITEL = { 8: 'Achtelfinale', 4: 'Viertelfinale', 2: 'Halbfinale' };

/**
 * Struktur eines Rasters: Hauptrunden (Kampfnummern je Runde, ohne Finale), Viertel-/Halbfinale und die
 * Topologie im Format von bracketTopologie.js ({ nr: { k1: [quelle, 'sieger'|'verlierer'], k2: [...] } }).
 */
export function baueKoRepechage(raster) {
    const runden = [];
    let nr = 1;
    for (let kaempfe = raster / 2; kaempfe >= 2; kaempfe /= 2) {
        runden.push(Array.from({ length: kaempfe }, () => `H${nr++}`));
    }
    const topologie = {};
    for (let r = 1; r < runden.length; r++) {
        runden[r].forEach((kampfNr, j) => {
            topologie[kampfNr] = { k1: [runden[r - 1][2 * j], 'sieger'], k2: [runden[r - 1][2 * j + 1], 'sieger'] };
        });
    }
    const viertelfinale = runden.at(-2);
    const halbfinale = runden.at(-1);
    topologie.F1 = { k1: [halbfinale[0], 'sieger'], k2: [halbfinale[1], 'sieger'] };
    topologie.T1 = { k1: [viertelfinale[0], 'verlierer'], k2: [viertelfinale[1], 'verlierer'] };
    topologie.T2 = { k1: [viertelfinale[2], 'verlierer'], k2: [viertelfinale[3], 'verlierer'] };
    // über Kreuz: der Sieger der Hoffnungsrunde aus der oberen Hälfte trifft den Halbfinal-Verlierer der unteren
    topologie.T3 = { k1: ['T1', 'sieger'], k2: [halbfinale[1], 'verlierer'] };
    topologie.T4 = { k1: ['T2', 'sieger'], k2: [halbfinale[0], 'verlierer'] };
    return { runden, viertelfinale, halbfinale, topologie };
}

export const KO_REPECHAGE_16_TOPOLOGIE = baueKoRepechage(16).topologie;
export const KO_REPECHAGE_32_TOPOLOGIE = baueKoRepechage(32).topologie;
export const KO_REPECHAGE_64_TOPOLOGIE = baueKoRepechage(64).topologie;

// Rundenaufbau für die Turnierbaum-Ansicht (Format von POOL_RUNDEN in poolRunden.js).
export function koRepechageRunden(raster) {
    const { runden } = baueKoRepechage(raster);
    return {
        winner: [
            ...runden.map((nummern, r) => ({ title: RUNDEN_TITEL[nummern.length] || `${r + 1}. Runde`, nummern })),
            { title: 'Finale', nummern: ['F1'] }
        ],
        loser: [
            { title: 'Hoffnungsrunde', nummern: ['T1', 'T2'] },
            { title: 'Bronze-Kämpfe', nummern: ['T3', 'T4'] }
        ]
    };
}

// Anzeigenamen der Kampfnummern (Kartenüberschrift, Kampfliste, Platzhalter "Sieger VF1").
export function koRepechageKampfnamen(raster) {
    const { runden, viertelfinale, halbfinale } = baueKoRepechage(raster);
    const namen = { F1: 'Finale', T1: 'Hoffnungsrunde 1', T2: 'Hoffnungsrunde 2', T3: 'kleines Finale 1', T4: 'kleines Finale 2' };
    const achtelfinale = runden.at(-3);
    achtelfinale.forEach((nr, i) => { namen[nr] = `AF${i + 1}`; });
    viertelfinale.forEach((nr, i) => { namen[nr] = `VF${i + 1}`; });
    halbfinale.forEach((nr, i) => { namen[nr] = `HF${i + 1}`; });
    return namen;
}

// Reihenfolge der Freilos-Plätze (0-basiert, die ersten raster-N sind Freilose). 16/32 wie im Doppel-KO
// (DOPPEL_KO_RASTER in nachzueglerEinfuegen.js); 64 im selben Muster: die ersten 16 Freilose verteilen sich
// über die 16 Blöcke à zwei Paarungen in der 32er-Reihenfolge, die nächsten 16 auf die zweite Paarung jedes
// Blocks. So bekommt keine Paarung zwei Freilose und die Pools A-D gleich viele.
const FREILOS_16 = [15, 0, 8, 7, 4, 11, 12, 3];
const FREILOS_32 = [1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3];
const BLOCK_REIHENFOLGE = FREILOS_32.map(p => Math.floor(p / 2));
const FREILOS_64 = [
    ...BLOCK_REIHENFOLGE.map(b => 4 * b + 1),
    ...BLOCK_REIHENFOLGE.map(b => 4 * b + 3)
];
export const KO_REPECHAGE_FREILOS = { 16: FREILOS_16, 32: FREILOS_32, 64: FREILOS_64 };
