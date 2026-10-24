// Verwalter der Turniere, die die Cloud live führt (Spec docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md).
// Je Live-Turnier eine Instanz: eigene Dokument-DB (turnier_<instanz_id>), Abgleich (SQL -> Dokumente) und Brücke
// (Dokumente -> SQL) mit eigenem zustand — dieselben Bausteine wie der Hallen-Server (src/sync/syncDienst.js), aber mehrere
// nebeneinander und mit zustand.abschottung, damit ein Gerät nur Zeilen seines Turniers ändern kann. Bis zu MAX_LIVE_TURNIERE
// gleichzeitig in einem Prozess; Öffnen und Schließen laufen strikt nacheinander.
import { erzeugeDokumentDb, turnierDbName } from '../sync/dokumentDb.js';
import { erzeugeAbgleich } from '../sync/abgleich.js';
import { erzeugeBruecke } from '../sync/bruecke.js';
import { FachFehler } from '../utils/fachFehler.js';
import { starteZugang, ladeZugang } from './zugang.js';

export const MAX_LIVE_TURNIERE = 10;

export function erzeugeVerwalter({ knex, konfig, maxTurniere = MAX_LIVE_TURNIERE, dokumentDb = erzeugeDokumentDb(konfig) }) {
    const instanzen = new Map(); // turnierId -> Instanz
    let kette = Promise.resolve();

    // Öffnen/Schließen strikt nacheinander: zwei gleichzeitige Starts desselben Turniers dürfen keine zweite Instanz anlegen.
    function seriell(arbeit) {
        const lauf = kette.then(arbeit);
        kette = lauf.catch(() => {});
        return lauf;
    }

    async function oeffneInstanz(zugang) {
        const dbName = turnierDbName(zugang.instanzId);
        const db = await dokumentDb.oeffneSicher(dbName);
        const zustand = { instanzId: zugang.instanzId, turnierId: zugang.turnierId, db, epoche: 0, abschottung: true };
        const abgleich = erzeugeAbgleich({ knex, zustand });
        const bruecke = erzeugeBruecke({ knex, zustand, abgleich });
        const instanz = {
            turnierId: zugang.turnierId, schluessel: zugang.schluessel, instanzId: zugang.instanzId,
            dbName, db, zustand, abgleich, bruecke
        };
        instanzen.set(zugang.turnierId, instanz);
        await abgleich.fuehreAus();
        bruecke.starte();
        return instanz;
    }

    async function schliesseInstanz(instanz) {
        await instanz.bruecke.stoppe();
        await instanz.abgleich.leerlauf();
        instanzen.delete(instanz.turnierId);
        await instanz.db.close().catch(() => {});
    }

    const verwalter = {
        dokumentMiddleware: dokumentDb.middleware,
        dokumentDb,
        maxTurniere,

        /** Schaltet das Turnier live (idempotent) und liefert seinen Zugang. */
        starte(turnierId) {
            return seriell(async () => {
                const offen = instanzen.get(Number(turnierId));
                if (offen) return ladeZugang(knex, offen.turnierId);
                if (instanzen.size >= maxTurniere) {
                    throw new FachFehler(409, `Es laufen bereits ${maxTurniere} Turniere live.`);
                }
                const zugang = await starteZugang(knex, Number(turnierId));
                await oeffneInstanz(zugang);
                return zugang;
            });
        },

        instanz(schluessel) {
            for (const instanz of instanzen.values()) if (instanz.schluessel === schluessel) return instanz;
            return null;
        },

        instanzFuerTurnier: (turnierId) => instanzen.get(Number(turnierId)) || null,
        offeneAnzahl: () => instanzen.size,

        /** Stößt den (entprellten) Abgleich SQL -> Dokumente aller offenen Instanzen an. */
        planeAbgleich() {
            for (const instanz of instanzen.values()) instanz.abgleich.plane();
        },

        async leerlauf() {
            for (const instanz of instanzen.values()) await instanz.bruecke.leerlauf();
        },

        /** Beim Serverstart: alle nicht beendeten Live-Turniere wieder öffnen. */
        wiederaufnahme() {
            return seriell(async () => {
                const zeilen = await knex('cloud_live').whereNull('beendet_am').select('turnier_id').orderBy('erzeugt_am');
                for (const { turnier_id: turnierId } of zeilen) {
                    if (instanzen.has(turnierId)) continue;
                    if (instanzen.size >= maxTurniere) {
                        console.warn(`[Cloud-Live] Turnier ${turnierId} nicht wieder geöffnet: Grenze von ${maxTurniere} erreicht.`);
                        continue;
                    }
                    try {
                        await oeffneInstanz(await ladeZugang(knex, turnierId));
                    } catch (fehler) {
                        console.error(`[Cloud-Live] Turnier ${turnierId} konnte nicht wieder geöffnet werden:`, fehler);
                    }
                }
            });
        },

        /** Schließt alle Instanzen, ohne Daten zu löschen (Herunterfahren, Tests). */
        schliesseAlle() {
            return seriell(async () => {
                for (const instanz of [...instanzen.values()]) await schliesseInstanz(instanz);
            });
        },

        // Für Task "Live beenden": schließt eine Instanz und liefert sie (ohne die DB zu löschen).
        _schliesse: (turnierId) => seriell(async () => {
            const instanz = instanzen.get(Number(turnierId));
            if (instanz) await schliesseInstanz(instanz);
            return instanz || null;
        })
    };
    return verwalter;
}
