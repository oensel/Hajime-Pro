// Lese-API eines Client-Geräts als reine Funktion: beantwortet die Endpunkte, die Waage
// (teilnehmer.html), Scoreboard (steuerung.html), Mattenleitung (kampf.html) und menu.js brauchen,
// aus den lokalen Dokumenten — in derselben Form wie der Hallen-Server. Gemeinsam genutzt vom
// Express-Router des Node-Clients (src/sync/clientApi.js) und von der Android-App
// (public/js/mobil/). Schreibvorgänge laufen nicht hierüber, sondern über public/js/datenzugriff.js
// direkt in die lokale Dokument-DB; alle übrigen Verwaltungsfunktionen gibt es nur am Hallen-Server.
import { baueMattenAnsicht } from './mattenAnsicht.js';

export const NUR_AM_SERVER = 'Nur am Hallen-Server verfügbar.';

async function dokumenteNachTyp(db) {
    const res = await db.allDocs({ include_docs: true });
    const nachTyp = {};
    for (const row of res.rows) {
        const doc = row.doc;
        if (!doc || !doc.dokumenttyp) continue;
        (nachTyp[doc.dokumenttyp] = nachTyp[doc.dokumenttyp] || []).push(doc);
    }
    return nachTyp;
}

function parseListe(wert) {
    if (typeof wert !== 'string') return wert || [];
    try {
        return JSON.parse(wert);
    } catch (e) {
        return wert ? wert.split(',') : [];
    }
}

// Entfernt Sync-Metadaten, damit die Antworten wie die des Servers aussehen.
function alsZeile(doc) {
    const { _id, _rev, _conflicts, dokumenttyp, sql_id, bearbeitet_von, geschrieben_von_knoten, letzte_ablehnung, ...zeile } = doc;
    return zeile;
}

function turnierAntwort(doc, teilnehmerAnzahl) {
    const turnier = alsZeile(doc);
    turnier.altersklassen = parseListe(turnier.altersklassen);
    turnier.mannschafts_altersklassen = parseListe(turnier.mannschafts_altersklassen);
    turnier.teilnehmer_anzahl = teilnehmerAnzahl;
    return turnier;
}

const ok = (body) => ({ status: 200, body });

