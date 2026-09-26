// Cluster-Dienst eines Hallen-Servers (Spec CouchDB-Umbau, Abschnitt 9). keepalived entscheidet,
// wer die VIP hält, und ruft über localhost /api/cluster/befoerdern bzw. /zurueckstufen auf; dieser
// Dienst führt die Folgen aus und liefert keepalived über /api/cluster/gesund die Grundlage.
//
// Jeder Server startet als Secondary. Ein Prüfzyklus (alle PRUEF_MS) fragt den Partner ab,
// übernimmt dessen höhere Epoche bzw. stößt die Rückstufung an (PostgreSQL als Standby des
// Partners neu aufbauen, CLUSTER_RUECKSTUFEN_BEFEHL) und hält auf dem Master die
// PostgreSQL-Replikation synchron bzw. schaltet bei fehlendem Standby auf asynchron.
//
// Rollenzustand und Verlauf liegen lokal in <SYNC_DATENVERZEICHNIS>/cluster-zustand.json (nicht
// repliziert — die Epoche des Partners kommt über GET /api/cluster/status).
import { exec } from 'child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';
import { entscheideStart, entscheideBefoerderung, pruefePartner, uebernimmPartner } from './rollenLogik.js';
import { erzeugePgReplikation } from './pgReplikation.js';
import { erzeugeZeuge } from './zeuge.js';

export const PRUEF_MS = 1000;
const PARTNER_TIMEOUT_MS = 1500;
const UEBERGABE_TIMEOUT_MS = 60_000;
const VERLAUF_MAX = 50;

function ladeDatei(datei) {
    try {
        return JSON.parse(readFileSync(datei, 'utf-8'));
    } catch {
        return null;
    }
}

function speichereDatei(datei, daten) {
    mkdirSync(path.dirname(datei), { recursive: true });
    const tmp = `${datei}.tmp`;
    writeFileSync(tmp, JSON.stringify(daten, null, 2));
    renameSync(tmp, datei);
}

