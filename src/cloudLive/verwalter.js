// Verwalter der Turniere, die die Cloud live führt (Spec docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md).
// Je Live-Turnier eine Instanz: eigene Dokument-DB (turnier_<instanz_id>), Abgleich (SQL -> Dokumente) und Brücke
// (Dokumente -> SQL) mit eigenem zustand — dieselben Bausteine wie der Hallen-Server (src/sync/syncDienst.js), aber mehrere
// nebeneinander und mit zustand.abschottung, damit ein Gerät nur Zeilen seines Turniers ändern kann. Bis zu MAX_LIVE_TURNIERE
// gleichzeitig in einem Prozess; Öffnen und Schließen laufen strikt nacheinander.
import { erzeugeDokumentDb, turnierDbName } from '../sync/dokumentDb.js';
import { erzeugeAbgleich } from '../sync/abgleich.js';
import { erzeugeBruecke } from '../sync/bruecke.js';
import { FachFehler } from '../utils/fachFehler.js';
import { istLiveApiAktiv } from '../liveCloud/liveApiAktiv.js';
import { starteZugang, ladeZugang, beendeZugang } from './zugang.js';
import { starteFeed } from './teilnehmerAppFeed.js';

// Ein Heartbeat (client:<id>) gilt als aktuell, wenn er höchstens so alt ist (clientKern schreibt alle 30 s).
const HEARTBEAT_AKTIV_MS = 2 * 60 * 1000;

export const MAX_LIVE_TURNIERE = 10;
// Je Verein höchstens so viele gleichzeitig: ein einzelner Verein soll die Plätze der Cloud nicht allein belegen können.
export const MAX_LIVE_JE_VEREIN = 3;

