// Nachzügler in einen bereits laufenden Pool (Spec docs/specs/2026-10-14-nachzuegler-laufender-pool.md).
// Reine Regeln ohne DB/DOM, damit Server (Einsortieren, Vorschlagsliste) und Planer dasselbe rechnen.
//
// Grundsatz: Ein Pool, in dem schon ein Kampf läuft oder beendet ist, wechselt sein Wettkampfsystem nie.
// Aufgenommen werden kann ein Nachzügler dann nur dort, wo er ohne Systemwechsel und ohne Eingriff in
// bereits ausgetragene Kämpfe hineinpasst:
//  - Jeder-gegen-Jeden (2–5): er bekommt Kämpfe gegen alle, solange genug Kämpfe offen sind.
//  - Doppel-KO-8/16/32: er nimmt den nächsten freien Freilos-Platz des Rasters (feste DJB-Reihenfolge), solange
//    die Kämpfe, die von diesem Platz abhängen, noch nicht begonnen haben.
//  - Gruppen-Überkreuz (genau 6): nie, mit 7 wäre es Doppel-KO-8.
import { KO_REPECHAGE_RASTER, KO_REPECHAGE_FREILOS } from './koRepechage.js';

export const SYSTEM_JEDER_GEGEN_JEDEN = 'Jeder-gegen-Jeden';
const OFFENE_STATI = new Set(['bereit', 'angelegt', 'vorbereiten']);
const BEGONNEN_STATI = new Set(['gestartet', 'beendet']);
const ABGESCHLOSSENE_POOL_STATI = new Set(['kaempfe_beendet', 'abgeschlossen']);

export function poolHatBegonnen(kaempfe) {
    return (kaempfe || []).some(k => BEGONNEN_STATI.has(k.status));
}

// Raster und Reihenfolge der Freilos-Plätze je Doppel-KO-System (0-basierte Rasterplätze, identisch zu den
// *Manager.js, die den Baum aufbauen: bei N Teilnehmern sind die ersten raster-N Einträge Freilose).
// KO-Repechage nimmt Nachzügler genauso auf (Freilos-Reihenfolge in koRepechage.js).
export const DOPPEL_KO_RASTER = {
    'Doppel-KO-8': { raster: 8, freilos: [7, 0, 4, 3] },
    'Doppel-KO-16': { raster: 16, freilos: [15, 0, 8, 7, 4, 11, 12, 3] },
    'Doppel-KO-32': { raster: 32, freilos: [1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3] },
    ...Object.fromEntries(Object.entries(KO_REPECHAGE_RASTER).map(([modus, raster]) => [modus, { raster, freilos: KO_REPECHAGE_FREILOS[raster] }]))
};

// Status, die einen Folgekampf unveränderbar machen (läuft, vorbereitet oder ausgetragen).
const FESTE_STATI = new Set(['gestartet', 'beendet', 'vorbereiten']);

// Der Platz, den der (n+1)-te Teilnehmer im Raster bekommt: { kampfNr: 'H3', seite: 'kaempfer1_id'|'kaempfer2_id' }.
export function ermittleFreilosPlatz(modus, teilnehmerAnzahl) {
    const konfig = DOPPEL_KO_RASTER[modus];
    if (!konfig) return null;
    const freilose = konfig.raster - teilnehmerAnzahl;
    if (freilose < 1 || freilose > konfig.freilos.length) return null;
    const platz = konfig.freilos[freilose - 1];
    return { kampfNr: `H${Math.floor(platz / 2) + 1}`, seite: platz % 2 === 0 ? 'kaempfer1_id' : 'kaempfer2_id' };
}

// Alle Kämpfe, die (mittelbar) Sieger oder Verlierer des Kampfes `startId` als Kämpfer beziehen.
export function ermittleAbhaengige(kaempfe, startId) {
    const abhaengig = new Map();
    const offen = [startId];
    while (offen.length > 0) {
        const quelle = offen.pop();
        for (const k of kaempfe) {
            if (abhaengig.has(k.id)) continue;
            if (k.kaempfer1_quelle_kampf_id === quelle || k.kaempfer2_quelle_kampf_id === quelle) {
                abhaengig.set(k.id, k);
                offen.push(k.id);
            }
        }
    }
    return [...abhaengig.values()];
}

// Doppel-KO nach Beginn: der Nachzügler nimmt den nächsten Freilos-Platz. Das Freilos-Spiel wird zum echten
// Kampf; was von ihm abhängt (Folgekämpfe, Trostrunde), wird neu abgeleitet und darf noch nicht begonnen haben.
export function pruefeBaumEinfuegen({ modus, teilnehmerAnzahl, kaempfe }) {
    const platz = ermittleFreilosPlatz(modus, teilnehmerAnzahl);
    if (!platz) {
        return { moeglich: false, grund: 'Im Turnierbaum ist kein freier Platz mehr.' };
    }
    const ziel = (kaempfe || []).find(k => k.reihenfolge_nummer === platz.kampfNr);
    if (!ziel || ziel.status !== 'freilos' || ziel[platz.seite] != null) {
        return { moeglich: false, grund: `Der freie Platz im Turnierbaum (${platz.kampfNr}) ist nicht mehr verfügbar.` };
    }
    const abhaengige = ermittleAbhaengige(kaempfe, ziel.id);
    const fest = abhaengige.filter(k => FESTE_STATI.has(k.status));
    if (fest.length > 0) {
        const nummern = fest.map(k => k.reihenfolge_nummer).join(', ');
        return {
            moeglich: false,
            grund: `Der Platz im Turnierbaum (${platz.kampfNr}) ist nicht mehr frei: Kampf ${nummern} hat bereits begonnen oder ist beendet.`
        };
    }
    return {
        moeglich: true, kampfId: ziel.id, kampfNr: platz.kampfNr, seite: platz.seite,
        abhaengigeIds: abhaengige.map(k => k.id)
    };
}

