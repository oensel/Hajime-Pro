// Brücke Dokument-DB -> relationale DB (nur Hallen-Server). Liest den _changes-Feed und wendet
// jede Änderung, die NICHT vom Server selbst stammt (bearbeitet_von !== 'server'), über die
// bestehende Fachlogik an. Was angewendet werden soll, ergibt sich aus dem Feld-Vergleich mit der
// SQL-Zeile — dadurch ist erneutes Anwenden wirkungslos (idempotent), auch nach einem Neustart.
//
// Lehnt die Fachlogik ab (FachFehler) oder scheitert sie technisch, bekommt das Dokument den
// Server-Stand zurück plus letzte_ablehnung (Rückmeldung an Matte/Waage), und ein
// konflikt:-Dokument hält beide Versionen für die Turnierleitung fest (Spec Abschnitt 10).
import { randomUUID } from 'crypto';
import { geaenderteFelder, mitServerStand } from '../shared/dokumentAbbildung.js';
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

    async function legeKonfliktAnIn(db, konfliktTyp, doc, grund) {
        await db.put({
            _id: `konflikt:${randomUUID()}`, dokumenttyp: 'konflikt', konflikt_typ: konfliktTyp, prioritaet: 'normal',
            bezug_id: doc._id, grund, version_lokal: doc, erstellt_am: new Date().toISOString(), erledigt: false,
            bearbeitet_von: 'server'
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

    async function verarbeite(db, doc) {
        if (!doc || doc._deleted || doc.bearbeitet_von === 'server') return;
        const typ = doc._id.split(':')[0];
        const tabelle = TABELLE_ZU_TYP[typ];
        if (!tabelle) return;

        const schonAngewendet = await knex('sync_angewendet').where({ doc_id: doc._id, rev: doc._rev }).first();
        if (schonAngewendet) return;

        try {
            if (typ === 'kampf') await wendeKampfAn(knex, doc);
            else if (typ === 'kampfflaeche') await wendeKampfflaecheAn(knex, doc);
            else await wendeTeilnehmerAn(knex, db, doc, (t, d, g) => legeKonfliktAnIn(db, t, d, g));
        } catch (fehler) {
            await lehneAb(db, doc, tabelle, fehler);
        }
        await knex('sync_angewendet').insert({ doc_id: doc._id, rev: doc._rev }).onConflict(['doc_id', 'rev']).ignore();
        await abgleich.fuehreAus();
    }

    function starte() {
        const db = zustand.db;
        if (!db || feed) return;
        feed = db.changes({ since: 0, live: true, include_docs: true });
        feed.on('change', (change) => {
            kette = kette.then(() => verarbeite(db, change.doc)).catch(err => console.error('[Brücke] Fehler:', err));
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
            await abgleich.leerlauf();
        }
    }

    async function neuStarten() {
        await stoppe();
        starte();
    }

    return { starte, stoppe, leerlauf, neuStarten };
}
