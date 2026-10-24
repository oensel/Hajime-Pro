// Teilnehmer-App bei einem Turnier, das die Cloud live führt: statt eines Uplinks vom Hallen-Server baut die Cloud den Snapshot selbst
// aus ihrer Datenbank (dieselbe Funktion wie der Live-Prozess, src/live/snapshot.js) und übernimmt ihn direkt in das Lesemodell der App
// (src/liveCloud/ingest.js). Der Turnierschlüssel der App ist die Turnier-ID der Cloud. Beim Beenden wird das Turnier zurückgenommen.
import crypto from 'node:crypto';
import { ladeSnapshots } from '../live/snapshot.js';
import { uebernimmPaket } from '../liveCloud/ingest.js';

const LEBENSZEICHEN_MS = 60_000;

export function starteFeed({ knex, instanzId, turnierId, intervallMs = 5000, sofort = true, log = console, jetzt = Date.now }) {
    // Stabil für die Dauer des Live-Betriebs (die Schlüssel der Teilnehmer in der App ändern sich dabei nicht), aber je Live-Betrieb neu.
    const geheimnis = crypto.createHash('sha256').update(`teilnehmer-app:${instanzId}`).digest('hex');
    const turnierKey = String(turnierId);
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

    async function lauf() {
        const [snapshot] = await ladeSnapshots(knex, { geheimnis, turnierIds: [turnierId] });
        if (!snapshot) return;
        const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
        if (hash === letzterHash && jetzt() - letzterZeitpunkt < LEBENSZEICHEN_MS) return;
        await uebernimmPaket(knex, { ...snapshot, stand: new Date(jetzt()).toISOString(), sequenz: naechsteSequenz() });
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
                await uebernimmPaket(knex, { version: 1, turnierKey, zurueckgezogen: true, sequenz: naechsteSequenz() }).catch((fehler) => {
                    log.error(`[Cloud-Live] Rücknahme von Turnier ${turnierId} in der App fehlgeschlagen: ${fehler.message}`);
                });
            }
        }
    };
}
