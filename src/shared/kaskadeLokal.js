// Offline-Kaskade eines Client-Geräts (Spec CouchDB-Umbau, Abschnitt 7): Sobald an diesem Gerät
// ein Kampf beendet wird, befüllt sie die Folgekämpfe des Pools selbst (src/shared/
// kaskadeDokumente.js) — die Matte läuft auch ohne Hallen-Server weiter. Nur für Einzel-Pools der
// gewählten Matte (Mannschafts-Pools: Stufe 2). Die Schreibvorgänge tragen
// bearbeitet_von: 'kaskade:<clientId>'; der Server wendet sie nicht an, sondern rechnet selbst nach
// und überschreibt sie mit seinem maßgeblichen Stand.
import { berechneKaskadenPatches } from './kaskadeDokumente.js';

export function erzeugeKaskadeLokal({ client }) {
    const absender = `kaskade:${client.clientKonfig.clientId}`;
    let feed = null;
    let kette = Promise.resolve();

    async function rechne(db, poolId) {
        const matteId = await client.clientKonfig.matteId();
        const alle = await db.allDocs({ include_docs: true });
        const docs = alle.rows.map(r => r.doc).filter(Boolean);
        const pool = docs.find(d => d.dokumenttyp === 'pool' && Number(d.id) === Number(poolId));
        if (!pool || pool.typ === 'mannschaft') return;
        if (!matteId || Number(pool.kampfflaeche_id) !== Number(matteId)) return;

        const kaempfe = docs.filter(d => d.dokumenttyp === 'kampf' && Number(d.pool_id) === Number(poolId));
        const patches = berechneKaskadenPatches(kaempfe);
        if (patches.size === 0) return;
        const schreiben = kaempfe
            .filter(k => patches.has(k.id))
            .map(k => ({ ...k, ...patches.get(k.id), bearbeitet_von: absender }));
        const ergebnis = await db.bulkDocs(schreiben);
        // 409: Dokument wurde parallel geändert (z.B. Server-Stand kam an) — dann gilt ohnehin
        // der neuere Stand; beim nächsten eigenen Ergebnis wird erneut gerechnet.
        const fehler = ergebnis.filter(r => r.error && r.status !== 409);
        if (fehler.length) console.error('[Kaskade lokal] Schreiben fehlgeschlagen:', fehler);
    }

    function beobachte(db) {
        if (feed) feed.cancel();
        feed = db.changes({ since: 'now', live: true, include_docs: true });
        feed.on('change', (change) => {
            const doc = change.doc;
            if (!doc || doc.dokumenttyp !== 'kampf') return;
            if (doc.bearbeitet_von !== 'browser' || doc.geschrieben_von_knoten !== client.clientKonfig.clientId) return;
            if (!['beendet', 'freilos'].includes(doc.status)) return;
            kette = kette.then(() => rechne(db, doc.pool_id)).catch(err => console.error('[Kaskade lokal] Fehler:', err));
        });
        feed.on('error', err => console.error('[Kaskade lokal] Feed-Fehler:', err));
    }

    client.beiNeuerDb(async (db) => beobachte(db));

    return {
        async leerlauf() {
            await new Promise(r => setTimeout(r, 150));
            await kette;
        }
    };
}
