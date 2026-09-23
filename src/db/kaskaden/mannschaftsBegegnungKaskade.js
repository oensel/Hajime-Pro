// CouchDB-Pendant zum Kernteil von src/services/mannschaftsBegegnungEngine.js -- dort direkt
// knex-gebunden, hier über die jeweiligen Repositories. ermittleErsatzKandidaten/wechsleKaempfer
// (manuelle Nachnominierung) sind bewusst NICHT Teil dieser Kaskade -- eigenständiges,
// manuelles Override-Feature, keine automatische Fortschritts-Logik.

function parseGewichtsklassen(pool) {
    if (!pool.mannschafts_gewichtsklassen) return [];
    try {
        const parsed = JSON.parse(pool.mannschafts_gewichtsklassen);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function gruppiereByGewichtsklasse(mitglieder) {
    const map = new Map();
    for (const m of mitglieder) {
        if (!map.has(m.gewichtsklasse)) map.set(m.gewichtsklasse, []);
        map.get(m.gewichtsklasse).push(m);
    }
    return map;
}

function waehleStarter(mitgliederByGewichtsklasse, gewichtsklasse) {
    const kandidaten = mitgliederByGewichtsklasse.get(gewichtsklasse);
    return kandidaten && kandidaten.length > 0 ? kandidaten[0] : null;
}

export async function erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool) {
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const bestehende = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    if (bestehende.length > 0) return;

    const gewichtsklassen = parseGewichtsklassen(pool);
    const [mitglieder1, mitglieder2] = await Promise.all([
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft1_id),
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft2_id)
    ]);
    const byGewichtsklasse1 = gruppiereByGewichtsklasse(mitglieder1);
    const byGewichtsklasse2 = gruppiereByGewichtsklasse(mitglieder2);

    let erzeugt = 0;
    for (const klasse of gewichtsklassen) {
        const starter1 = waehleStarter(byGewichtsklasse1, klasse);
        const starter2 = waehleStarter(byGewichtsklasse2, klasse);
        if (!starter1 || !starter2) continue;

        await kaempfeRepository.create({
            pool_id: pool._id,
            mannschaftskampf_id: begegnung._id,
            mannschaft_gewichtsklasse: klasse,
            status: 'bereit',
            kaempfer1_id: starter1.turnier_teilnehmer_id,
            kaempfer2_id: starter2.turnier_teilnehmer_id,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        });
        erzeugt++;
    }

    if (erzeugt === 0) {
        await mannschaftskaempfeRepository.update(begegnung._id, { status: 'beendet', sieger_mannschaft_id: null });
    }
}