// pfad: Pfad unterhalb von /api (z.B. "/turniere/3"), query: Objekt, body: geparster Body,
// kopfzeilen: Header in Kleinschreibung, sha256Hex(text): SHA-256 als Hex (async, je Plattform).
export async function beantworteClientAnfrage({ methode, pfad, query = {}, body = null, kopfzeilen = {} }, { db, sha256Hex }) {
    const m = String(methode || 'GET').toUpperCase();

    if (m === 'GET' && pfad === '/auth/mode') {
        const konfig = await db.get('konfig:steuerung').catch(() => null);
        return ok({ passwordRequired: !!(konfig && konfig.steuerung_passwort_sha256) });
    }

    // Steuerungs-Passwort offline prüfen: Vergleich gegen den replizierten SHA-256-Hash.
    if (m === 'POST' && pfad === '/auth/verify') {
        const konfig = await db.get('konfig:steuerung').catch(() => null);
        const eingabe = kopfzeilen['x-steuerung-password'] || (body && body.password) || '';
        const hash = await sha256Hex(String(eingabe));
        if (konfig && konfig.steuerung_passwort_sha256 && hash === konfig.steuerung_passwort_sha256) {
            return ok({ success: true });
        }
        return { status: 401, body: { success: false, error: 'Ungültiges Passwort.' } };
    }

    if (m === 'GET') {
        // Wie der Offline-Mock-Benutzer des Hallen-Servers (requireAuth bei IS_OFFLINE=true).
        if (pfad === '/auth/me') {
            return ok({
                success: true,
                user: {
                    id: 'offline_user', email: 'offline@hajime.os', vorname: 'Offline', nachname: 'User',
                    verein_id: null, verein_name: 'Offline Club', verein_freigegeben: true,
                    verein_wartet_auf_super_admin: false, verein_mitglieder_anzahl: 1, ist_super_admin: false, vereine: []
                }
            });
        }

        if (pfad === '/turniere') {
            const docs = await dokumenteNachTyp(db);
            return ok((docs.turnier || []).map(t => turnierAntwort(t, (docs.teilnehmer || []).length)));
        }

        const turnierId = pfad.match(/^\/turniere\/([^/]+)$/);
        if (turnierId) {
            const docs = await dokumenteNachTyp(db);
            const turnier = (docs.turnier || []).find(t => String(t.id) === String(decodeURIComponent(turnierId[1])));
            if (!turnier) return { status: 404, body: { error: 'Turnier nicht gefunden.' } };
            return ok(turnierAntwort(turnier, (docs.teilnehmer || []).filter(t => t.sql_id != null).length));
        }

        if (pfad === '/kampfflaechen') {
            const docs = await dokumenteNachTyp(db);
            return ok((docs.kampfflaeche || [])
                .filter(k => String(k.turnier_id) === String(query.turnierId))
                .sort((a, b) => a.id - b.id)
                .map(alsZeile));
        }

        if (pfad === '/kaempfe') {
            if (!query.kampfflaecheId) return { status: 400, body: { success: false, error: NUR_AM_SERVER } };
            const docs = await dokumenteNachTyp(db);
            return ok(baueMattenAnsicht({
                kaempfe: docs.kampf || [], pools: docs.pool || [], teilnehmer: docs.teilnehmer || [],
                mannschaftskaempfe: docs.mannschaftskampf || [], mannschaften: docs.mannschaft || [],
                turnier: (docs.turnier || [])[0]
            }, query.kampfflaecheId, Date.now()).map(alsZeile));
        }

        if (pfad === '/teilnehmer') {
            const docs = await dokumenteNachTyp(db);
            return ok((docs.teilnehmer || [])
                .filter(t => String(t.turnier_id) === String(query.turnierId) && t.id != null && !t.dublette_von)
                .map(alsZeile)
                .sort((a, b) => String(a.nachname).localeCompare(String(b.nachname), 'de')));
        }

        const teilnehmerId = pfad.match(/^\/teilnehmer\/([^/]+)$/);
        if (teilnehmerId) {
            const docs = await dokumenteNachTyp(db);
            const t = (docs.teilnehmer || []).find(d => String(d.id) === String(decodeURIComponent(teilnehmerId[1])));
            if (!t) return { status: 404, body: { success: false, error: 'Teilnehmer nicht gefunden.' } };
            return ok(alsZeile(t));
        }

        // Mannschaftszuordnung an der Waage gibt es nur am Server (Spec Abschnitt 4).
        if (pfad === '/mannschaften') return ok([]);

        // Teilnehmerliste je Altersklasse gesperrt/ausgelost (gleiche Regel wie poolController,
        // ermittleAltersklassenPoolZustand); `gesperrt` bleibt als Alias für ältere Clients.
        if (pfad === '/pools/vorhanden') {
            const docs = await dokumenteNachTyp(db);
            const pools = (docs.pool || []).filter(p => String(p.turnier_id) === String(query.turnierId) && p.typ !== 'mannschaft');
            // Wie ermittleAltersklassenPoolZustand: "ausgelost" erst mit mindestens einem Teilnehmer im Pool.
            const poolIdsMitTeilnehmern = new Set((docs.teilnehmer || []).filter(t => t.pool_id != null).map(t => String(t.pool_id)));
            const poolIdsMitEchtenKaempfen = new Set((docs.kampf || [])
                .filter(k => ['gestartet', 'beendet'].includes(k.status))
                .map(k => String(k.pool_id)));
            const ausgelost = new Set();
            const gesperrt = new Set();
            for (const pool of pools) {
                if (!pool.altersklasse) continue;
                if (poolIdsMitTeilnehmern.has(String(pool.id))) ausgelost.add(pool.altersklasse);
                if (poolIdsMitEchtenKaempfen.has(String(pool.id))) gesperrt.add(pool.altersklasse);
            }
            return ok({
                gesperrt: gesperrt.size > 0,
                gesperrteAltersklassen: [...gesperrt].sort(),
                ausgelosteAltersklassen: [...ausgelost].sort()
            });
        }

        return { status: 404, body: { success: false, error: NUR_AM_SERVER } };
    }

    return { status: 403, body: { success: false, error: NUR_AM_SERVER } };
}
