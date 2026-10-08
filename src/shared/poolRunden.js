/**
 * Rundenaufbau der Turnierbäume pro Modus: welche Kämpfe (reihenfolge_nummer) in welcher Runde
 * stehen — Hauptrunde (winner) und Trostrunde (loser), jeweils von der kopfstärksten zur
 * kleinsten Runde. Rein deklarativ und DOM-frei, genutzt für die Pool-Ansicht in der
 * Steuerung (public/js/poolAnsicht.js). Die Kampfnummern entsprechen den Topologien in
 * bracketTopologie.js.
 */
const nummern = (praefix, von, bis) => Array.from({ length: bis - von + 1 }, (_, i) => `${praefix}${von + i}`);

export const POOL_RUNDEN = {
    'Doppel-KO-8': {
        winner: [
            { title: 'Viertelfinale', nummern: nummern('H', 1, 4) },
            { title: 'Halbfinale', nummern: nummern('H', 5, 6) },
            { title: 'Finale', nummern: ['F'] }
        ],
        loser: [
            { title: 'Trostrunde R1', nummern: nummern('T', 1, 2) },
            { title: 'Bronze-Kämpfe', nummern: nummern('T', 3, 4) }
        ]
    },
    'Doppel-KO-16': {
        winner: [
            { title: 'Achtelfinale', nummern: nummern('H', 1, 8) },
            { title: 'Viertelfinale', nummern: nummern('H', 9, 12) },
            { title: 'Halbfinale', nummern: nummern('H', 13, 14) },
            { title: 'Finale', nummern: ['F1'] }
        ],
        loser: [
            { title: 'Trostrunde R1', nummern: nummern('T', 1, 4) },
            { title: 'Trostrunde R2', nummern: nummern('T', 5, 8) },
            { title: 'Trostrunde R3', nummern: nummern('T', 9, 10) },
            { title: 'Bronze-Kämpfe', nummern: nummern('T', 11, 12) }
        ]
    },
    'Doppel-KO-32': {
        winner: [
            { title: '1. Runde', nummern: nummern('H', 1, 16) },
            { title: 'Achtelfinale', nummern: nummern('H', 17, 24) },
            { title: 'Viertelfinale', nummern: nummern('H', 25, 28) },
            { title: 'Halbfinale', nummern: nummern('H', 29, 30) },
            { title: 'Finale', nummern: ['F1'] }
        ],
        loser: [
            { title: 'Trostrunde R1', nummern: nummern('T', 1, 8) },
            { title: 'Trostrunde R2', nummern: nummern('T', 9, 16) },
            { title: 'Trostrunde R3', nummern: nummern('T', 17, 20) },
            { title: 'Trostrunde R4', nummern: nummern('T', 21, 24) },
            { title: 'Trostrunde R5', nummern: nummern('T', 25, 26) },
            { title: 'Bronze-Kämpfe', nummern: nummern('T', 27, 28) }
        ]
    }
};

// Gruppen-Überkreuz: Vorrunden-Gruppen A/B (Präfix der Kampfnummern) und die Finalrunde.
export const UEBERKREUZ_GRUPPEN = [
    { titel: 'Gruppe A', praefix: 'V_A_' },
    { titel: 'Gruppe B', praefix: 'V_B_' }
];
export const UEBERKREUZ_FINALRUNDE = [
    { title: 'Halbfinale', nummern: ['HF1', 'HF2'] },
    { title: 'Finale', nummern: ['F1', 'F2'] }
];
