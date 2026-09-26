// Brücke Dokument-DB -> relationale DB (nur Hallen-Server). Liest den _changes-Feed und wendet
// jede Änderung, die NICHT vom Server selbst stammt (bearbeitet_von !== 'server'), über die
// bestehende Fachlogik an. Was angewendet werden soll, ergibt sich aus dem Feld-Vergleich mit der
// SQL-Zeile — dadurch ist erneutes Anwenden wirkungslos (idempotent), auch nach einem Neustart.
//
// Lehnt die Fachlogik ab (FachFehler) oder scheitert sie technisch, bekommt das Dokument den
// Server-Stand zurück plus letzte_ablehnung (Rückmeldung an Matte/Waage), und ein
// konflikt:-Dokument hält beide Versionen für die Turnierleitung fest (Spec Abschnitt 10).
import { randomUUID } from 'crypto';
import { geaenderteFelder, gleicheWerte, mitServerStand } from '../shared/dokumentAbbildung.js';
import { aktualisiereKampf, setzeMattenReihenfolge } from '../controllers/kampfController.js';
import { pausiereMatte, setzeMatteFort } from '../controllers/kampfflaecheController.js';
import {
    HALLEN_KONTEXT, legeTeilnehmerAn, aktualisiereTeilnehmerDaten, bestaetigeKampfbereitschaft, werteForfeit
} from '../controllers/teilnehmerController.js';

const KAMPF_ERGEBNIS_FELDER = ['status', 'sieger_id', 'unterbewertung_kaempfer1', 'unterbewertung_kaempfer2', 'kampfzeit_in_sekunden'];
const TEILNEHMER_WAAGE_FELDER = [
    'vorname', 'nachname', 'judopass_id', 'verein', 'geburtsjahr', 'lizenz_ablauf', 'geschlecht',
    'gewicht', 'altersklasse', 'gewichtsklasse', 'graduierung', 'startgeld_bezahlt', 'gewogen'
];
const TABELLE_ZU_TYP = { kampf: 'kaempfe', kampfflaeche: 'kampfflaechen', teilnehmer: 'turnier_teilnehmer' };

// Wie lange die Brücke nach dem letzten eingegangenen Dokument wartet, bevor ein zurückgestelltes
// Ergebnis mit abweichender Paarung als echter Klärungsfall gilt (weitere Replikations-Batches
// könnten die fehlenden Vorkampf-Ergebnisse noch nachliefern).
const KLAERUNG_WARTEZEIT_MS = 2000;

// Ein Ergebnis (oder Forfeit) für einen Kampf, dessen Paarung laut Dokument von der SQL-Zeile
// abweicht: meist sind die Vorkampf-Ergebnisse, aus denen der Server die Paarung ableitet, nur noch
// nicht verarbeitet (die Replikation liefert nicht in Spielreihenfolge). Solche Dokumente werden
// zurückgestellt statt angewendet — sonst stünde ein "beendet"er Kampf ohne Kämpfer in SQL, den die
// Kaskade nie mehr anfasst.
class PaarungWeichtAb extends Error {}

function waageDaten(doc) {
    const daten = {};
    for (const feld of TEILNEHMER_WAAGE_FELDER) if (doc[feld] !== undefined) daten[feld] = doc[feld];
    return daten;
}

