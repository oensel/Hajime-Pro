/**
 * Zeitprognose: voraussichtliche Uhrzeit kommender Kämpfe, Matten-Rückstand und Zeitplan-Simulation.
 * Rein und knex-/DOM-frei (läuft am Server und auf Client-Geräten). Alle Zeiten sind ungefähr:
 * Dauer je Kampf = Schnitt der zuletzt tatsächlich gekämpften Zeiten + Puffer für Aufruf/Abgang.
 * Spec: docs/specs/2026-10-17-zeitprognose-design.md
 */
import { parseDbZeitstempel } from './pausenRegel.js';

export const PUFFER_SEKUNDEN = 90;
export const LETZTE_KAEMPFE = 8;
export const MIN_KAEMPFE = 3;
export const RUECKSTAND_SCHWELLE_MINUTEN = 10;
const STANDARD_KAMPFZEIT_SEKUNDEN = 240;
const OFFENE_STATI = new Set(['bereit', 'angelegt', 'vorbereiten']);

/** Schnitt der gekämpften Zeit der letzten beendeten Kämpfe (null, wenn zu wenige vorliegen). */
function gemesseneSekunden(kaempfe) {
    const gueltig = (kaempfe || [])
        .map((k, index) => ({ k, index, zeit: parseDbZeitstempel(k.updated_at) }))
        .filter(({ k }) => k.status === 'beendet' && Number(k.kampfzeit_in_sekunden) > 0)
        .sort((a, b) => {
            const za = Number.isNaN(a.zeit) ? -Infinity : a.zeit;
            const zb = Number.isNaN(b.zeit) ? -Infinity : b.zeit;
            return za !== zb ? za - zb : a.index - b.index;
        })
        .slice(-LETZTE_KAEMPFE);
    if (gueltig.length < MIN_KAEMPFE) return null;
    return gueltig.reduce((summe, { k }) => summe + Number(k.kampfzeit_in_sekunden), 0) / gueltig.length;
}

/** Dauer eines Kampfes inkl. Puffer in Sekunden; bei zu wenigen Messwerten gilt die Vorgabe. */
export function dauerJeKampfSekunden(beendeteKaempfe, vorgabeSekunden) {
    const gemessen = gemesseneSekunden(beendeteKaempfe);
    return (gemessen ?? (Number(vorgabeSekunden) || STANDARD_KAMPFZEIT_SEKUNDEN)) + PUFFER_SEKUNDEN;
}

/**
 * Prognose für eine Matte. `kaempfeInReihenfolge` ist die Kampfliste der Matte in Spielreihenfolge
 * (Ausgabe von baueMattenAnsicht). `zeiten` enthält den voraussichtlichen Beginn je offenem Kampf.
 */
export function prognoseMatte(kaempfeInReihenfolge, jetztMs) {
    const liste = kaempfeInReihenfolge || [];
    const gemessen = gemesseneSekunden(liste);
    const dauerFuer = (kampf) => (gemessen ?? (Number(kampf.pool_kampfzeit) || STANDARD_KAMPFZEIT_SEKUNDEN)) + PUFFER_SEKUNDEN;

    const zeiten = new Map();
    let cursor = jetztMs;
    let offene = 0;
    let ende = null;
    for (const kampf of liste) {
        if (kampf.status === 'gestartet') {
            // Beginn des laufenden Kampfes ist unbekannt: er zählt mit der halben Dauer.
            cursor += (dauerFuer(kampf) * 1000) / 2;
            offene++;
            ende = cursor;
        } else if (OFFENE_STATI.has(kampf.status)) {
            zeiten.set(kampf.id, cursor);
            cursor += dauerFuer(kampf) * 1000;
            offene++;
            ende = cursor;
        }
    }
    const naechster = liste.find(k => OFFENE_STATI.has(k.status) || k.status === 'gestartet');
    return {
        zeiten,
        endeMs: ende,
        offeneKaempfe: offene,
        dauerSekunden: dauerFuer(naechster || {})
    };
}

