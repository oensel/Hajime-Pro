// Brücke Dokument-DB -> relationale DB (nur Hallen-Server). Liest den _changes-Feed und wendet
// jede Änderung, die NICHT vom Server selbst stammt (bearbeitet_von !== 'server'), über die
// bestehende Fachlogik an.
//
// Was ein Gerät ändern WOLLTE (seine Absicht), ergibt sich aus dem Vergleich mit der letzten
// Server-Version, die das Gerät kannte (jüngster Vorfahr in der Revisionsgeschichte mit
// bearbeitet_von: 'server') — NICHT aus dem Vergleich mit dem aktuellen SQL-Stand. Sonst würden
// veraltete Felder eines Geräts (z.B. eine inzwischen vom Server neu geplante Reihenfolge oder ein
// von der Turnierleitung korrigiertes Ergebnis) als "Änderung" zurückgeschrieben. Angewendet wird
// nur, was sich zusätzlich noch vom SQL-Stand unterscheidet — dadurch bleibt erneutes Anwenden
// wirkungslos (idempotent), auch nach einem Neustart.
//
// Lehnt die Fachlogik ab (FachFehler) oder scheitert sie technisch, bekommt das Dokument den
// Server-Stand zurück plus letzte_ablehnung (Rückmeldung an Matte/Waage), und ein
// konflikt:-Dokument hält beide Versionen für die Turnierleitung fest (Spec Abschnitt 10).
import { randomUUID } from 'crypto';
import { geaenderteFelder, gleicheWerte, mitServerStand } from '../shared/dokumentAbbildung.js';
import { aktualisiereKampf, setzeMattenReihenfolge, setzeKampfZurueck } from '../controllers/kampfController.js';
import { FachFehler } from '../utils/fachFehler.js';
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

const META_FELDER = new Set(['_id', '_rev', '_revisions', '_conflicts', 'bearbeitet_von', 'geschrieben_von_knoten', 'letzte_ablehnung']);

// Jüngster Vorfahr des Dokuments, den der Server selbst geschrieben hat (die Version, auf der die
// Geräte-Änderung aufsetzt). Zwischenstände, die nur auf dem Gerät existierten, hat die Replikation
// ohne Inhalt übertragen — sie werden übersprungen. null: keine Server-Version bekannt.
async function ladeServerBasis(db, doc) {
    const mitRevs = await db.get(doc._id, { rev: doc._rev, revs: true }).catch(() => null);
    if (!mitRevs || !mitRevs._revisions) return null;
    const { start, ids } = mitRevs._revisions;
    for (let i = 1; i < ids.length; i++) {
        const version = await db.get(doc._id, { rev: `${start - i}-${ids[i]}` }).catch(() => null);
        if (version && version.bearbeitet_von === 'server') return version;
    }
    return null;
}

// Felder, die das Gerät gegenüber der Basis geändert hat (Feld -> neuer Wert). Ohne Basis gilt der
// Vergleich mit dem SQL-Stand (vergleichszeile) als Rückfall.
function absichtGegenueber(doc, basis, vergleichszeile, felder) {
    return geaenderteFelder(doc, basis || vergleichszeile, felder);
}

