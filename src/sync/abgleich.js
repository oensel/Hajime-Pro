// Abgleich relationale DB -> Dokument-DB: schreibt den Ist-Stand aller Live-Tabellen des
// aktuellen Turniers als Dokumente (bearbeitet_von: 'server'). Vergleicht bewusst IMMER das ganze
// Turnier (wenige hundert Zeilen) statt einzelner geänderter IDs: die Schreibpfade sind über
// Controller und Manager verteilt, ein Vollvergleich kann keinen davon übersehen.
//
// Nicht angefasst werden Dokumente mit einer Änderung von Matte/Waage, die die Brücke noch nicht
// verarbeitet hat (sonst würde der Abgleich sie überschreiben, bevor sie in SQL angekommen ist).
import { createHash } from 'crypto';
import { LIVE_PRAEFIXE, dokumentIdFuer, mitServerStand, unterscheidetSichVomServerStand } from '../shared/dokumentAbbildung.js';

async function ladeLiveZeilen(knex, turnierId) {
    const pools = await knex('pools').where({ turnier_id: turnierId });
    const poolIds = pools.map(p => p.id);
    return {
        kampfflaechen: await knex('kampfflaechen').where({ turnier_id: turnierId }),
        pools,
        turnier_teilnehmer: await knex('turnier_teilnehmer').where({ turnier_id: turnierId }),
        kaempfe: poolIds.length ? await knex('kaempfe').whereIn('pool_id', poolIds) : [],
        mannschaften: await knex('mannschaften').where({ turnier_id: turnierId }),
        mannschaftskaempfe: poolIds.length ? await knex('mannschaftskaempfe').whereIn('pool_id', poolIds) : []
    };
}

// Turnier-Basisdaten + Hash des Steuerungs-Passworts, damit ein Client das Scoreboard auch offline
// entsperren kann (Plan B).
function baueKonfigDokument(turnier, bestehend) {
    const passwort = process.env.STEUERUNG_PASSWORD || '';
    const soll = {
        _id: 'konfig:steuerung',
        dokumenttyp: 'konfig',
        turnier_id: turnier.id,
        bezeichnung: turnier.bezeichnung,
        datum: turnier.datum instanceof Date ? turnier.datum.toISOString().slice(0, 10) : turnier.datum,
        instanz_id: turnier.instanz_id,
        steuerung_passwort_sha256: passwort ? createHash('sha256').update(passwort).digest('hex') : null,
        bearbeitet_von: 'server'
    };
    if (bestehend) {
        const gleich = Object.keys(soll).every(k => JSON.stringify(bestehend[k]) === JSON.stringify(soll[k]));
        if (gleich) return null;
        soll._rev = bestehend._rev;
    }
    return soll;
}

export function erzeugeAbgleich({ knex, zustand }) {
    let kette = Promise.resolve();
    let geplant = null;

    async function intern() {
        const { db, turnierId } = zustand;
        if (!db || !turnierId) return;

        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) return;
        const zeilen = await ladeLiveZeilen(knex, turnierId);
        const alle = await db.allDocs({ include_docs: true });
        const docs = new Map(alle.rows.filter(r => !r.id.startsWith('_design/')).map(r => [r.id, r.doc]));
        const angewendet = new Set((await knex('sync_angewendet').select('doc_id', 'rev')).map(z => `${z.doc_id}@${z.rev}`));

        const schreiben = [];
        const gesehen = new Set();
        for (const [tabelle, liste] of Object.entries(zeilen)) {
            for (const zeile of liste) {
                const id = dokumentIdFuer(tabelle, zeile);
                gesehen.add(id);
                const doc = docs.get(id);
                if (doc && doc.bearbeitet_von !== 'server' && !angewendet.has(`${id}@${doc._rev}`)) continue;
                if (!unterscheidetSichVomServerStand(doc, tabelle, zeile)) continue;
                schreiben.push(mitServerStand(doc, tabelle, zeile));
            }
        }

        // Dokumente, deren Zeile es nicht mehr gibt, löschen — außer noch nicht übernommene
        // Nachmeldungen (sql_id null) und als Dublette verknüpfte Nachmeldungen.
        for (const [id, doc] of docs) {
            if (gesehen.has(id) || !LIVE_PRAEFIXE.some(p => id.startsWith(p))) continue;
            if (doc.dublette_von) continue;
            if (doc.bearbeitet_von !== 'server' && doc.sql_id == null) continue;
            schreiben.push({ _id: id, _rev: doc._rev, _deleted: true });
        }

        const konfig = baueKonfigDokument(turnier, docs.get('konfig:steuerung'));
        if (konfig) schreiben.push(konfig);

        // Konflikte (409) entstehen, wenn eine Matte das Dokument gleichzeitig ändert — dann
        // verarbeitet die Brücke deren Änderung und stößt danach einen neuen Abgleich an.
        if (schreiben.length) await db.bulkDocs(schreiben);
    }

    function fuehreAus() {
        kette = kette.then(intern).catch(err => console.error('[Sync] Abgleich fehlgeschlagen:', err));
        return kette;
    }

    // Entprellt: viele schreibende Requests kurz hintereinander lösen nur einen Abgleich aus.
    function plane() {
        if (geplant) return;
        geplant = setTimeout(() => {
            geplant = null;
            fuehreAus();
        }, 100);
    }

    async function leerlauf() {
        while (geplant) await new Promise(r => setTimeout(r, 20));
        await kette;
    }

    return { fuehreAus, plane, leerlauf };
}