// Bewertet, ob und wie ein weiterer Teilnehmer in den Pool kommt.
//   art 'neuaufbau': Pool hat noch nicht begonnen, der Kampfplan wird (wie bisher) neu aufgebaut.
//   art 'einfuegen': Pool läuft, der Teilnehmer bekommt nur zusätzliche Kämpfe (kein Systemwechsel).
//   art 'gesperrt':  es geht nicht; `grund` ist ein Satz für die Oberfläche (Einwiegen, Dialog, 409).
// systemNachher: Wettkampfsystem, das zur Teilnehmerzahl +1 gehört (null, wenn es keines gibt).
export function bewerteEinfuegen({ modus, poolStatus, teilnehmerAnzahl, kaempfe, systemNachher }) {
    if (!poolHatBegonnen(kaempfe)) {
        return {
            art: 'neuaufbau', moeglich: true, grund: null,
            systemWechsel: systemNachher != null && systemNachher !== modus
        };
    }
    if (ABGESCHLOSSENE_POOL_STATI.has(poolStatus)) {
        return { art: 'gesperrt', moeglich: false, grund: 'Der Pool ist bereits ausgekämpft.' };
    }
    if (systemNachher == null) {
        return { art: 'gesperrt', moeglich: false, grund: 'Für diese Teilnehmerzahl gibt es kein Wettkampfsystem.' };
    }
    if (systemNachher !== modus) {
        return {
            art: 'gesperrt', moeglich: false,
            grund: `Der Pool läuft bereits. Mit einem weiteren Teilnehmer wäre es ${systemNachher} statt ${modus}; `
                + 'ein Wechsel des Systems ist nach Beginn nicht möglich.'
        };
    }
    if (DOPPEL_KO_RASTER[modus]) {
        const baum = pruefeBaumEinfuegen({ modus, teilnehmerAnzahl, kaempfe });
        if (!baum.moeglich) return { art: 'gesperrt', moeglich: false, grund: baum.grund };
        return {
            art: 'einfuegen', moeglich: true, grund: null, neueKaempfe: 1, kampfNr: baum.kampfNr,
            hinweis: `Der Pool läuft: er nimmt den freien Platz ${baum.kampfNr} im Turnierbaum ein (1 zusätzlicher Kampf), `
                + 'sein Gegner rückt dort nicht mehr kampflos weiter. Das Wettkampfsystem bleibt unverändert.'
        };
    }
    if (modus !== SYSTEM_JEDER_GEGEN_JEDEN) {
        return {
            art: 'gesperrt', moeglich: false,
            grund: `Der Pool läuft bereits (${modus}). Ein Einfügen ist nach dem ersten Kampf nicht möglich.`
        };
    }

    // Jeder-gegen-Jeden: der Nachzügler kämpft gegen alle bisherigen Teilnehmer.
    const neueKaempfe = teilnehmerAnzahl;
    const offen = (kaempfe || []).filter(k => OFFENE_STATI.has(k.status)).length;
    if (offen < neueKaempfe) {
        return {
            art: 'gesperrt', moeglich: false, offen, neueKaempfe,
            grund: `Zu spät: im Pool sind nur noch ${offen} Kämpfe offen, der Nachzügler müsste ${neueKaempfe} bestreiten. `
                + 'Seine Kämpfe ließen sich nicht mehr zwischen die übrigen verteilen.'
        };
    }
    return {
        art: 'einfuegen', moeglich: true, grund: null, offen, neueKaempfe,
        hinweis: `Der Pool läuft: er bekommt ${neueKaempfe} zusätzliche Kämpfe, die zwischen die offenen Kämpfe verteilt `
            + 'werden. Das Wettkampfsystem bleibt unverändert.'
    };
}

// Verteilt die Kämpfe nachgemeldeter Teilnehmer gleichmäßig zwischen die übrigen offenen Kämpfe eines Pools,
// statt sie hinten anzuhängen. `warteschlange` ist die Reihenfolge der offenen Kämpfe des Pools (nach id), jeder
// Eintrag mit `nachzuegler: true/false`. Der j-te von k Nachzügler-Kämpfen kommt vor den
// floor((j+1)*R/(k+1))-ten der R übrigen Kämpfe; da dieser Index immer kleiner als R ist, bleibt hinter dem
// letzten Nachzügler-Kampf stets noch ein regulärer Kampf. Ohne Nachzügler-Kämpfe bleibt die Reihenfolge gleich.
export function ordneNachzueglerKaempfe(warteschlange) {
    const regulaer = warteschlange.filter(k => !k.nachzuegler);
    const nachzuegler = warteschlange.filter(k => k.nachzuegler);
    if (nachzuegler.length === 0 || regulaer.length === 0) return warteschlange;

    const k = nachzuegler.length;
    const r = regulaer.length;
    const ziele = nachzuegler.map((_, j) => Math.floor(((j + 1) * r) / (k + 1)));

    const ergebnis = [];
    let naechster = 0;
    for (let i = 0; i < r; i++) {
        while (naechster < k && ziele[naechster] <= i) ergebnis.push(nachzuegler[naechster++]);
        ergebnis.push(regulaer[i]);
    }
    while (naechster < k) ergebnis.push(nachzuegler[naechster++]);
    return ergebnis;
}
