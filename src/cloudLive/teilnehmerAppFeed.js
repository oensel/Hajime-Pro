// Teilnehmer-App bei einem Turnier, das die Cloud live führt: statt eines Uplinks vom Hallen-Server baut die Cloud den Snapshot selbst
// aus ihrer Datenbank (dieselbe Funktion wie der Live-Prozess, src/live/snapshot.js) und übernimmt ihn direkt in das Lesemodell der App
// (src/liveCloud/ingest.js). Der Turnierschlüssel der App ist die Turnier-ID der Cloud. Wie am Hallen-Server ist die Veröffentlichung
// ein Opt-in des Veranstalters (turniere.live_freigabe): ohne Freigabe gelangen keine Namen in das Lesemodell, wird sie zurückgenommen,
// verschwindet das Turnier beim nächsten Durchlauf wieder aus der App; beim Beenden des Live-Betriebs ebenfalls.
import crypto from 'node:crypto';
import { ladeSnapshots } from '../live/snapshot.js';
import { uebernimmPaket } from '../liveCloud/ingest.js';

const LEBENSZEICHEN_MS = 60_000;

/**
 * @param {string} geheimnis zufälliges Geheimnis für die Schlüssel der Teilnehmer (cloud_live.app_geheimnis), je Live-Betrieb neu
 */
export function starteFeed({ knex, geheimnis, turnierId, intervallMs = 5000, sofort = true, log = console, jetzt = Date.now }) {
    const turnierKey = String(turnierId);
    let veroeffentlicht = false; // ist das Turnier gerade in der App sichtbar?
    let letzterHash = null;
    let letzterZeitpunkt = 0;
    let letzteSequenz = 0;
    let gestoppt = false;
    let timer = null;
    let laufend = Promise.resolve();

    const naechsteSequenz = () => {
        letzteSequenz = Math.max(jetzt(), letzteSequenz + 1);
        return letzteSequenz;
    };

    const nimmZurueck = () => uebernimmPaket(knex, { version: 1, turnierKey, zurueckgezogen: true, sequenz: naechsteSequenz() });

    async function lauf() {
        const [snapshot] = await ladeSnapshots(knex, { geheimnis, turnierIds: [turnierId] });
        if (!snapshot) {
            // Keine Freigabe (mehr): nichts veröffentlichen, Vorhandenes zurücknehmen.
            if (veroeffentlicht) {
                await nimmZurueck();
                veroeffentlicht = false;
                letzterHash = null;
            }
            return;
        }
        const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        if (veroeffentlicht && hash === letzterHash && jetzt() - letzterZeitpunkt < LEBENSZEICHEN_MS) return;
        await uebernimmPaket(knex, { ...snapshot, stand: new Date(jetzt()).toISOString(), sequenz: naechsteSequenz() });
        veroeffentlicht = true;
        letzterHash = hash;
        letzterZeitpunkt = jetzt();
    }

    function tick() {
        laufend = laufend.then(lauf).catch((fehler) => {
            log.error(`[Cloud-Live] Teilnehmer-App-Feed von Turnier ${turnierId} fehlgeschlagen: ${fehler && fehler.message ? fehler.message : fehler}`);
        });
        return laufend;
    }

    // Die nächste Runde wird erst nach Abschluss der vorigen geplant, damit sich Abfragen nie überlappen.
    function plane() {
        if (gestoppt) return;
        timer = setTimeout(() => tick().finally(plane), intervallMs);
        if (timer.unref) timer.unref();
    }

    if (sofort) tick();
    plane();

    return {
        tick,
        leerlauf: () => laufend,
        /** Beendet den Feed; mit zuruecknehmen verschwindet das Turnier auch aus der App (Rücknahme wie beim Uplink). */
        async stoppe({ zuruecknehmen = false } = {}) {
            gestoppt = true;
            if (timer) clearTimeout(timer);
            await laufend;
            if (zuruecknehmen) {
                await nimmZurueck().catch((fehler) => {
                    log.error(`[Cloud-Live] Rücknahme von Turnier ${turnierId} in der App fehlgeschlagen: ${fehler.message}`);
                });
            }
        }
    };
}