async function wendeKampfAn(knex, doc, basis) {
    const id = doc.sql_id;
    const zeile = await knex('kaempfe').where({ id }).first();
    if (!zeile) return;

    // Live-Farbe ist reiner Anzeige-Zustand (bisher global.liveColors, siehe updateKampfColor).
    if (doc.live_farbe) {
        global.liveColors = global.liveColors || {};
        global.liveColors[id] = doc.live_farbe;
    }
    const absicht = absichtGegenueber(doc, basis, zeile, [...KAMPF_ERGEBNIS_FELDER, 'matten_reihenfolge']);
    const ergebnisAbsicht = {};
    for (const feld of KAMPF_ERGEBNIS_FELDER) {
        if (feld in absicht && !gleicheWerte(absicht[feld], zeile[feld])) ergebnisAbsicht[feld] = absicht[feld];
    }
    const willErgebnis = (!!doc.forfeit_teilnehmer_id && !['beendet', 'freilos'].includes(zeile.status))
        || ['beendet', 'freilos'].includes(ergebnisAbsicht.status)
        || 'sieger_id' in ergebnisAbsicht;
    const paarungGleich = gleicheWerte(doc.kaempfer1_id, zeile.kaempfer1_id) && gleicheWerte(doc.kaempfer2_id, zeile.kaempfer2_id);
    if (willErgebnis && !paarungGleich && !['beendet', 'freilos'].includes(zeile.status)) {
        throw new PaarungWeichtAb(`Paarung von ${doc._id} weicht vom Server-Stand ab`);
    }

    if (doc.forfeit_teilnehmer_id && !['beendet', 'freilos'].includes(zeile.status)) {
        const art = doc.forfeit_art === 'disqualifiziert' ? 'disqualifiziert' : 'nicht_angetreten';
        await werteForfeit(knex, Number(doc.forfeit_teilnehmer_id), id, art, HALLEN_KONTEXT);
    } else if (ergebnisAbsicht.status === 'bereit' && zeile.status === 'beendet') {
        // Gerät hat einen beendeten Kampf zurückgesetzt: der Server setzt Folgekämpfe und
        // Reihenfolge selbst (src/shared/korrekturRegel.js), die Felder des Geräts werden ignoriert.
        await setzeKampfZurueck(knex, id);
    } else if (Object.keys(ergebnisAbsicht).length) {
        await aktualisiereKampf(knex, id, ergebnisAbsicht);
    }
    // Reihenfolge nur, wenn das Gerät sie selbst geändert hat (Tausch am Scoreboard).
    if ('matten_reihenfolge' in absicht) {
        const aktuell = await knex('kaempfe').where({ id }).first();
        if (!gleicheWerte(absicht.matten_reihenfolge, aktuell.matten_reihenfolge)) {
            await setzeMattenReihenfolge(knex, id, absicht.matten_reihenfolge);
        }
    }
}

async function wendeKampfflaecheAn(knex, doc, basis) {
    const id = doc.sql_id;
    const zeile = await knex('kampfflaechen').where({ id }).first();
    if (!zeile) return;
    const absicht = absichtGegenueber(doc, basis, zeile, ['status']);
    if (!('status' in absicht)) return;
    if (absicht.status === 'pausiert' && zeile.status !== 'pausiert') await pausiereMatte(knex, id);
    else if (absicht.status !== 'pausiert' && zeile.status === 'pausiert') await setzeMatteFort(knex, id);
}

