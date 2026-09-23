// CouchDB-Pendant zum Kernteil von src/services/mannschaftsBegegnungEngine.js -- dort direkt
// knex-gebunden, hier über die jeweiligen Repositories. ermittleErsatzKandidaten/wechsleKaempfer
// (manuelle Nachnominierung) sind bewusst NICHT Teil dieser Kaskade -- eigenständiges,
// manuelles Override-Feature, keine automatische Fortschritts-Logik.

import { wendeMannschaftsKaskadeAn } from './mannschaftsKaskade.js';

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

export async function werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnungId) {
    const begegnung = await mannschaftskaempfeRepository.findById(begegnungId);
    if (!begegnung || begegnung.status === 'beendet' || begegnung.status === 'freilos') return;
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnungId });
    if (kaempfe.length === 0) return;
    if (!kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')) return;

    let siege1 = 0, siege2 = 0, wert1 = 0, wert2 = 0;
    for (const k of kaempfe) {
        if (k.sieger_id && k.sieger_id === k.kaempfer1_id) siege1++;
        else if (k.sieger_id && k.sieger_id === k.kaempfer2_id) siege2++;
        wert1 += k.unterbewertung_kaempfer1 || 0;
        wert2 += k.unterbewertung_kaempfer2 || 0;
    }

    await mannschaftskaempfeRepository.update(begegnungId, {
        siegpunkte_mannschaft1: siege1,
        siegpunkte_mannschaft2: siege2,
        wertungspunkte_mannschaft1: wert1,
        wertungspunkte_mannschaft2: wert2
    });

    if (siege1 !== siege2) {
        await mannschaftskaempfeRepository.update(begegnungId, {
            status: 'beendet',
            sieger_mannschaft_id: siege1 > siege2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }
    if (wert1 !== wert2) {
        await mannschaftskaempfeRepository.update(begegnungId, {
            status: 'beendet',
            sieger_mannschaft_id: wert1 > wert2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }

    const kontestierteKlassen = [...new Set(kaempfe.map(k => k.mannschaft_gewichtsklasse).filter(Boolean))];
    if (kontestierteKlassen.length === 0) {
        await mannschaftskaempfeRepository.update(begegnungId, { status: 'beendet', sieger_mannschaft_id: null });
        return;
    }
    const gewaehlteKlasse = kontestierteKlassen[Math.floor(Math.random() * kontestierteKlassen.length)];

    const [mitglieder1, mitglieder2] = await Promise.all([
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft1_id),
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft2_id)
    ]);
    const starter1 = waehleStarter(gruppiereByGewichtsklasse(mitglieder1), gewaehlteKlasse);
    const starter2 = waehleStarter(gruppiereByGewichtsklasse(mitglieder2), gewaehlteKlasse);

    await mannschaftskaempfeRepository.update(begegnungId, { stichkampf_gewichtsklasse: gewaehlteKlasse });
    await kaempfeRepository.create({
        pool_id: begegnung.pool_id,
        mannschaftskampf_id: begegnungId,
        mannschaft_gewichtsklasse: gewaehlteKlasse,
        status: 'bereit',
        kaempfer1_id: starter1 ? starter1.turnier_teilnehmer_id : null,
        kaempfer2_id: starter2 ? starter2.turnier_teilnehmer_id : null,
        sieger_id: null,
        kampfzeit_in_sekunden: 0,
        unterbewertung_kaempfer1: 0,
        unterbewertung_kaempfer2: 0
    });
}

export async function aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId) {
    const pool = await poolsRepository.findById(poolId);
    if (!pool) return;

    let begegnungen = await wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId);
    if (begegnungen.length === 0) return;

    const bereiteBegegnungen = begegnungen.filter(b => b.status === 'bereit');
    for (const begegnung of bereiteBegegnungen) {
        await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);
    }

    const nachEinzelkaempfen = await mannschaftskaempfeRepository.findByPool(poolId);
    const offeneBegegnungen = nachEinzelkaempfen.filter(b => b.status === 'bereit' || b.status === 'gestartet');
    let hatAenderung = false;
    for (const begegnung of offeneBegegnungen) {
        await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung._id);
        const nachher = await mannschaftskaempfeRepository.findById(begegnung._id);
        if (nachher.status !== begegnung.status) hatAenderung = true;
    }
    if (hatAenderung) {
        return aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);
    }

    const alleBegegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
    const alleBeendet = alleBegegnungen.every(b => b.status === 'beendet' || b.status === 'freilos');
    if (alleBeendet) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
