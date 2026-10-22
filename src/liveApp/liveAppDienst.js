// Teilnehmer-App am Hallen-Server (Spec docs/specs/2026-10-22-teilnehmer-app-schalter-design.md): prüft regelmäßig, ob die
// Cloud erreichbar ist, und sendet bei eingeschalteter Funktion die Snapshots des Turniers an deren Ingest. Läuft im
// Server-Prozess (kein eigener Dienst, keine live.env); Token und Geheimnis stammen vom Turnier (Cloud-Export beim Holen).
// Im Cluster sendet genau ein Knoten (entscheideSender); der Zustand liegt in turniere und repliziert zum Partner.
import fs from 'node:fs';
import path from 'node:path';
import { berechneAnzeige, entscheideSender } from './zustand.js';
import { ladeSnapshots } from '../live/snapshot.js';
import { erzeugeUplink } from '../live/uplink.js';
import { liesCloudUrl } from '../services/cloudZugriff.js';
import { FachFehler } from '../utils/fachFehler.js';

const TURNIER_SPALTEN = ['id', 'status', 'urspruengliche_id', 'live_freigabe', 'live_token', 'live_geheimnis', 'live_ruecknahme'];

function fehlerMitGrund(status, nachricht, grund) {
    return new FachFehler(status, nachricht, { code: grund });
}

const GRUND_TEXT = {
    cloud_nicht_konfiguriert: 'Es ist keine Cloud-Adresse (CLOUD_URL) eingerichtet.',
    kein_turnier: 'Es ist kein Turnier ausgewählt.',
    kein_cloud_turnier: 'Dieses Turnier wurde nicht aus der Cloud geholt, die Teilnehmer-App ist nicht verfügbar.',
    kein_token: 'Für dieses Turnier liegt kein Cloud-Token vor. Bitte das Turnier erneut aus der Cloud holen.',
    turnier_abgeschlossen: 'Ein abgeschlossenes Turnier kann nicht an die Teilnehmer-App gesendet werden.'
};