/** Rückstand der Matten gegenüber der Matte, die am frühesten fertig wird (ab der Schwelle). */
export function berechneRueckstand(matten) {
    const ergebnis = new Map();
    const mitEnde = (matten || []).filter(m => m.endeMs != null);
    if (mitEnde.length < 2) return ergebnis;
    const bezug = mitEnde.reduce((a, b) => (b.endeMs < a.endeMs ? b : a));
    for (const m of mitEnde) {
        if (m.id === bezug.id) continue;
        const minuten = Math.round((m.endeMs - bezug.endeMs) / 60000);
        if (minuten >= RUECKSTAND_SCHWELLE_MINUTEN) ergebnis.set(m.id, { minuten, bezugMatteId: bezug.id });
    }
    return ergebnis;
}

/**
 * Zeitplan-Simulation: die Kämpfe jeder Matte in ihrer tatsächlichen Reihenfolge (matten_reihenfolge, Kämpfe ohne
 * Position zuletzt, dann id — wie baueMattenAnsicht) nacheinander, jeder Kampf = Kampfzeit + Puffer. Die Planung
 * verschränkt die Pools einer Matte, daher beginnt ein Pool mit seinem ersten und endet mit seinem letzten Kampf.
 * `matten`: [{ id, bezeichnung, pools: [{ id, bezeichnung, altersklasse, geschlecht, kampfzeit_sekunden }],
 * kaempfe: [{ id, pool_id, status, matten_reihenfolge }] }]. Freilose zählen nicht.
 */
export function simuliereZeitplan({ matten, beginnMs, kampfzeitJeAltersklasse = {} }) {
    return (matten || []).map(matte => {
        const poolById = new Map((matte.pools || []).map(p => [p.id, p]));
        const reihe = [...(matte.kaempfe || [])]
            .filter(k => k.status !== 'freilos' && poolById.has(k.pool_id))
            .sort((a, b) => {
                const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
                const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
                return ra !== rb ? ra - rb : Number(a.id) - Number(b.id);
            });
        let cursor = beginnMs;
        const jePool = new Map();
        for (const kampf of reihe) {
            const pool = poolById.get(kampf.pool_id);
            const eingabe = Number(kampfzeitJeAltersklasse[pool.altersklasse]);
            const kampfzeit = eingabe > 0 ? eingabe : (Number(pool.kampfzeit_sekunden) || STANDARD_KAMPFZEIT_SEKUNDEN);
            const startMs = cursor;
            cursor += (kampfzeit + PUFFER_SEKUNDEN) * 1000;
            if (!jePool.has(pool.id)) {
                jePool.set(pool.id, { poolId: pool.id, bezeichnung: pool.bezeichnung, altersklasse: pool.altersklasse, geschlecht: pool.geschlecht, neueKlasse: false, startMs, kaempfe: 0, endeMs: cursor });
            }
            const eintrag = jePool.get(pool.id);
            eintrag.kaempfe++;
            eintrag.endeMs = cursor;
        }
        // Pools in der Reihenfolge ihres Beginns; neue Klasse = erster Pool einer Alters-/Geschlechtsklasse.
        const pools = [...jePool.values()];
        const gesehen = new Set();
        for (const pool of pools) {
            const klasse = `${pool.altersklasse}|${pool.geschlecht}`;
            pool.neueKlasse = !gesehen.has(klasse);
            gesehen.add(klasse);
        }
        return { matteId: matte.id, bezeichnung: matte.bezeichnung, pools, endeMs: cursor };
    });
}

export function formatUhrzeit(ms) {
    return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Voraussichtlicher Beginn eines Kampfes, vor dem `abstand` Kämpfe offen sind (Teilnehmer-App). */
export function startNachAbstand(standMs, abstand, dauerSekunden) {
    if (!Number.isFinite(standMs) || !Number.isInteger(abstand) || !(Number(dauerSekunden) > 0)) return null;
    return standMs + abstand * Number(dauerSekunden) * 1000;
}
