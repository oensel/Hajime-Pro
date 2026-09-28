// Einheitlicher Datenzugriff für Waage, Scoreboard und Mattenleitung (CouchDB-Umbau, siehe
// docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md). Zwei Backends mit identischer
// Schnittstelle:
//  - 'rest': heutiges Verhalten (Cloud, Betrieb ohne Sync) — exakt die bisherigen fetch-Aufrufe.
//  - 'dokumente': der Knoten hat eine Dokument-DB (/api/sync/status liefert db_name). Schreib-
//    vorgänge ändern Dokumente; die Brücke des Servers (src/sync/bruecke.js) wendet sie über die
//    Fachlogik an. Solange der Server erreichbar ist, wartet jede Aktion auf dessen Bestätigung
//    (bearbeitet_von: 'server') und liefert eine Ablehnung (letzte_ablehnung) als Fehler zurück.
//
// Klassisches Skript (kein ES-Modul), damit es auch von klassischen Skripten (kampf.js,
// teilnehmer.js) genutzt werden kann. Setzt window.PouchDB voraus (/js/pouchdb/pouchdb.min.js).
(function () {
    const WARTE_MS = 5000;
    let modus = null;
    let db = null;
    let baueMattenAnsicht = null;
    let bereit = null;
    let knoten = { rolle: null, client_id: null };

    function init() {
        if (!bereit) {
            bereit = (async () => {
                try {
                    const resp = await fetch('/api/sync/status');
                    const status = resp.ok ? await resp.json() : null;
                    if (status && status.db_name && window.PouchDB) {
                        knoten = status;
                        db = new window.PouchDB(`${window.location.origin}/db/${status.db_name}`, { skip_setup: true });
                        ({ baueMattenAnsicht } = await import('/js/shared/mattenAnsicht.js'));
                        modus = 'dokumente';
                        return modus;
                    }
                } catch (err) {
                    console.warn('[Datenzugriff] Sync-Status nicht lesbar, nutze REST:', err);
                }
                modus = 'rest';
                return modus;
            })();
        }
        return bereit;
    }

    // ---------- Hilfen Dokument-Backend ----------

    async function alleDokumente() {
        const res = await db.allDocs({ include_docs: true });
        return res.rows.map(r => r.doc).filter(d => d && !d._id.startsWith('_design/'));
    }

    function revNummer(rev) {
        return parseInt(String(rev).split('-')[0], 10) || 0;
    }

    const LOKAL_GESPEICHERT = { ok: true, ausstehend: true, meldung: 'Lokal gespeichert, Server-Bestätigung steht noch aus.' };

    // Client-Gerät ohne Verbindung zum Hallen-Server? Dann gar nicht erst auf dessen Bestätigung
    // warten — die Replikation überträgt die Änderung später automatisch.
    async function istOfflineClient() {
        if (knoten.rolle !== 'client') return false;
        try {
            const status = await fetch('/api/sync/status', { cache: 'no-store' }).then(r => r.json());
            knoten = { ...knoten, ...status };
            return !status.verbunden;
        } catch (err) {
            return true;
        }
    }

    // Serverzeit (Client-Uhr + beim Verbinden ermittelter Offset) — Grundlage für "letzte Wiegung
    // gewinnt" bei Konflikten zwischen zwei Waagen.
    function jetztIso() {
        return new Date(Date.now() + (knoten.uhr_offset_ms || 0)).toISOString();
    }

    // Wartet, bis der Server die eigene Revision verarbeitet hat (bearbeitet_von: 'server' mit
    // höherer Revision). Nach WARTE_MS gilt die Änderung als lokal gespeichert, aber unbestätigt.
    async function warteAufServer(docId, eigeneRev) {
        if (await istOfflineClient()) return LOKAL_GESPEICHERT;
        const ende = Date.now() + WARTE_MS;
        while (Date.now() < ende) {
            await new Promise(r => setTimeout(r, 150));
            let doc;
            try {
                doc = await db.get(docId);
            } catch (err) {
                if (err.status === 404) return { ok: false, fehler: 'Datensatz wurde auf dem Server entfernt.' };
                continue;
            }
            if (doc.bearbeitet_von === 'server' && revNummer(doc._rev) > revNummer(eigeneRev)) {
                if (doc.letzte_ablehnung && doc.letzte_ablehnung.rev === eigeneRev) {
                    return { ok: false, fehler: doc.letzte_ablehnung.grund, doc };
                }
                return { ok: true, doc };
            }
        }
        return LOKAL_GESPEICHERT;
    }

    // Kennzeichnet Schreibvorgänge dieses Geräts (Client: zählt als "ausstehend", bis übertragen;
    // kaskadeLokal rechnet nur nach eigenen Ergebnissen).
    function absender() {
        return { bearbeitet_von: 'browser', ...(knoten.client_id ? { geschrieben_von_knoten: knoten.client_id } : {}) };
    }

    // Liest das Dokument, wendet aendere(doc) an und schreibt es. Schreibt der Server (Abgleich,
    // Brücke) zwischen Lesen und Schreiben, lehnt die DB mit 409 ab — dann neu lesen und die
    // Änderung erneut anwenden. aendere darf ein Fehlerobjekt zurückgeben, um abzubrechen.
    async function schreibeMitWiederholung(docId, aendere) {
        for (let versuch = 1; ; versuch++) {
            const doc = await db.get(docId);
            const abbruch = aendere(doc);
            if (abbruch) return { abbruch };
            Object.assign(doc, absender());
            try {
                const { rev } = await db.put(doc);
                return { rev, doc };
            } catch (err) {
                if (err.status !== 409 || versuch >= 8) throw err;
                await new Promise(r => setTimeout(r, 50 * versuch));
            }
        }
    }

    async function aendereDokument(docId, aenderung) {
        const { rev } = await schreibeMitWiederholung(docId, (doc) => { Object.assign(doc, aenderung); });
        return warteAufServer(docId, rev);
    }

    function ohneDoc(ergebnis) {
        const { doc, ...rest } = ergebnis;
        return rest;
    }

    async function teilnehmerDokumentZuId(teilnehmerId) {
        const docs = await alleDokumente();
        return docs.find(d => d.dokumenttyp === 'teilnehmer' && Number(d.id) === Number(teilnehmerId));
    }

    async function restJson(url, optionen) {
        const resp = await fetch(url, optionen);
        const daten = await resp.json().catch(() => ({}));
        return { ok: resp.ok && daten.success !== false, fehler: resp.ok ? undefined : (daten.error || `Fehler ${resp.status}`), daten };
    }

    const JSON_HEADER = { 'Content-Type': 'application/json' };

    // ---------- öffentliche Schnittstelle ----------

    async function ladeKampfflaechen(turnierId) {
        await init();
        if (modus === 'rest') {
            const resp = await fetch(`/api/kampfflaechen?turnierId=${turnierId}`);
            const daten = await resp.json();
            if (!resp.ok) throw new Error(daten.error || 'Fehler beim Laden der Kampfflächen.');
            return daten;
        }
        return (await alleDokumente())
            .filter(d => d.dokumenttyp === 'kampfflaeche' && Number(d.turnier_id) === Number(turnierId))
            .sort((a, b) => a.id - b.id);
    }

    async function ladeKaempfeDerMatte(matId) {
        await init();
        if (modus === 'rest') {
            const resp = await fetch(`/api/kaempfe?kampfflaecheId=${matId}`);
            const daten = await resp.json();
            if (!resp.ok) throw new Error(daten.error || 'Fehler beim Laden der Kämpfe.');
            return daten;
        }
        const docs = await alleDokumente();
        const vomTyp = (typ) => docs.filter(d => d.dokumenttyp === typ);
        return baueMattenAnsicht({
            kaempfe: vomTyp('kampf'), pools: vomTyp('pool'), teilnehmer: vomTyp('teilnehmer'),
            mannschaftskaempfe: vomTyp('mannschaftskampf'), mannschaften: vomTyp('mannschaft')
        }, matId, Date.now());
    }

    async function aktualisiereKampf(kampfId, felder) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kaempfe/${kampfId}`, { method: 'PUT', headers: JSON_HEADER, body: JSON.stringify(felder) });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler };
        }
        return ohneDoc(await aendereDokument(`kampf:${kampfId}`, felder));
    }

    async function tauscheReihenfolge(kampf1Id, kampf2Id, turnierId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson('/api/kaempfe/reihenfolge-tauschen', {
                method: 'PUT', headers: JSON_HEADER, body: JSON.stringify({ turnierId, kampf1Id, kampf2Id })
            });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Tausch fehlgeschlagen.' };
        }
        const a = await db.get(`kampf:${kampf1Id}`);
        const b = await db.get(`kampf:${kampf2Id}`);
        if (a.status !== 'bereit' || b.status !== 'bereit') {
            return { ok: false, fehler: 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") getauscht werden.' };
        }
        const ziel = { [a._id]: b.matten_reihenfolge, [b._id]: a.matten_reihenfolge };
        a.matten_reihenfolge = ziel[a._id];
        b.matten_reihenfolge = ziel[b._id];
        Object.assign(a, absender());
        Object.assign(b, absender());
        const ergebnisse = await db.bulkDocs([a, b]);
        // Revisionskonflikt (Server hat parallel geschrieben): das betroffene Dokument einzeln neu
        // lesen und die Zielreihenfolge erneut setzen.
        const revs = [];
        for (const [i, res] of ergebnisse.entries()) {
            const docId = [a._id, b._id][i];
            if (!res.error) { revs.push(res.rev); continue; }
            if (res.status !== 409) return { ok: false, fehler: 'Tausch fehlgeschlagen, bitte erneut versuchen.' };
            const { rev } = await schreibeMitWiederholung(docId, (doc) => { doc.matten_reihenfolge = ziel[docId]; });
            revs.push(rev);
        }
        const e1 = await warteAufServer(a._id, revs[0]);
        const e2 = await warteAufServer(b._id, revs[1]);
        if (!e1.ok) return ohneDoc(e1);
        return ohneDoc(e2);
    }

    async function setzeLiveFarbe(kampfId, farbe) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kaempfe/${kampfId}/color`, { method: 'PUT', headers: JSON_HEADER, body: JSON.stringify({ color: farbe }) });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler };
        }
        await schreibeMitWiederholung(`kampf:${kampfId}`, (doc) => { doc.live_farbe = farbe; });
        return { ok: true };
    }

    async function pausiereMatte(matId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kampfflaechen/${matId}/pausieren`, { method: 'POST' });
            return r.ok ? { ok: true, meldung: r.daten.message } : { ok: false, fehler: r.fehler || 'Matte konnte nicht pausiert werden.' };
        }
        const ergebnis = ohneDoc(await aendereDokument(`kampfflaeche:${matId}`, { status: 'pausiert' }));
        return ergebnis.ok ? { ...ergebnis, meldung: ergebnis.meldung || 'Matte pausiert.' } : ergebnis;
    }

    // aktion wie die REST-Pfade: 'nicht-angetreten' | 'disqualifizieren'.
    async function werteForfeit(teilnehmerId, kampfId, aktion) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/teilnehmer/${teilnehmerId}/${aktion}`, {
                method: 'POST', headers: JSON_HEADER, body: JSON.stringify({ kampf_id: kampfId })
            });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Aktion fehlgeschlagen.' };
        }
        // Ergebnis gleich mit ins Dokument schreiben (wie loeseKampfAlsForfeitAuf am Server: 10 Punkte
        // für den Gegner) — damit Anzeige und Offline-Kaskade des Client-Geräts es sofort sehen.
        // Maßgeblich bleibt die Server-Wertung über forfeit_teilnehmer_id/forfeit_art.
        const kampf = await db.get(`kampf:${kampfId}`);
        const istKaempfer1 = Number(kampf.kaempfer1_id) === Number(teilnehmerId);
        const gegnerId = istKaempfer1 ? kampf.kaempfer2_id : kampf.kaempfer1_id;
        return ohneDoc(await aendereDokument(`kampf:${kampfId}`, {
            forfeit_teilnehmer_id: Number(teilnehmerId),
            forfeit_art: aktion === 'disqualifizieren' ? 'disqualifiziert' : 'nicht_angetreten',
            status: 'beendet',
            sieger_id: gegnerId,
            unterbewertung_kaempfer1: istKaempfer1 ? 0 : 10,
            unterbewertung_kaempfer2: istKaempfer1 ? 10 : 0
        }));
    }

    async function speichereTeilnehmer(id, payload) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(id ? `/api/teilnehmer/${id}` : '/api/teilnehmer', {
                method: id ? 'PUT' : 'POST', headers: JSON_HEADER, body: JSON.stringify(payload)
            });
            return r.ok ? { ok: true, teilnehmerId: id || r.daten.teilnehmerId } : { ok: false, fehler: r.fehler || 'Fehler beim Speichern' };
        }
        const jetzt = jetztIso();
        if (id) {
            const doc = await teilnehmerDokumentZuId(id);
            if (!doc) return { ok: false, fehler: 'Teilnehmer nicht gefunden.' };
            const ergebnis = await aendereDokument(doc._id, { ...payload, ...(payload.gewogen ? { gewogen_am: jetzt } : {}) });
            return { ...ohneDoc(ergebnis), teilnehmerId: Number(id) };
        }
        // Nachmeldung: Dokument mit Client-UUID, die Brücke legt die SQL-Zeile an (sql_id).
        const neu = {
            _id: `teilnehmer:u-${crypto.randomUUID()}`, dokumenttyp: 'teilnehmer', sql_id: null, ...absender(),
            ...payload, turnier_id: parseInt(payload.turnier_id, 10), ...(payload.gewogen ? { gewogen_am: jetzt } : {})
        };
        const { rev } = await db.put(neu);
        const ergebnis = await warteAufServer(neu._id, rev);
        // Offline noch ohne SQL-ID: die UUID-Kennung des Dokuments dient bis zum Sync als Bezug.
        return { ...ohneDoc(ergebnis), teilnehmerId: ergebnis.doc ? ergebnis.doc.sql_id : null, dokumentId: neu._id };
    }

    async function bestaetigeKampfbereit(teilnehmerId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/teilnehmer/${teilnehmerId}/kampfbereit`, { method: 'POST' });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Fehler bei der Bestätigung.' };
        }
        const doc = await teilnehmerDokumentZuId(teilnehmerId);
        if (!doc) return { ok: false, fehler: 'Teilnehmer nicht gefunden.' };
        return ohneDoc(await aendereDokument(doc._id, { status: 'kampfbereit' }));
    }

    // Matte dieses Client-Geräts (null auf Server/Cloud oder wenn noch keine gewählt ist).
    async function clientMatte() {
        await init();
        if (knoten.rolle !== 'client') return null;
        const antwort = await fetch('/api/sync/client/matte').then(r => r.json()).catch(() => ({}));
        return antwort.matte_id || null;
    }

    window.Datenzugriff = {
        init,
        clientMatte,
        modus: () => modus,
        rolle: () => knoten.rolle,
        ladeKampfflaechen,
        ladeKaempfeDerMatte,
        aktualisiereKampf,
        tauscheReihenfolge,
        setzeLiveFarbe,
        pausiereMatte,
        werteForfeit,
        speichereTeilnehmer,
        bestaetigeKampfbereit
    };
})();