export function starteLiveAppDienst({
    knex, cloud, holeCluster = () => null, env = process.env, jetzt = Date.now, timer = true,
    erzeugeUplinkFn = erzeugeUplink, ladeSnapshotsFn = ladeSnapshots, log = console
}) {
    const pruefMs = Number(env.LIVE_APP_PRUEF_MS) || 15000;
    const taktMs = Number(env.LIVE_APP_TAKT_MS) || 5000;
    const uplinks = new Map(); // `${token}` -> Uplink
    let cloudErreichbar = false;
    // Erfolg und Fehler je Turnier (Schlüssel = urspruengliche_id): mehrere Turniere am Hallen-Server dürfen sich nicht überschreiben.
    const proTurnier = new Map(); // key -> { erfolgMs, fehler }
    let allgemeinerFehler = null; // Durchlauf scheiterte, bevor ein Turnier zugeordnet werden konnte (z. B. Datenbank)
    let sendetSelbst = false;
    let tickLaeuft = false;
    let pruefLaeuft = false;

    function cloudZiel() {
        const basis = liesCloudUrl(env);
        return basis ? `${basis}/api/live/ingest` : null;
    }

    function holeUplink(zeile) {
        let uplink = uplinks.get(zeile.live_token);
        if (!uplink) {
            const verzeichnis = env.SYNC_DATENVERZEICHNIS || './data/dokumente';
            try { fs.mkdirSync(verzeichnis, { recursive: true }); } catch { /* der Uplink meldet eine nicht beschreibbare Datei selbst */ }
            uplink = erzeugeUplinkFn({
                url: cloudZiel(), token: zeile.live_token,
                zustandDatei: path.join(verzeichnis, `live-app-gesendet-${zeile.urspruengliche_id}.json`), log
            });
            uplinks.set(zeile.live_token, uplink);
        }
        return uplink;
    }

    // Beschreibt den Sender aus Sicht dieses Knotens (siehe zustand.js); partner ist der letzte Stand des anderen Knotens.
    function sichtAufCluster() {
        const cluster = holeCluster();
        if (!cluster) return { clusterAktiv: false, rolle: 'master', partner: null, partnerStatus: null, eigenerKnoten: null };
        const p = cluster.partnerLetzter ? cluster.partnerLetzter() : null;
        return {
            clusterAktiv: true, rolle: cluster.rolle(), eigenerKnoten: cluster.knoten || null, partnerStatus: p,
            partner: p ? { rolle: p.rolle, cloud_erreichbar: !!(p.live_app && p.live_app.cloud_erreichbar === true) } : null
        };
    }

    function ermittleSender() {
        const sicht = sichtAufCluster();
        const sender = entscheideSender({
            clusterAktiv: sicht.clusterAktiv, rolle: sicht.rolle, eigenErreichbar: cloudErreichbar, partner: sicht.partner
        });
        return { sender, sicht };
    }

    async function ladeTurnier(turnierId) {
        if (!Number.isInteger(turnierId) || turnierId <= 0) return null;
        return (await knex('turniere').where({ id: turnierId }).first(TURNIER_SPALTEN)) || null;
    }

    function pruefeVerfuegbar(turnier) {
        if (!cloud.konfiguriert()) return 'cloud_nicht_konfiguriert';
        if (!turnier) return 'kein_turnier';
        if (turnier.urspruengliche_id == null) return 'kein_cloud_turnier';
        if (turnier.status === 'abgeschlossen') return 'turnier_abgeschlossen';
        if (!turnier.live_token) return 'kein_token';
        return null;
    }

    async function pruefeCloud() {
        if (pruefLaeuft) return;
        pruefLaeuft = true;
        try {
            cloudErreichbar = cloud.konfiguriert() ? !!(await cloud.pruefeErreichbar()) : false;
        } catch {
            cloudErreichbar = false;
        } finally {
            pruefLaeuft = false;
        }
    }

    function merke(key, werte) {
        proTurnier.set(key, { erfolgMs: null, fehler: null, ...proTurnier.get(key), ...werte });
    }

    async function sendeFuer(zeile) {
        const key = String(zeile.urspruengliche_id);
        const ziel = cloudZiel();
        const lokal = ziel && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(ziel).hostname);
        if (!ziel || (!lokal && !ziel.startsWith('https:'))) {
            merke(key, { fehler: 'Die Cloud-Adresse muss https verwenden.' });
            return;
        }
        const uplink = holeUplink(zeile);
        if (zeile.live_freigabe) {
            const alle = await ladeSnapshotsFn(knex, { geheimnis: zeile.live_geheimnis });
            await uplink.sende(alle.filter(s => s.turnierKey === key));
        } else {
            await uplink.sende([], { zurueckzunehmen: [key] });
        }
        const z = uplink.zustand();
        merke(key, { fehler: z.letzterFehler || null, ...(z.letzterErfolg != null ? { erfolgMs: z.letzterErfolg } : {}) });
    }

    async function tick() {
        if (tickLaeuft) return;
        tickLaeuft = true;
        try {
            const { sender } = ermittleSender();
            sendetSelbst = false;
            if (sender !== 'eigener') return;
            const zeilen = await knex('turniere')
                .where(function () { this.where({ live_freigabe: true }).orWhere({ live_ruecknahme: true }); })
                .whereNotNull('live_token').whereNotNull('urspruengliche_id')
                .select(TURNIER_SPALTEN);
            if (!zeilen.length) return;
            sendetSelbst = zeilen.some(z => z.live_freigabe);
            allgemeinerFehler = null;
            for (const zeile of zeilen) await sendeFuer(zeile);
        } catch (fehler) {
            allgemeinerFehler = `Senden fehlgeschlagen: ${fehler && fehler.message ? fehler.message : fehler}`;
            log.error(`[Teilnehmer-App] Durchlauf fehlgeschlagen: ${allgemeinerFehler}`);
        } finally {
            tickLaeuft = false;
        }
    }

    async function status({ turnierId } = {}) {
        const turnier = await ladeTurnier(turnierId);
        const grund = pruefeVerfuegbar(turnier);
        const verfuegbar = grund === null;
        // aktiv ist der tatsächliche Schalterzustand, auch wenn das Turnier inzwischen abgeschlossen ist (sonst ließe es sich nicht mehr ausschalten).
        const aktiv = !!turnier && cloud.konfiguriert() && !!turnier.live_freigabe && !!turnier.live_token && turnier.urspruengliche_id != null;
        const key = turnier && turnier.urspruengliche_id != null ? String(turnier.urspruengliche_id) : null;
        const poolsVerteilt = turnier
            ? !!(await knex('pools').where({ turnier_id: turnier.id, verspaetet: false }).whereNotNull('kampfflaeche_id').first('id'))
            : false;
        const { sender, sicht } = ermittleSender();
        const partnerApp = sicht.partnerStatus && sicht.partnerStatus.live_app ? sicht.partnerStatus.live_app : null;
        const cloudErreichbarIrgendwo = cloudErreichbar || !!(partnerApp && partnerApp.cloud_erreichbar);
        const eigener = (key && proTurnier.get(key)) || { erfolgMs: null, fehler: null };
        let erfolgMs = eigener.erfolgMs;
        let fehler = eigener.fehler || allgemeinerFehler;
        if (sender === 'partner' && partnerApp) {
            const stand = (key && partnerApp.turniere && partnerApp.turniere[key]) || partnerApp;
            erfolgMs = stand.letzter_erfolg ? Date.parse(stand.letzter_erfolg) : null;
            fehler = stand.letzter_fehler || null;
        }
        const anzeige = berechneAnzeige({
            verfuegbar: verfuegbar || aktiv, aktiv, cloudErreichbar: cloudErreichbarIrgendwo, letzterErfolgMs: erfolgMs, letzterFehler: fehler, jetztMs: jetzt()
        });
        return {
            verfuegbar, grund, grundText: grund ? GRUND_TEXT[grund] : null, aktiv, zustand: anzeige.zustand, text: anzeige.text,
            poolsVerteilt, cloudErreichbar: cloudErreichbarIrgendwo, sender,
            senderKnoten: sender === 'eigener' ? sicht.eigenerKnoten : sender === 'partner' ? (sicht.partnerStatus.knoten || null) : null,
            letzterErfolg: erfolgMs != null ? new Date(erfolgMs).toISOString() : null,
            letzterFehler: fehler
        };
    }

    async function schalte({ turnierId, aktiv }) {
        const turnier = await ladeTurnier(turnierId);
        if (!turnier) throw fehlerMitGrund(404, GRUND_TEXT.kein_turnier, 'kein_turnier');
        if (aktiv) {
            const grund = pruefeVerfuegbar(turnier);
            if (grund) throw fehlerMitGrund(409, GRUND_TEXT[grund], grund);
            await knex('turniere').where({ id: turnier.id }).update({ live_freigabe: true, live_ruecknahme: false });
        } else {
            const zuruecknehmen = turnier.urspruengliche_id != null && !!turnier.live_token;
            await knex('turniere').where({ id: turnier.id }).update({ live_freigabe: false, live_ruecknahme: zuruecknehmen });
        }
        tick().catch(() => {});
        return status({ turnierId: turnier.id });
    }

    // Was der Partner im Cluster-Status über diesen Knoten sieht.
    function statusFuerPartner() {
        const turniere = {};
        let erfolgMs = null;
        let fehler = allgemeinerFehler;
        for (const [key, stand] of proTurnier) {
            turniere[key] = {
                letzter_erfolg: stand.erfolgMs != null ? new Date(stand.erfolgMs).toISOString() : null,
                letzter_fehler: stand.fehler
            };
            if (stand.erfolgMs != null && (erfolgMs == null || stand.erfolgMs > erfolgMs)) erfolgMs = stand.erfolgMs;
            fehler = fehler || stand.fehler;
        }
        return {
            cloud_erreichbar: cloudErreichbar,
            sendet: sendetSelbst,
            letzter_erfolg: erfolgMs != null ? new Date(erfolgMs).toISOString() : null,
            letzter_fehler: fehler,
            turniere
        };
    }

    const timerIds = [];
    if (timer && cloud.konfiguriert()) {
        pruefeCloud().catch(() => {});
        timerIds.push(setInterval(() => pruefeCloud().catch(() => {}), pruefMs));
        timerIds.push(setInterval(() => tick().catch(() => {}), taktMs));
        for (const t of timerIds) t.unref?.();
    }

    return { status, schalte, statusFuerPartner, pruefeCloud, tick, stoppe: () => timerIds.forEach(clearInterval) };
}