async function wendeKampfAn(knex, doc) {
    const id = doc.sql_id;
    const zeile = await knex('kaempfe').where({ id }).first();
    if (!zeile) return;

    // Live-Farbe ist reiner Anzeige-Zustand (bisher global.liveColors, siehe updateKampfColor).
    if (doc.live_farbe) {
        global.liveColors = global.liveColors || {};
        global.liveColors[id] = doc.live_farbe;
    }
    const willErgebnis = !!doc.forfeit_teilnehmer_id
        || (['beendet', 'freilos'].includes(doc.status) && !gleicheWerte(doc.status, zeile.status))
        || (doc.sieger_id != null && !gleicheWerte(doc.sieger_id, zeile.sieger_id));
    const paarungGleich = gleicheWerte(doc.kaempfer1_id, zeile.kaempfer1_id) && gleicheWerte(doc.kaempfer2_id, zeile.kaempfer2_id);
    if (willErgebnis && !paarungGleich && !['beendet', 'freilos'].includes(zeile.status)) {
        throw new PaarungWeichtAb(`Paarung von ${doc._id} weicht vom Server-Stand ab`);
    }

    if (doc.forfeit_teilnehmer_id && !['beendet', 'freilos'].includes(zeile.status)) {
        const art = doc.forfeit_art === 'disqualifiziert' ? 'disqualifiziert' : 'nicht_angetreten';
        await werteForfeit(knex, Number(doc.forfeit_teilnehmer_id), id, art, HALLEN_KONTEXT);
    } else {
        const ergebnis = geaenderteFelder(doc, zeile, KAMPF_ERGEBNIS_FELDER);
        if (Object.keys(ergebnis).length) await aktualisiereKampf(knex, id, ergebnis);
    }
    // Reihenfolge erst NACH dem Ergebnis vergleichen — die Neuplanung kann sie verändert haben.
    const nachErgebnis = await knex('kaempfe').where({ id }).first();
    const reihenfolge = geaenderteFelder(doc, nachErgebnis, ['matten_reihenfolge']);
    if ('matten_reihenfolge' in reihenfolge && zeile.matten_reihenfolge === nachErgebnis.matten_reihenfolge) {
        await setzeMattenReihenfolge(knex, id, reihenfolge.matten_reihenfolge);
    }
}

async function wendeKampfflaecheAn(knex, doc) {
    const id = doc.sql_id;
    const zeile = await knex('kampfflaechen').where({ id }).first();
    if (!zeile) return;
    if (doc.status === 'pausiert' && zeile.status !== 'pausiert') await pausiereMatte(knex, id);
    else if (doc.status !== 'pausiert' && zeile.status === 'pausiert') await setzeMatteFort(knex, id);
}

async function wendeTeilnehmerAn(knex, db, doc, legeKonfliktAn) {
    let id = doc.sql_id;
    if (id == null) {
        // Nachmeldung — bereits angelegt (z.B. vor einem Neustart)? Dann nur zuordnen.
        const vorhanden = await knex('turnier_teilnehmer').where({ dokument_id: doc._id }).first();
        if (vorhanden) {
            id = vorhanden.id;
        } else {
            try {
                id = await legeTeilnehmerAn(knex, { ...waageDaten(doc), turnier_id: doc.turnier_id, dokument_id: doc._id }, HALLEN_KONTEXT);
            } catch (err) {
                if (err.code !== 'DUBLETTE') throw err;
                // Dublette (z.B. an zwei Waagen offline doppelt nachgemeldet): Wiegedaten auf den
                // bestehenden Teilnehmer übernehmen, Nachmeldungs-Dokument als Dublette verknüpfen.
                const bestehendeId = err.daten.bestehendeId;
                await aktualisiereTeilnehmerDaten(knex, bestehendeId, waageDaten(doc), HALLEN_KONTEXT);
                const bestehend = await knex('turnier_teilnehmer').where({ id: bestehendeId }).first();
                await db.put({
                    ...doc, sql_id: bestehendeId, id: bestehendeId,
                    dublette_von: bestehend.dokument_id || `teilnehmer:${bestehendeId}`, bearbeitet_von: 'server'
                });
                await legeKonfliktAn('dublette', doc, err.message);
                return;
            }
        }
    } else {
        const zeile = await knex('turnier_teilnehmer').where({ id }).first();
        if (!zeile) return;
        if (Object.keys(geaenderteFelder(doc, zeile, TEILNEHMER_WAAGE_FELDER)).length) {
            await aktualisiereTeilnehmerDaten(knex, id, waageDaten(doc), HALLEN_KONTEXT);
        }
    }
    const nachher = await knex('turnier_teilnehmer').where({ id }).first();
    if (doc.status === 'kampfbereit' && ['angemeldet', 'nicht_erschienen'].includes(nachher.status)) {
        await bestaetigeKampfbereitschaft(knex, id, HALLEN_KONTEXT);
    }
}