export function starteClusterDienst({ knex, clusterKonfig, syncKonfig, sync }) {
    const { knoten, partnerKnoten, partnerUrl } = clusterKonfig;
    const pg = erzeugePgReplikation(knex, { partnerKnoten });
    const zeuge = erzeugeZeuge(clusterKonfig.zeuge);
    const datei = path.resolve(syncKonfig.datenverzeichnis, 'cluster-zustand.json');

    const gespeichert = ladeDatei(datei);
    let zustand = gespeichert ? gespeichert.zustand : null;
    const verlauf = gespeichert && Array.isArray(gespeichert.verlauf) ? gespeichert.verlauf : [];
    let initialisiert = false;
    let rolle = 'secondary';
    let uebergabe = null; // { seit } während einer geplanten Übergabe durch diesen Master
    let uebergabeAngekuendigt = false; // Partner hat angekündigt, mir die Rolle zu übergeben
    let rueckstufungLaeuft = false;
    let letzterRueckstufungsFehler = null;
    let letzterPartner = null;
    let letzterPgStatus = null;
    let kette = Promise.resolve();

    // Alle Zustandsänderungen nacheinander (Prüfzyklus, keepalived-Aufrufe, Übergabe).
    function seriell(fn) {
        const ergebnis = kette.then(fn);
        kette = ergebnis.catch(() => {});
        return ergebnis;
    }

    function speichere() {
        speichereDatei(datei, { zustand, verlauf });
    }

    function protokolliere(ereignis, details = {}) {
        verlauf.unshift({ zeit: new Date().toISOString(), knoten, ereignis, epoche: zustand ? zustand.epoche : null, ...details });
        verlauf.splice(VERLAUF_MAX);
        speichere();
        console.log(`[Cluster] ${knoten}: ${ereignis}`, details.grund ? `(${details.grund})` : '');
    }

    async function holePartner() {
        if (!partnerUrl) return null;
        try {
            const antwort = await fetch(`${partnerUrl}/api/cluster/status?nurEigen=1`, {
                signal: AbortSignal.timeout(PARTNER_TIMEOUT_MS),
                headers: syncKonfig.secret ? { 'x-hajime-sync-secret': syncKonfig.secret } : {}
            });
            if (!antwort.ok) return null;
            const daten = await antwort.json();
            return daten && daten.initialisiert ? daten : null;
        } catch {
            return null;
        }
    }

    async function pgRolleOderNull() {
        try {
            return await pg.rolle();
        } catch {
            return null;
        }
    }

    // Master wird Secondary (VIP abgegeben): Brücke aus, keine Schreibzugriffe mehr.
    async function werdeSecondary(ereignis) {
        if (rolle !== 'master') return;
        rolle = 'secondary';
        await sync.alsSecondary();
        protokolliere(ereignis);
    }

    // Shell nötig (z.B. "sudo -n /usr/local/bin/hajime-rueckstufen.sh"); der Befehl stammt
    // ausschließlich aus der .env des Servers, keine Anfragedaten fließen ein.
    function fuehreBefehlAus(befehl) {
        return new Promise((resolve, reject) => {
            exec(befehl, { timeout: 10 * 60_000, windowsHide: true, env: { ...process.env, CLUSTER_KNOTEN: knoten } }, (fehler, stdout, stderr) => {
                if (fehler) reject(new Error(`${fehler.message}\n${stderr || ''}`.trim()));
                else resolve(stdout);
            });
        });
    }

    // PostgreSQL als Standby des Partners neu aufbauen (der Partner ist mit höherer Epoche Master).
    async function rueckstufen() {
        zustand = { ...zustand, rueckstufung_erforderlich: true };
        speichere();
        await werdeSecondary('vip_abgegeben');
        rueckstufungLaeuft = true;
        protokolliere('rueckstufung_gestartet');
        try {
            await fuehreBefehlAus(clusterKonfig.rueckstufenBefehl);
            letzterRueckstufungsFehler = null;
            const partner = await holePartner();
            zustand = partner ? uebernimmPartner(zustand, partner, new Date().toISOString()) : { ...zustand, rueckstufung_erforderlich: false };
            uebergabe = null;
            protokolliere('rueckgestuft');
        } catch (err) {
            letzterRueckstufungsFehler = err.message;
            console.error('[Cluster] Rückstufung fehlgeschlagen:', err.message);
            protokolliere('rueckstufung_fehlgeschlagen', { fehler: err.message.slice(0, 500) });
        } finally {
            rueckstufungLaeuft = false;
        }
    }

    async function pruefzyklus() {
        const pgRolle = await pgRolleOderNull();
        const partner = await holePartner();
        letzterPartner = partner;
        if (!pgRolle) return; // PostgreSQL (noch) nicht erreichbar
        const jetzt = new Date().toISOString();

        if (!initialisiert) {
            const start = entscheideStart({ knoten, eigenerZustand: zustand, partner, pgRolle, jetzt });
            const neu = JSON.stringify(start.zustand) !== JSON.stringify(zustand);
            zustand = start.zustand;
            initialisiert = true;
            sync.setzeEpoche(zustand.epoche);
            if (neu) protokolliere('start', { grund: zustand.grund });
            if (start.aktion === 'rueckstufen') await rueckstufen();
            return;
        }

        if (zustand.rueckstufung_erforderlich && !rueckstufungLaeuft) {
            // Letzte Rückstufung fehlgeschlagen — erneut versuchen, sobald der Partner Master ist.
            if (partner && partner.rolle === 'master') await rueckstufen();
            return;
        }

        const pruefung = pruefePartner({ knoten, eigenerZustand: zustand, partner, pgRolle });
        if (pruefung === 'rueckstufen') {
            await rueckstufen();
            return;
        }
        if (pruefung === 'uebernehmen') {
            zustand = uebernimmPartner(zustand, partner, jetzt);
            sync.setzeEpoche(zustand.epoche);
            protokolliere('epoche_uebernommen', { grund: zustand.grund });
        }

        if (rolle === 'master') {
            try {
                letzterPgStatus = await pg.waechterSchritt();
            } catch (err) {
                letzterPgStatus = { fehler: err.message };
            }
            if (uebergabe && Date.now() - uebergabe.seit > UEBERGABE_TIMEOUT_MS) {
                // Partner hat nicht übernommen: Übergabe abbrechen, weiter als Master.
                uebergabe = null;
                await sync.alsMaster();
                protokolliere('uebergabe_abgebrochen');
            }
        } else {
            letzterPgStatus = await pg.status().catch(err => ({ fehler: err.message }));
        }
    }

    async function gesundheit() {
        const gruende = [];
        if (!initialisiert) gruende.push('Start noch nicht abgeschlossen');
        const pgRolle = await pgRolleOderNull();
        if (!pgRolle) gruende.push('PostgreSQL nicht erreichbar');
        const z = await zeuge.erreichbar();
        if (!z.erreichbar) gruende.push(`Zeuge ${z.ziel} nicht erreichbar`);
        if (zustand && zustand.rueckstufung_erforderlich) gruende.push('Rückstufung erforderlich');
        if (rueckstufungLaeuft) gruende.push('Rückstufung läuft');
        if (uebergabe) gruende.push('Übergabe an den Partner läuft');
        return { gesund: gruende.length === 0, gruende, pg_rolle: pgRolle, zeuge: z };
    }

    // keepalived (notify_master): ich halte jetzt die VIP.
    function befoerdern() {
        return seriell(async () => {
            if (rolle === 'master') return { ok: true, unveraendert: true };
            const pgRolle = await pgRolleOderNull();
            if (!pgRolle) throw Object.assign(new Error('PostgreSQL nicht erreichbar.'), { status: 503 });
            const partner = await holePartner();
            const grund = uebergabeAngekuendigt ? 'uebergabe' : 'automatisch';
            const entscheidung = entscheideBefoerderung({ knoten, eigenerZustand: zustand, partner, pgRolle, grund, jetzt: new Date().toISOString() });
            if (entscheidung.pgPromote) await pg.befoerdere();
            zustand = entscheidung.zustand;
            uebergabeAngekuendigt = false;
            sync.setzeEpoche(zustand.epoche);
            rolle = 'master';
            await sync.alsMaster();
            protokolliere(entscheidung.epocheErhoeht ? 'master_geworden' : 'master_fortgesetzt', { grund: zustand.grund });
            return { ok: true, epoche: zustand.epoche };
        });
    }

    // keepalived (notify_backup/notify_fault): VIP verloren.
    function zurueckstufen() {
        return seriell(async () => {
            await werdeSecondary('vip_abgegeben');
            return { ok: true };
        });
    }

    // Geplante Übergabe (Wartung): nur Master, Partner gesund und synchron.
    function uebergeben() {
        return seriell(async () => {
            if (rolle !== 'master') throw Object.assign(new Error('Nur der Master kann die Rolle übergeben.'), { status: 409 });
            const partner = await holePartner();
            if (!partner || !partner.gesund) throw Object.assign(new Error('Der Partner ist nicht erreichbar oder nicht gesund.'), { status: 409 });
            const pgStatus = await pg.status();
            if (pgStatus.absicherung !== 'synchron') throw Object.assign(new Error('Die Replikation ist nicht synchron — Übergabe nicht möglich.'), { status: 409 });

            // Ab jetzt keine Schreibzugriffe mehr, Brücke und Abgleich abschließen.
            uebergabe = { seit: Date.now() };
            await sync.alsSecondary();
            // Warten, bis der Partner alle Dokumente dieses Servers gezogen hat.
            const eigen = await sync.dokumentStatus();
            const ende = Date.now() + 10_000;
            while (Date.now() < ende) {
                const p = await holePartner();
                const seq = p && p.dokumente && p.dokumente.partner_pull ? p.dokumente.partner_pull.last_seq : null;
                if (eigen.update_seq == null || (seq != null && Number(seq) >= Number(eigen.update_seq))) break;
                await new Promise(r => setTimeout(r, 200));
            }
            await fetch(`${partnerUrl}/api/cluster/uebergabe-ankuendigen`, {
                method: 'POST',
                signal: AbortSignal.timeout(PARTNER_TIMEOUT_MS),
                headers: syncKonfig.secret ? { 'x-hajime-sync-secret': syncKonfig.secret } : {}
            }).catch(() => {});
            protokolliere('uebergabe_gestartet', { an: partnerKnoten });
            // Ab hier meldet /gesund "ungesund" -> keepalived verschiebt die VIP zum Partner.
            return { ok: true };
        });
    }

    function kuendigeUebergabeAn() {
        uebergabeAngekuendigt = true;
        setTimeout(() => { uebergabeAngekuendigt = false; }, UEBERGABE_TIMEOUT_MS);
    }

    async function eigenerStatus() {
        const g = await gesundheit();
        return {
            aktiv: true,
            initialisiert,
            knoten,
            partner_knoten: partnerKnoten,
            vip: clusterKonfig.vip,
            rolle,
            gesund: g.gesund,
            gruende: g.gruende,
            zeuge: g.zeuge,
            epoche: zustand ? zustand.epoche : null,
            master: zustand ? zustand.master : null,
            grund: zustand ? zustand.grund : null,
            geaendert_am: zustand ? zustand.geaendert_am : null,
            rueckstufung_erforderlich: !!(zustand && zustand.rueckstufung_erforderlich),
            rueckstufung_laeuft: rueckstufungLaeuft,
            letzter_rueckstufungsfehler: letzterRueckstufungsFehler,
            uebergabe_laeuft: !!uebergabe,
            pg: { rolle: g.pg_rolle, ...(letzterPgStatus || {}) },
            dokumente: await sync.dokumentStatus(),
            verlauf: verlauf.slice(0, 20),
            zeit: new Date().toISOString()
        };
    }

    // Schreibzugriffe (REST und Browser auf /db) nur als Master und nicht während einer Übergabe.
    const darfSchreiben = () => rolle === 'master' && !uebergabe;
    sync.setzeSchreibpruefung(darfSchreiben);

    let timer = null;
    function starte() {
        let laeuft = false;
        timer = setInterval(() => {
            if (laeuft) return;
            laeuft = true;
            seriell(pruefzyklus)
                .catch(err => console.error('[Cluster] Prüfzyklus fehlgeschlagen:', err.message))
                .finally(() => { laeuft = false; });
        }, PRUEF_MS);
    }

    starte();

    return {
        knoten,
        darfSchreiben,
        rolle: () => rolle,
        gesundheit,
        befoerdern,
        zurueckstufen,
        uebergeben,
        kuendigeUebergabeAn,
        eigenerStatus,
        async status() {
            const eigen = await eigenerStatus();
            const clients = await sync.listeClients().catch(() => []);
            return { aktiv: true, eigen, partner: letzterPartner || await holePartner(), clients };
        },
        stoppe() { if (timer) clearInterval(timer); }
    };
}