export function erzeugeVerwalter({ knex, konfig, maxTurniere = MAX_LIVE_TURNIERE, maxJeVerein = MAX_LIVE_JE_VEREIN, dokumentDb = erzeugeDokumentDb(konfig), teilnehmerAppFeed = istLiveApiAktiv(), feedIntervallMs = 5000 }) {
    const instanzen = new Map(); // turnierId -> Instanz
    let kette = Promise.resolve();

    // Öffnen/Schließen strikt nacheinander: zwei gleichzeitige Starts desselben Turniers dürfen keine zweite Instanz anlegen.
    function seriell(arbeit) {
        const lauf = kette.then(arbeit);
        kette = lauf.catch(() => {});
        return lauf;
    }

    const vereinIdVon = async (turnierId) => ((await knex('turniere').where({ id: turnierId }).first('verein_id')) || {}).verein_id ?? null;

    async function oeffneInstanz(zugang) {
        const dbName = turnierDbName(zugang.instanzId);
        const db = await dokumentDb.oeffneSicher(dbName);
        const zustand = { instanzId: zugang.instanzId, turnierId: zugang.turnierId, db, epoche: 0, abschottung: true };
        const abgleich = erzeugeAbgleich({ knex, zustand });
        const bruecke = erzeugeBruecke({ knex, zustand, abgleich });
        const instanz = {
            turnierId: zugang.turnierId, vereinId: await vereinIdVon(zugang.turnierId), schluessel: zugang.schluessel, instanzId: zugang.instanzId,
            dbName, db, zustand, abgleich, bruecke,
            feed: teilnehmerAppFeed ? starteFeed({ knex, geheimnis: zugang.appGeheimnis, turnierId: zugang.turnierId, intervallMs: feedIntervallMs }) : null,
            offeneAnfragen: new Set() // laufende /db-Anfragen (geraeteRoutes.js), beim Beenden vorher abgebrochen
        };
        instanzen.set(zugang.turnierId, instanz);
        await abgleich.fuehreAus();
        bruecke.starte();
        return instanz;
    }

    async function schliesseInstanz(instanz) {
        if (instanz.feed) await instanz.feed.stoppe();
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
                const vereinId = await vereinIdVon(Number(turnierId));
                if (vereinId != null && [...instanzen.values()].filter((i) => i.vereinId === vereinId).length >= maxJeVerein) {
                    throw new FachFehler(409, `Ihr Verein führt bereits ${maxJeVerein} Turniere live. Bitte zuerst ein Turnier beenden.`);
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

        /** Die Geräte, die sich per Heartbeat (client:<id>) in der Dokument-DB des Turniers gemeldet haben. */
        async listeGeraete(turnierId) {
            const instanz = instanzen.get(Number(turnierId));
            if (!instanz) return [];
            const res = await instanz.db.allDocs({ startkey: 'client:', endkey: 'client:￰', include_docs: true });
            return res.rows.map((r) => r.doc).map((d) => ({
                clientId: d.client_id, geraet: d.geraet, matteId: d.matte_id, letzterKontakt: d.letzter_kontakt, ausstehend: d.ausstehend || 0
            }));
        },
        offeneAnzahl: () => instanzen.size,

        /** Stößt den (entprellten) Abgleich SQL -> Dokumente aller offenen Instanzen an. */
        planeAbgleich() {
            for (const instanz of instanzen.values()) instanz.abgleich.plane();
        },

        async leerlauf() {
            for (const instanz of instanzen.values()) {
                await instanz.bruecke.leerlauf();
                if (instanz.feed) await instanz.feed.leerlauf();
            }
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

        /**
         * Beendet den Live-Betrieb: wartet, bis die Brücke alle bereits übertragenen Geräte-Änderungen in die relationale DB
         * geschrieben hat, schließt den Zugang (danach antworten die Geräte-Routen mit 410), und löscht die Dokument-DB.
         * Melden Geräte noch nicht übertragene Änderungen (ausstehend), bricht es mit 409 ab, außer erzwingen ist gesetzt;
         * diese Änderungen bleiben dann im Gerät (clientKern sichert sie beim Wechsel unter verworfen/).
         */
        beende(turnierId, { erzwingen = false } = {}) {
            return seriell(async () => {
                const id = Number(turnierId);
                const instanz = instanzen.get(id);
                if (!instanz) {
                    const zugang = await ladeZugang(knex, id);
                    if (zugang && !zugang.beendetAm) await beendeZugang(knex, id);
                    return { ausstehendeGeraete: 0 };
                }
                await instanz.bruecke.leerlauf();
                const jetzt = Date.now();
                const ausstehendeGeraete = (await verwalter.listeGeraete(id))
                    .filter((g) => g.letzterKontakt && jetzt - Date.parse(g.letzterKontakt) < HEARTBEAT_AKTIV_MS)
                    .reduce((summe, g) => summe + (g.ausstehend || 0), 0);
                if (ausstehendeGeraete > 0 && !erzwingen) {
                    throw new FachFehler(409, `Es gibt noch nicht übertragene Änderungen auf ${ausstehendeGeraete === 1 ? 'einem Gerät' : 'Geräten'} (${ausstehendeGeraete}). Bitte warten, bis die Geräte verbunden und abgeglichen sind, oder trotzdem beenden.`, { daten: { ausstehendeGeraete } });
                }
                await beendeZugang(knex, id);
                instanzen.delete(id);
                for (const antwort of instanz.offeneAnfragen) antwort.destroy();
                instanz.offeneAnfragen.clear();
                await new Promise((fertig) => setTimeout(fertig, 100)); // laufende Abfragen gegen die offene DB auslaufen lassen
                await instanz.bruecke.stoppe();
                await instanz.abgleich.leerlauf();
                if (instanz.feed) await instanz.feed.stoppe({ zuruecknehmen: true });
                await instanz.db.destroy();
                return { ausstehendeGeraete };
            });
        },

        /** Beendet Live-Turniere, deren Zugang abgelaufen ist (Ende des Turniertags), und gibt ihre Plätze frei. Liefert die Turnier-IDs. */
        async raeumeAbgelaufeneAuf({ jetzt = () => new Date() } = {}) {
            const beendet = [];
            for (const instanz of [...instanzen.values()]) {
                const zugang = await ladeZugang(knex, instanz.turnierId);
                if (zugang && zugang.gueltigBis && jetzt().getTime() >= zugang.gueltigBis.getTime()) {
                    await verwalter.beende(instanz.turnierId, { erzwingen: true });
                    beendet.push(instanz.turnierId);
                }
            }
            return beendet;
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
