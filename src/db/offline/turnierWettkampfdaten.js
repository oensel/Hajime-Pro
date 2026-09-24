import { normalisiereKampfStatus } from '../../shared/turnierRegeln.js';

// CouchDB-Äquivalent zu importWettkampfdaten (src/controllers/turnierController.js) für den
// Offline-Import (importTurnier): einfacher als das Original, da (a) eine Turnier-Datenbank
// per Konstruktion nur dieses eine Turnier enthält -- keine turnier_id-Filterung nötig --
// und (b) importTurnier immer ein brandneues, leeres Turnier anlegt, weshalb der
// Abgleich-mit-bestehender-Mannschaft-Zweig des Originals (nur für den online-only
// importTurnierErgebnisse-Reimport relevant) hier komplett entfällt: jede Mannschaft wird
// immer frisch angelegt.
export async function importiereWettkampfdaten(repos, daten) {
    const { kampfflaechenRepository, poolsRepository, turnierTeilnehmerRepository, kaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository } = repos;
    const { kampfflaechen = [], pools = [], teilnehmer = [], kaempfe = [], mannschaften = [], mannschaft_mitglieder: mannschaftMitglieder = [] } = daten;

    const kampfflaecheIdMap = new Map();
    for (const kf of kampfflaechen) {
        const neu = await kampfflaechenRepository.create({ bezeichnung: kf.bezeichnung, status: kf.status || 'frei' });
        kampfflaecheIdMap.set(kf.id, neu._id);
    }

    const poolIdMap = new Map();
    for (const p of pools) {
        const neu = await poolsRepository.create({
            kampfflaeche_id: p.kampfflaeche_id != null ? (kampfflaecheIdMap.get(p.kampfflaeche_id) ?? null) : null,
            bezeichnung: p.bezeichnung,
            modus: p.modus || 'Jeder-gegen-Jeden',
            altersklasse: p.altersklasse,
            geschlecht: p.geschlecht,
            gewichtsklasse: p.gewichtsklasse,
            kampfzeit_sekunden: p.kampfzeit_sekunden || 240,
            matte_reihenfolge: p.matte_reihenfolge ?? null,
            status: p.status || 'angelegt',
            typ: p.typ || 'einzel',
            mannschafts_gewichtsklassen: p.mannschafts_gewichtsklassen ?? null,
            golden_score_aktiv: p.golden_score_aktiv === undefined ? true : !!p.golden_score_aktiv,
            golden_score_max_sekunden: p.golden_score_max_sekunden ?? null
        });
        poolIdMap.set(p.id, neu._id);
    }

    const teilnehmerIdMap = new Map();
    for (const t of teilnehmer) {
        const neu = await turnierTeilnehmerRepository.create({
            pool_id: t.pool_id != null ? (poolIdMap.get(t.pool_id) ?? null) : null,
            judopass_id: t.judopass_id || '',
            vorname: t.vorname,
            nachname: t.nachname,
            geburtsjahr: t.geburtsjahr,
            lizenz_ablauf: t.lizenz_ablauf || '1970-01-01',
            geschlecht: t.geschlecht,
            verein: t.verein,
            gewicht: t.gewicht || 0,
            altersklasse: t.altersklasse,
            gewichtsklasse: t.gewichtsklasse,
            startgeld_bezahlt: !!t.startgeld_bezahlt,
            graduierung: t.graduierung || null,
            status: t.status || 'angemeldet',
            fuer_mannschaft: !!t.fuer_mannschaft
        });
        teilnehmerIdMap.set(t.id, neu._id);
    }

    // Erster Durchlauf ohne die selbstreferenzierenden Quelle-Felder (deren Zielkämpfe evtl.
    // noch gar nicht eingefügt sind), zweiter Durchlauf trägt sie nach -- analog zum
    // Original.
    const kampfIdMap = new Map();
    for (const k of kaempfe) {
        const neuerKaempfer1Id = k.kaempfer1_id != null ? (teilnehmerIdMap.get(k.kaempfer1_id) ?? null) : null;
        const neuerKaempfer2Id = k.kaempfer2_id != null ? (teilnehmerIdMap.get(k.kaempfer2_id) ?? null) : null;
        const neu = await kaempfeRepository.create({
            pool_id: poolIdMap.get(k.pool_id),
            kaempfer1_id: neuerKaempfer1Id,
            kaempfer2_id: neuerKaempfer2Id,
            sieger_id: k.sieger_id != null ? (teilnehmerIdMap.get(k.sieger_id) ?? null) : null,
            kampfzeit_in_sekunden: k.kampfzeit_in_sekunden || 0,
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1 || 0,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2 || 0,
            status: normalisiereKampfStatus(k.status, neuerKaempfer1Id, neuerKaempfer2Id),
            reihenfolge_nummer: k.reihenfolge_nummer ?? null,
            matten_reihenfolge: k.matten_reihenfolge ?? null,
            gruppe: k.gruppe ?? null
        });
        kampfIdMap.set(k.id, neu._id);
    }

    for (const k of kaempfe) {
        if (k.kaempfer1_quelle_kampf_id == null && k.kaempfer2_quelle_kampf_id == null) continue;
        await kaempfeRepository.update(kampfIdMap.get(k.id), {
            kaempfer1_quelle_kampf_id: k.kaempfer1_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer1_quelle_kampf_id) ?? null) : null,
            kaempfer1_quelle_typ: k.kaempfer1_quelle_typ ?? null,
            kaempfer2_quelle_kampf_id: k.kaempfer2_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer2_quelle_kampf_id) ?? null) : null,
            kaempfer2_quelle_typ: k.kaempfer2_quelle_typ ?? null
        });
    }

    const mannschaftIdMap = new Map();
    for (const m of mannschaften) {
        const neu = await mannschaftenRepository.create({
            pool_id: m.pool_id != null ? (poolIdMap.get(m.pool_id) ?? null) : null,
            verein: m.verein,
            bezeichnung: m.bezeichnung,
            status: m.status || 'angemeldet'
        });
        mannschaftIdMap.set(m.id, neu._id);
    }

    for (const mm of mannschaftMitglieder) {
        const neueMannschaftId = mannschaftIdMap.get(mm.mannschaft_id);
        const neueTeilnehmerId = mm.turnier_teilnehmer_id != null ? (teilnehmerIdMap.get(mm.turnier_teilnehmer_id) ?? null) : null;
        if (!neueMannschaftId || !neueTeilnehmerId) continue;
        await mannschaftMitgliederRepository.create({
            mannschaft_id: neueMannschaftId,
            turnier_teilnehmer_id: neueTeilnehmerId,
            gewichtsklasse: mm.gewichtsklasse
        });
    }

    return {
        kampfflaechen: kampfflaechen.length,
        pools: pools.length,
        teilnehmer: teilnehmer.length,
        kaempfe: kaempfe.length
    };
}

// CouchDB-Äquivalent zu den Export-Abfragen in exportTurnier (src/controllers/turnierController.js):
// deutlich einfacher, da eine Turnier-Datenbank per Konstruktion nur dieses eine Turnier
// enthält -- alle Repositories liefern direkt "alles" statt über eine turnier_id/pool_id-
// Kette filtern zu müssen. mannschaftenRepository/mannschaftMitgliederRepository haben kein
// eigenes findAll -- die generische query({}) (aus baseRepository.js) liefert hier
// gleichwertig "alle Dokumente dieses Typs".
export async function exportiereWettkampfdaten(repos) {
    const { kampfflaechenRepository, poolsRepository, turnierTeilnehmerRepository, kaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository } = repos;

    const kampfflaechen = await kampfflaechenRepository.findAll();
    const pools = await poolsRepository.findAll();
    const teilnehmer = await turnierTeilnehmerRepository.findAll();
    const kaempfe = await kaempfeRepository.findAll();
    const mannschaften = await mannschaftenRepository.query({});
    const mannschaftMitglieder = await mannschaftMitgliederRepository.query({});

    return { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder: mannschaftMitglieder };
}