export function erzeugeBruecke({ knex, zustand, abgleich }) {
    let feed = null;
    let kette = Promise.resolve();

    let offen = 0; // gemeldete, noch nicht verarbeitete Änderungen
    const zurueckgestellt = new Set(); // Dokument-IDs mit abweichender Paarung (siehe PaarungWeichtAb)
    let klaerungsTimer = null;
    let klaerungsLauf = Promise.resolve();

    async function legeKonfliktAnIn(db, konfliktTyp, doc, grund, { prioritaet = 'normal', versionServer = null } = {}) {
        await db.put({
            _id: `konflikt:${randomUUID()}`, dokumenttyp: 'konflikt', konflikt_typ: konfliktTyp, prioritaet,
            bezug_id: doc._id, grund, version_lokal: doc, version_server: versionServer,
            erstellt_am: new Date().toISOString(), erledigt: false, bearbeitet_von: 'server'
        });
    }

    // Echter Klärungsfall (Spec Abschnitt 10): Ergebnis wurde offline mit einer anderen Paarung
    // gespielt, als der Server sie berechnet. Nicht automatisch lösen — Kampf auf 'klaerung',
    // Konflikt mit hoher Priorität, die Turnierleitung entscheidet.
    async function markiereKlaerung(db, doc) {
        const zeile = await knex('kaempfe').where({ id: doc.sql_id }).first();
        if (!zeile || ['beendet', 'freilos'].includes(zeile.status)) return;
        await knex('kaempfe').where({ id: doc.sql_id }).update({ status: 'klaerung', updated_at: knex.fn.now() });
        await legeKonfliktAnIn(db, 'klaerung', doc,
            'Der Kampf wurde an der Matte mit einer anderen Paarung gewertet, als der Server sie berechnet hat. Bitte manuell klären.',
            { prioritaet: 'hoch', versionServer: zeile });
        await markiereAngewendet(doc);
        await abgleich.fuehreAus();
    }

    // Zurückgestellte Dokumente erneut versuchen (neuester Stand). final=true: was dann immer noch
    // abweicht, wird zum Klärungsfall.
    async function holeZurueckgestellteNach(db, final) {
        let fortschritt = true;
        while (fortschritt && zurueckgestellt.size) {
            fortschritt = false;
            for (const id of [...zurueckgestellt]) {
                const doc = await db.get(id).catch(() => null);
                zurueckgestellt.delete(id);
                if (!doc || doc.bearbeitet_von === 'server') continue;
                await verarbeite(db, doc);
                if (!zurueckgestellt.has(id)) fortschritt = true;
            }
        }
        if (final) {
            for (const id of [...zurueckgestellt]) {
                zurueckgestellt.delete(id);
                const doc = await db.get(id).catch(() => null);
                if (doc && doc.bearbeitet_von !== 'server') await markiereKlaerung(db, doc);
            }
        }
    }

    function planeNachholen(db) {
        if (offen > 0 || !zurueckgestellt.size) return;
        kette = kette.then(() => holeZurueckgestellteNach(db, false)).catch(err => console.error('[Brücke] Nachholen:', err));
        if (klaerungsTimer) clearTimeout(klaerungsTimer);
        klaerungsLauf = new Promise((fertig) => {
            klaerungsTimer = setTimeout(() => {
                klaerungsTimer = null;
                kette = kette.then(() => holeZurueckgestellteNach(db, true)).catch(err => console.error('[Brücke] Klärung:', err));
                kette.then(fertig, fertig);
            }, KLAERUNG_WARTEZEIT_MS);
        });
    }

    async function lehneAb(db, doc, tabelle, fehler) {
        const fachlich = !!fehler.statusCode;
        if (!fachlich) console.error('[Brücke] Technischer Fehler bei', doc._id, fehler);
        const zeile = doc.sql_id != null ? await knex(tabelle).where({ id: doc.sql_id }).first() : null;
        const ablehnung = { rev: doc._rev, art: fachlich ? 'fachlich' : 'technisch', grund: fehler.message, zeit: new Date().toISOString() };
        // Server-Stand zurück (bzw. bei nie angelegter Nachmeldung nur die Ablehnung vermerken).
        const zurueck = zeile ? mitServerStand(doc, tabelle, zeile) : { ...doc, bearbeitet_von: 'server' };
        try {
            await db.put({ ...zurueck, letzte_ablehnung: ablehnung });
        } catch (err) {
            if (err.status !== 409) throw err; // neuere Änderung inzwischen da -> kommt als eigener Change
        }
        await legeKonfliktAnIn(db, fachlich ? 'abgelehnt' : 'bruecke_fehler', doc, fehler.message);
    }

    // CouchDB-Konflikt (zwei Revisionen desselben Dokuments, z.B. Wiegung an zwei Waagen oder
    // Matten-Ergebnis während der Server das Dokument geändert hat). Grundsatz: eine Revision eines
    // Geräts (bearbeitet_von !== 'server') ist eine Absicht und darf nicht verloren gehen —
    // sie gewinnt gegen Server-Revisionen (die sind jederzeit per Abgleich wiederherstellbar).
    // Unter mehreren Geräte-Revisionen eines Teilnehmers gewinnt die jüngste Wiegung (gewogen_am,
    // Spec Abschnitt 10), sonst die von CouchDB gewählte. Liefert true, wenn ein neues Dokument
    // geschrieben wurde (das dann als eigene Änderung erneut durch die Brücke läuft).
    async function loeseKonflikte(db, doc) {
        const revs = [doc._rev, ...doc._conflicts];
        const versionen = [];
        for (const rev of revs) {
            const v = await db.get(doc._id, { rev }).catch(() => null);
            if (v) versionen.push(v);
        }
        const geraete = versionen.filter(v => v.bearbeitet_von !== 'server');
        const kandidaten = geraete.length ? geraete : versionen;
        let gewinner = kandidaten.find(v => v._rev === doc._rev) || kandidaten[0];
        if (doc._id.startsWith('teilnehmer:')) {
            for (const v of kandidaten) {
                if (String(v.gewogen_am || '') > String(gewinner.gewogen_am || '')) gewinner = v;
            }
        }
        const verlierer = versionen.filter(v => v._rev !== doc._rev);
        await db.bulkDocs(verlierer.map(v => ({ _id: v._id, _rev: v._rev, _deleted: true })));
        if (gewinner._rev !== doc._rev) {
            const { _rev, _conflicts, ...inhalt } = gewinner;
            await db.put({ ...inhalt, _id: doc._id, _rev: doc._rev });
            return true;
        }
        return false;
    }

    async function markiereAngewendet(doc) {
        await knex('sync_angewendet').insert({ doc_id: doc._id, rev: doc._rev }).onConflict(['doc_id', 'rev']).ignore();
    }

    async function verarbeite(db, doc) {
        if (!doc || doc._deleted) return;
        if (doc._conflicts && doc._conflicts.length) {
            if (await loeseKonflikte(db, doc)) return;
            delete doc._conflicts;
        }
        if (doc.bearbeitet_von === 'server') return;
        const typ = doc._id.split(':')[0];
        const tabelle = TABELLE_ZU_TYP[typ];
        if (!tabelle) return;

        const schonAngewendet = await knex('sync_angewendet').where({ doc_id: doc._id, rev: doc._rev }).first();
        if (schonAngewendet) return;

        // Offline-Kaskade eines Client-Geräts (src/sync/kaskadeLokal.js): nicht anwenden — der Server
        // rechnet nach dem zugrunde liegenden Ergebnis selbst nach. Als verarbeitet markieren, damit
        // der Abgleich das Dokument mit dem maßgeblichen Server-Stand überschreiben darf.
        if (String(doc.bearbeitet_von || '').startsWith('kaskade:')) {
            await markiereAngewendet(doc);
            await abgleich.fuehreAus();
            return;
        }

        try {
            if (typ === 'kampf') await wendeKampfAn(knex, doc);
            else if (typ === 'kampfflaeche') await wendeKampfflaecheAn(knex, doc);
            else await wendeTeilnehmerAn(knex, db, doc, (t, d, g) => legeKonfliktAnIn(db, t, d, g));
        } catch (fehler) {
            if (fehler instanceof PaarungWeichtAb) {
                zurueckgestellt.add(doc._id);
                return;
            }
            await lehneAb(db, doc, tabelle, fehler);
        }
        zurueckgestellt.delete(doc._id);
        await markiereAngewendet(doc);
        await abgleich.fuehreAus();
    }

    function starte() {
        const db = zustand.db;
        if (!db || feed) return;
        feed = db.changes({ since: 0, live: true, include_docs: true, conflicts: true });
        feed.on('change', (change) => {
            offen++;
            if (klaerungsTimer) {
                clearTimeout(klaerungsTimer);
                klaerungsTimer = null;
            }
            kette = kette
                .then(() => verarbeite(db, change.doc))
                .catch(err => console.error('[Brücke] Fehler:', err))
                .finally(() => {
                    offen--;
                    planeNachholen(db);
                });
        });
        feed.on('error', (err) => console.error('[Brücke] Feed-Fehler:', err));
    }

    async function stoppe() {
        if (feed) {
            feed.cancel();
            feed = null;
        }
        await kette;
    }

    // Wartet, bis Brücke und Abgleich (der die Brücke erneut auslösen kann) beide ruhen — dem Feed
    // wird jeweils kurz Zeit gegeben, gerade geschriebene Dokumente zu melden.
    async function leerlauf() {
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 150));
            await kette;
            if (klaerungsTimer) await klaerungsLauf;
            await abgleich.leerlauf();
        }
    }

    async function neuStarten() {
        await stoppe();
        starte();
    }

    // Konfliktliste der Turnierleitung (matten.html): offene zuerst, hohe Priorität zuerst.
    async function listeKonflikte() {
        const db = zustand.db;
        if (!db) return [];
        const res = await db.allDocs({ include_docs: true, startkey: 'konflikt:', endkey: 'konflikt:\ufff0' });
        const rang = { hoch: 0, normal: 1 };
        return res.rows.map(r => r.doc)
            .filter(d => !d.erledigt)
            .sort((a, b) => (rang[a.prioritaet] ?? 1) - (rang[b.prioritaet] ?? 1) || String(b.erstellt_am).localeCompare(String(a.erstellt_am)));
    }

    async function erledigeKonflikt(id) {
        const db = zustand.db;
        const doc = await db.get(id);
        await db.put({ ...doc, erledigt: true, erledigt_am: new Date().toISOString() });
    }

    // "Erneut versuchen" (v.a. bei technischen Brückenfehlern): die damals abgelehnte Geräte-
    // Version noch einmal als Änderung einspielen — die Brücke verarbeitet sie wie neu.
    async function wiederholeKonflikt(id) {
        const db = zustand.db;
        const konflikt = await db.get(id);
        const aktuell = await db.get(konflikt.bezug_id).catch(() => null);
        const { _rev, _conflicts, letzte_ablehnung, ...inhalt } = konflikt.version_lokal || {};
        await db.put({ ...inhalt, _id: konflikt.bezug_id, ...(aktuell ? { _rev: aktuell._rev } : {}), bearbeitet_von: 'wiederholung' });
        await erledigeKonflikt(id);
    }

    return { starte, stoppe, leerlauf, neuStarten, listeKonflikte, erledigeKonflikt, wiederholeKonflikt };
}