async function wendeTeilnehmerAn(knex, db, doc, basis, legeKonfliktAn) {
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
        const absicht = absichtGegenueber(doc, basis, zeile, TEILNEHMER_WAAGE_FELDER);
        const neu = {};
        for (const [feld, wert] of Object.entries(absicht)) if (!gleicheWerte(wert, zeile[feld])) neu[feld] = wert;
        if (Object.keys(neu).length) await aktualisiereTeilnehmerDaten(knex, id, neu, HALLEN_KONTEXT);
    }
    const nachher = await knex('turnier_teilnehmer').where({ id }).first();
    const wollteKampfbereit = doc.status === 'kampfbereit' && (!basis || basis.status !== 'kampfbereit');
    if (wollteKampfbereit && ['angemeldet', 'nicht_erschienen'].includes(nachher.status)) {
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
        // Nur Server-Revisionen (zwei Master nach einer Netztrennung): die höhere Epoche gewinnt.
        if (!geraete.length) {
            for (const v of kandidaten) if ((v.epoche || 0) > (gewinner.epoche || 0)) gewinner = v;
        }
        if (doc._id.startsWith('teilnehmer:')) {
            for (const v of kandidaten) {
                if (String(v.gewogen_am || '') > String(gewinner.gewogen_am || '')) gewinner = v;
            }
        }
        const verlierer = versionen.filter(v => v._rev !== doc._rev);
        await db.bulkDocs(verlierer.map(v => ({ _id: v._id, _rev: v._rev, _deleted: true })));
        if (gewinner._rev !== doc._rev) {
            // Nur die ABSICHT des Gewinners (seine Änderungen gegenüber seiner Server-Basis) auf die
            // aktuelle Version übertragen — sein übriger, evtl. veralteter Inhalt würde sonst neuere
            // Server-Änderungen zurückdrehen.
            const basis = await ladeServerBasis(db, gewinner);
            const felder = [...new Set([...Object.keys(gewinner), ...Object.keys(basis || {})])].filter(f => !META_FELDER.has(f));
            const absicht = basis ? geaenderteFelder(gewinner, basis, felder) : Object.fromEntries(felder.map(f => [f, gewinner[f]]));
            const { _conflicts, ...aktuell } = doc;
            await db.put({ ...aktuell, ...absicht, bearbeitet_von: gewinner.bearbeitet_von, _rev: doc._rev });
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
            const basis = await ladeServerBasis(db, doc);
            if (typ === 'kampf') await wendeKampfAn(knex, doc, basis);
            else if (typ === 'kampfflaeche') await wendeKampfflaecheAn(knex, doc, basis);
            else await wendeTeilnehmerAn(knex, db, doc, basis, (t, d, g) => legeKonfliktAnIn(db, t, d, g));
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

    // Entscheidung der Turnierleitung bei einem Klärungsfall (Kampf mit abweichender Paarung):
    //  'server' — Server-Paarung behalten, das Geräte-Ergebnis verwerfen; der Kampf erhält seinen
    //             Status von vor der Klärung zurück und wird regulär ausgetragen.
    //  'geraet' — Paarung und Ergebnis des Geräts übernehmen; der Kampf wird mit dieser Paarung
    //             beendet, die Kaskade zieht Folgekämpfe nach. Die Vorkämpfe, aus denen der Server die
    //             Paarung ableitet, bleiben unverändert.
    async function entscheideKlaerung(id, entscheidung) {
        const db = zustand.db;
        if (!['server', 'geraet'].includes(entscheidung)) throw new FachFehler(400, 'Ungültige Entscheidung.');
        const konflikt = await db.get(id).catch(() => null);
        if (!konflikt || konflikt.dokumenttyp !== 'konflikt') throw new FachFehler(404, 'Konflikt nicht gefunden.');
        if (konflikt.konflikt_typ !== 'klaerung') throw new FachFehler(400, 'Nur Klärungsfälle können entschieden werden.');
        if (konflikt.erledigt) throw new FachFehler(409, 'Der Konflikt ist bereits erledigt.');

        const lokal = konflikt.version_lokal || {};
        const kampfId = lokal.sql_id;
        const zeile = kampfId != null ? await knex('kaempfe').where({ id: kampfId }).first() : null;
        if (!zeile) throw new FachFehler(404, 'Der Kampf existiert nicht mehr.');
        if (zeile.status !== 'klaerung') {
            throw new FachFehler(409, `Der Kampf steht nicht mehr auf "Klärung" (Status: ${zeile.status}). Bitte den Konflikt nur als erledigt markieren.`);
        }

        if (entscheidung === 'server') {
            const vorher = konflikt.version_server && konflikt.version_server.status;
            const status = vorher && !['klaerung', 'beendet', 'freilos'].includes(vorher) ? vorher : 'bereit';
            await knex('kaempfe').where({ id: kampfId }).update({ status, updated_at: knex.fn.now() });
        } else {
            const { kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger } = lokal;
            if (lokal.status !== 'beendet' || !sieger || !k1 || !k2 || k1 === k2 || (sieger !== k1 && sieger !== k2)) {
                throw new FachFehler(400, 'Das Geräte-Ergebnis ist unvollständig und kann nicht übernommen werden.');
            }
            const kaempfer = await knex('turnier_teilnehmer').whereIn('id', [k1, k2]);
            if (kaempfer.length !== 2 || kaempfer.some(t => t.pool_id !== zeile.pool_id)) {
                throw new FachFehler(409, 'Mindestens ein Kämpfer des Geräts gehört nicht (mehr) zu diesem Pool.');
            }
            await knex.transaction(async (trx) => {
                // Zuerst auf einen regulären Status, damit die Ergebnisprüfung den Kampf wie einen
                // gewöhnlichen, noch offenen behandelt.
                await trx('kaempfe').where({ id: kampfId }).update({ status: 'bereit', updated_at: trx.fn.now() });
                await aktualisiereKampf(trx, kampfId, {
                    kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger, status: 'beendet',
                    unterbewertung_kaempfer1: lokal.unterbewertung_kaempfer1 ?? 0,
                    unterbewertung_kaempfer2: lokal.unterbewertung_kaempfer2 ?? 0,
                    ...(lokal.kampfzeit_in_sekunden != null ? { kampfzeit_in_sekunden: lokal.kampfzeit_in_sekunden } : {})
                });
            });
        }
        await db.put({ ...konflikt, erledigt: true, erledigt_am: new Date().toISOString(), entscheidung });
        await abgleich.fuehreAus();
    }

    return { starte, stoppe, leerlauf, neuStarten, listeKonflikte, erledigeKonflikt, wiederholeKonflikt, entscheideKlaerung };
}
