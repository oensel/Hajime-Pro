import { JederGegenJedenManager } from '../services/JederGegenJedenManager.js';
import { DoppelKo8Manager } from '../services/DoppelKo8Manager.js';
import { DoppelKo16Manager } from '../services/DoppelKo16Manager.js';
import { DoppelKo32Manager } from '../services/DoppelKo32Manager.js';
import { GruppenUeberKreuzManager } from '../services/GruppenUeberKreuzManager.js';
import { planeKaempfeFuerKampfflaeche, synchronisiereMattenStatus } from './poolController.js';
import { baueMattenAnsicht } from '../shared/mattenAnsicht.js';
import { FachFehler } from '../utils/fachFehler.js';
import { pruefeKorrekturErlaubt } from '../shared/korrekturRegel.js';
import { verteilePositionen, fuegeEin } from '../shared/mattenReihenfolge.js';
import { aktualisiereMannschaftsPool, ermittleErsatzKandidaten, wechsleKaempfer } from '../services/mannschaftsBegegnungEngine.js';

const jederGegenJeden = new JederGegenJedenManager();
const doppelKo8 = new DoppelKo8Manager();
const doppelKo16 = new DoppelKo16Manager();
const doppelKo32 = new DoppelKo32Manager();
const ueberKreuz = new GruppenUeberKreuzManager();

/**
 * Utility function to trigger pool-specific logic when matches are updated.
 */
export async function triggerPoolUpdate(knex, poolId) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool) return;

    if (pool.typ === 'mannschaft') {
        await aktualisiereMannschaftsPool(knex, poolId);
        const { markiereTeilgenommenFuerBeendeteKaempfe } = await import('./teilnehmerController.js');
        await markiereTeilgenommenFuerBeendeteKaempfe(knex, poolId);
        return;
    }

    if (pool.modus === 'Gruppen-Überkreuz') {
        await ueberKreuz.aktualisiereTurnier(knex, poolId);
    } else if (pool.modus === 'Doppel-KO-8') {
        await doppelKo8.aktualisiereTurnier(knex, poolId);
    } else if (pool.modus === 'Doppel-KO-16') {
        await doppelKo16.aktualisiereTurnier(knex, poolId);
    } else if (pool.modus === 'Doppel-KO-32') {
        await doppelKo32.aktualisiereTurnier(knex, poolId);
    } else {
        await jederGegenJeden.aktualisiereTurnier(knex, poolId);
    }

    const { markiereTeilgenommenFuerBeendeteKaempfe } = await import('./teilnehmerController.js');
    await markiereTeilgenommenFuerBeendeteKaempfe(knex, poolId);
}

export async function createKampf(knex, req, res) {
    try {
        const {
            pool_id, kaempfer1_id, kaempfer2_id, sieger_id, kampfzeit_in_sekunden,
            unterbewertung_kaempfer1, unterbewertung_kaempfer2, status,
            reihenfolge_nummer, matten_reihenfolge
        } = req.body;

        if (!pool_id) {
            return res.status(400).json({ success: false, error: 'Pflichtfeld pool_id fehlt.' });
        }

        const [idObj] = await knex('kaempfe').insert({
            pool_id: parseInt(pool_id),
            kaempfer1_id: kaempfer1_id || null,
            kaempfer2_id: kaempfer2_id || null,
            sieger_id: sieger_id || null,
            kampfzeit_in_sekunden: parseInt(kampfzeit_in_sekunden) || 0,
            unterbewertung_kaempfer1: parseInt(unterbewertung_kaempfer1) || 0,
            unterbewertung_kaempfer2: parseInt(unterbewertung_kaempfer2) || 0,
            status: status || (kaempfer1_id && kaempfer2_id ? 'bereit' : 'angelegt'),
            reihenfolge_nummer: reihenfolge_nummer || null,
            matten_reihenfolge: matten_reihenfolge || null
        }).returning('id');

        const kampfId = typeof idObj === 'object' ? idObj.id : idObj;

        // Falls direkt beendet oder als Freilos angelegt, den Pool-Zustand updaten
        if (status === 'beendet' || status === 'freilos') {
            await triggerPoolUpdate(knex, parseInt(pool_id));
            const pool = await knex('pools').where({ id: parseInt(pool_id) }).first();
            if (pool && pool.kampfflaeche_id) {
                await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
            }
        }

        return res.status(201).json({ success: true, kampfId });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getKaempfe(knex, req, res) {
    try {
        const { poolId, turnierId, kampfflaecheId } = req.query;

        let query = knex('kaempfe');

        if (poolId) {
            query = query
                .join('pools', 'kaempfe.pool_id', '=', 'pools.id')
                .leftJoin('turnier_teilnehmer as t1', 'kaempfe.kaempfer1_id', '=', 't1.id')
                .leftJoin('turnier_teilnehmer as t2', 'kaempfe.kaempfer2_id', '=', 't2.id')
                .where({ 'kaempfe.pool_id': parseInt(poolId) })
                .select(
                    'kaempfe.*',
                    'pools.modus as pool_modus',
                    't1.vorname as kaempfer1_vorname',
                    't1.nachname as kaempfer1_nachname',
                    't1.verein as kaempfer1_verein',
                    't2.vorname as kaempfer2_vorname',
                    't2.nachname as kaempfer2_nachname',
                    't2.verein as kaempfer2_verein'
                )
                .orderBy('kaempfe.id', 'asc');
        } else if (kampfflaecheId) {
            // Die Ansicht selbst baut die reine Funktion baueMattenAnsicht (src/shared/) — dieselbe,
            // die das Frontend im Sync-Modus auf die Dokumente der Dokument-DB anwendet. Dort stehen
            // auch die Regeln zu wartet_auf_einzelpools, Gewichtsklassen-Suffix und Pausenwarnung.
            const mattenId = parseInt(kampfflaecheId);
            const pools = await knex('pools').where({ kampfflaeche_id: mattenId });
            const poolIds = pools.map(p => p.id);
            // Die Farbe von Kämpfer 2 (blau/rot) stellt das Scoreboard live ein (updateKampfColor); die Kampf-Seite zeigt sie an.
            const liveFarben = global.liveColors || {};
            const kaempfeDerMatte = (poolIds.length ? await knex('kaempfe').whereIn('pool_id', poolIds) : [])
                .map(k => (liveFarben[k.id] ? { ...k, live_farbe: liveFarben[k.id] } : k));
            const turnier = pools.length ? await knex('turniere').where({ id: pools[0].turnier_id }).first('farbe_kaempfer2') : null;
            const teilnehmerIds = [...new Set(kaempfeDerMatte.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean))];
            const teilnehmer = teilnehmerIds.length ? await knex('turnier_teilnehmer').whereIn('id', teilnehmerIds) : [];
            const begegnungIds = [...new Set(kaempfeDerMatte.map(k => k.mannschaftskampf_id).filter(Boolean))];
            const mannschaftskaempfe = begegnungIds.length ? await knex('mannschaftskaempfe').whereIn('id', begegnungIds) : [];
            const mannschaftIds = [...new Set(mannschaftskaempfe.flatMap(m => [m.mannschaft1_id, m.mannschaft2_id]).filter(Boolean))];
            const mannschaften = mannschaftIds.length ? await knex('mannschaften').whereIn('id', mannschaftIds) : [];

            return res.json(baueMattenAnsicht({ kaempfe: kaempfeDerMatte, pools, teilnehmer, mannschaftskaempfe, mannschaften, turnier }, mattenId, Date.now()));
        } else if (turnierId) {
            query = query
                .join('pools', 'kaempfe.pool_id', '=', 'pools.id')
                .where('pools.turnier_id', parseInt(turnierId))
                .select('kaempfe.*')
                .orderBy('kaempfe.id', 'asc');
        } else {
            return res.status(400).json({ success: false, error: 'Entweder poolId, turnierId oder kampfflaecheId wird als Query-Parameter benötigt.' });
        }

        const matches = await query;
        return res.json(matches);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getKampf(knex, req, res) {
    try {
        const { id } = req.params;
        const kampf = await knex('kaempfe').where({ id }).first();
        if (!kampf) {
            return res.status(404).json({ success: false, error: 'Kampf nicht gefunden.' });
        }
        return res.json(kampf);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Service-Funktion ohne req/res (REST-Route updateKampf UND Sync-Brücke, src/sync/bruecke.js):
// wirft FachFehler mit dem HTTP-Status, den die Route zurückgibt.
export async function aktualisiereKampf(knex, id, felder) {
    const {
        kaempfer1_id, kaempfer2_id, sieger_id, kampfzeit_in_sekunden,
        unterbewertung_kaempfer1, unterbewertung_kaempfer2, status,
        reihenfolge_nummer, matten_reihenfolge
    } = felder;

    const currentKampf = await knex('kaempfe').where({ id }).first();
    if (!currentKampf) {
        throw new FachFehler(404, 'Kampf nicht gefunden.');
    }

    if (status === 'gestartet' && (currentKampf.status === 'beendet' || currentKampf.status === 'freilos')) {
        throw new FachFehler(400, 'Ein bereits beendeter Kampf kann nicht erneut gestartet werden.');
    }

    if (status === 'gestartet') {
        const pool = await knex('pools').where({ id: currentKampf.pool_id }).first();
        const matte = pool && pool.kampfflaeche_id ? await knex('kampfflaechen').where({ id: pool.kampfflaeche_id }).first() : null;
        if (matte && (matte.status === 'pausiert' || matte.status === 'gesperrt')) {
            throw new FachFehler(409, `Die Matte "${matte.bezeichnung}" ist aktuell ${matte.status === 'pausiert' ? 'pausiert' : 'gesperrt'} — es kann kein Kampf gestartet werden.`);
        }
    }

    // Nachträgliche Korrektur eines bereits entschiedenen Kampfes (z.B. Schiedsrichter-
    // Protest, Tippfehler): erlaubt, solange kein abhängiger Folgekampf begonnen hat (Regeln je
    // Turniersystem in src/shared/korrekturRegel.js; Jeder gegen Jeden ist nie gesperrt).
    // Noch nicht begonnene Folgekämpfe zieht triggerPoolUpdate danach automatisch nach; nur die
    // Gruppen-Halbfinals (hängen an der ganzen Vorrunde) werden hier vorher geleert.
    let halbfinalZuLoesen = [];
    const siegerGeaendert = sieger_id !== undefined && sieger_id !== currentKampf.sieger_id;
    const ergebnisGeaendert = siegerGeaendert
        || (unterbewertung_kaempfer1 !== undefined && parseInt(unterbewertung_kaempfer1) !== currentKampf.unterbewertung_kaempfer1)
        || (unterbewertung_kaempfer2 !== undefined && parseInt(unterbewertung_kaempfer2) !== currentKampf.unterbewertung_kaempfer2);
    const istVorrunde = typeof currentKampf.reihenfolge_nummer === 'string' && currentKampf.reihenfolge_nummer.startsWith('V_');
    if (
        (currentKampf.status === 'beendet' || currentKampf.status === 'freilos') &&
        ergebnisGeaendert &&
        (istVorrunde || siegerGeaendert)
    ) {
        const poolKaempfe = await knex('kaempfe').where({ pool_id: currentKampf.pool_id });
        const pruefung = pruefeKorrekturErlaubt(currentKampf, poolKaempfe);
        if (!pruefung.ok) {
            throw new FachFehler(409, `Das Ergebnis kann nicht mehr korrigiert werden: ${pruefung.grund}`);
        }
        halbfinalZuLoesen = pruefung.aufzuloesen.filter(patch => patch.ohneQuelle);

        console.log(`[Korrektur] Kampf ${currentKampf.id} (Pool ${currentKampf.pool_id}): Sieger geändert von ${currentKampf.sieger_id ?? 'keinem'} auf ${sieger_id ?? 'keinem'}.`);
    }

    for (const { id: abhaengigId, ohneQuelle, ...felderLeeren } of halbfinalZuLoesen) {
        await knex('kaempfe').where({ id: abhaengigId }).update({ ...felderLeeren, updated_at: knex.fn.now() });
    }

    await knex('kaempfe').where({ id }).update({
        kaempfer1_id: kaempfer1_id !== undefined ? kaempfer1_id : currentKampf.kaempfer1_id,
        kaempfer2_id: kaempfer2_id !== undefined ? kaempfer2_id : currentKampf.kaempfer2_id,
        sieger_id: sieger_id !== undefined ? sieger_id : currentKampf.sieger_id,
        kampfzeit_in_sekunden: kampfzeit_in_sekunden !== undefined ? parseInt(kampfzeit_in_sekunden) : currentKampf.kampfzeit_in_sekunden,
        unterbewertung_kaempfer1: unterbewertung_kaempfer1 !== undefined ? parseInt(unterbewertung_kaempfer1) : currentKampf.unterbewertung_kaempfer1,
        unterbewertung_kaempfer2: unterbewertung_kaempfer2 !== undefined ? parseInt(unterbewertung_kaempfer2) : currentKampf.unterbewertung_kaempfer2,
        status: status !== undefined ? status : currentKampf.status,
        reihenfolge_nummer: reihenfolge_nummer !== undefined ? reihenfolge_nummer : currentKampf.reihenfolge_nummer,
        matten_reihenfolge: matten_reihenfolge !== undefined ? matten_reihenfolge : currentKampf.matten_reihenfolge,
        updated_at: knex.fn.now()
    });

    // Erster gestartete Kampf eines Pools markiert dessen Auslosung als tatsächlich gestartet. Ein Kampf kann
    // auch ohne Zwischenstatus enden (z.B. "nicht angetreten" vor dem START), daher zählt "beendet" ebenso.
    if (status === 'gestartet' || status === 'beendet') {
        await knex('pools')
            .where({ id: currentKampf.pool_id, status: 'matte_zugewiesen' })
            .update({ status: 'gestartet' });

        const poolFuerMatte = await knex('pools').where({ id: currentKampf.pool_id }).first();
        if (poolFuerMatte && poolFuerMatte.kampfflaeche_id) {
            await synchronisiereMattenStatus(knex, poolFuerMatte.kampfflaeche_id);
        }
    }

    // Falls sich der Status auf 'beendet'/'freilos' geändert hat, oder der Sieger aktualisiert wurde, Kaskadenberechnung triggern
    if (status === 'beendet' || status === 'freilos' || sieger_id !== undefined) {
        await triggerPoolUpdate(knex, currentKampf.pool_id);

        // Kampfflächen-Reihenfolge neu planen, da eventuell Hüllen befüllt wurden
        const pool = await knex('pools').where({ id: currentKampf.pool_id }).first();
        if (pool && pool.kampfflaeche_id) {
            await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
            await synchronisiereMattenStatus(knex, pool.kampfflaeche_id);
        }
    }
}

export async function updateKampf(knex, req, res) {
    try {
        await aktualisiereKampf(knex, req.params.id, req.body);
        return res.json({ success: true, message: 'Kampf erfolgreich aktualisiert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Lädt die noch nicht gestarteten Kämpfe ("bereit" mit Position) einer Matte in Mattenreihenfolge.
async function ladeBereiteKaempfeDerMatte(knex, kampfflaecheId) {
    const poolIds = (await knex('pools').where({ kampfflaeche_id: kampfflaecheId }).select('id')).map(p => p.id);
    if (!poolIds.length) return [];
    return knex('kaempfe')
        .whereIn('pool_id', poolIds)
        .where({ status: 'bereit' })
        .whereNotNull('matten_reihenfolge')
        .orderBy('matten_reihenfolge', 'asc')
        .orderBy('id', 'asc');
}

async function schreibePositionen(knex, zuweisungen) {
    await knex.transaction(async (trx) => {
        for (const { id, matten_reihenfolge } of zuweisungen) {
            await trx('kaempfe').where({ id }).update({ matten_reihenfolge, reihenfolge_manuell: true, updated_at: trx.fn.now() });
        }
    });
}

// Setzt einen beendeten Kampf zurück auf "bereit" und reiht ihn an zweiter Stelle der kommenden
// Kämpfe seiner Matte ein (Sync-Brücke und REST). Abhängige, noch nicht begonnene Folgekämpfe
// werden wieder geleert; Regeln und Sperren: src/shared/korrekturRegel.js.
export async function setzeKampfZurueck(knex, kampfId) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf) throw new FachFehler(404, 'Kampf nicht gefunden.');
    if (kampf.status !== 'beendet') {
        throw new FachFehler(409, 'Nur ein beendeter Kampf kann zurückgesetzt werden.');
    }
    if (kampf.mannschaftskampf_id) {
        throw new FachFehler(409, 'Einzelkämpfe einer Mannschaftsbegegnung können nicht zurückgesetzt werden.');
    }
    const poolKaempfe = await knex('kaempfe').where({ pool_id: kampf.pool_id });
    const pruefung = pruefeKorrekturErlaubt(kampf, poolKaempfe);
    if (!pruefung.ok) {
        throw new FachFehler(409, `Der Kampf kann nicht mehr zurückgesetzt werden: ${pruefung.grund}`);
    }

    const pool = await knex('pools').where({ id: kampf.pool_id }).first();
    await knex.transaction(async (trx) => {
        await trx('kaempfe').where({ id: kampfId }).update({
            status: 'bereit',
            sieger_id: null,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0,
            kampfzeit_in_sekunden: 0,
            reihenfolge_manuell: true,
            updated_at: trx.fn.now()
        });
        for (const { id, ohneQuelle, ...felder } of pruefung.aufzuloesen) {
            await trx('kaempfe').where({ id }).update({ ...felder, updated_at: trx.fn.now() });
        }
        // Der Pool ist wieder in Betrieb (auch nach "alle Kämpfe ausgetragen"/"abgeschlossen").
        if (pool && (pool.status === 'kaempfe_beendet' || pool.status === 'abgeschlossen')) {
            await trx('pools').where({ id: pool.id }).update({ status: 'gestartet' });
        }
    });

    await triggerPoolUpdate(knex, kampf.pool_id);
    await reiheKampfAnZweiterStelleEin(knex, pool, kampf);
}

// Plant die Kämpfe der Matte neu ein und stellt den Kampf an zweiter Stelle der kommenden Kämpfe ein (läuft gerade
// ein Kampf, ist er die Nummer 1 und dieser Kampf der nächste; sonst kommt er nach dem als Nächstes anstehenden).
// Der Kampf wird dabei als manuell einsortiert markiert und bleibt für den Planer unangetastet.
async function reiheKampfAnZweiterStelleEin(knex, pool, kampf) {
    if (pool && pool.kampfflaeche_id) {
        await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
        const bereite = await ladeBereiteKaempfeDerMatte(knex, pool.kampfflaeche_id);
        const uebrige = bereite.map(k => k.id).filter(id => id !== kampf.id);
        const poolIds = (await knex('pools').where({ kampfflaeche_id: pool.kampfflaeche_id }).select('id')).map(p => p.id);
        const laeuftGerade = await knex('kaempfe').whereIn('pool_id', poolIds).where({ status: 'gestartet' }).first('id');
        const folge = fuegeEin(uebrige, kampf.id, laeuftGerade ? 0 : 1);
        const nachId = new Map([...bereite, kampf].map(k => [k.id, k]));
        await schreibePositionen(knex, verteilePositionen(folge, nachId));
        await synchronisiereMattenStatus(knex, pool.kampfflaeche_id);
    }
}

// Zusatzkampf in einem Pool in Prüfung (z.B. Entscheidung eines 3er-Kreises mit je einem Sieg): Die Turnierleitung
// wählt zwei Kämpfer des Pools. Der Pool ist danach wieder in Betrieb ("gestartet") und wird nach dem Kampf
// automatisch wieder zum Pool in Prüfung (JederGegenJedenManager.aktualisiereTurnier). Nur Jeder-gegen-Jeden:
// Turnierbäume und Überkreuz-Gruppen sind nach ihrer Struktur entschieden.
export async function legeZusatzkampfAn(knex, poolId, kaempfer1Id, kaempfer2Id) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool) throw new FachFehler(404, 'Pool nicht gefunden.');
    if (pool.typ === 'mannschaft') throw new FachFehler(409, 'Für Mannschafts-Pools gibt es keinen Zusatzkampf.');
    if (!/^Jeder[- ]gegen[- ]Jeden$/.test(pool.modus || '')) {
        throw new FachFehler(409, 'Ein Zusatzkampf ist nur in Jeder-gegen-Jeden-Pools möglich.');
    }
    if (pool.status !== 'kaempfe_beendet') {
        throw new FachFehler(409, 'Ein Zusatzkampf kann nur in einem Pool in Prüfung angelegt werden.');
    }
    const id1 = parseInt(kaempfer1Id, 10);
    const id2 = parseInt(kaempfer2Id, 10);
    if (!id1 || !id2 || id1 === id2) throw new FachFehler(400, 'Bitte zwei verschiedene Kämpfer wählen.');

    const poolKaempfe = await knex('kaempfe').where({ pool_id: poolId });
    const imPool = new Set(poolKaempfe.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean));
    if (!imPool.has(id1) || !imPool.has(id2)) throw new FachFehler(409, 'Beide Kämpfer müssen zum Pool gehören.');

    const naechsteNummer = poolKaempfe.reduce((m, k) => Math.max(m, parseInt(k.reihenfolge_nummer, 10) || 0), 0) + 1;
    let neuerKampf;
    await knex.transaction(async (trx) => {
        const [zeile] = await trx('kaempfe').insert({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: naechsteNummer,
            kaempfer1_id: id1,
            kaempfer2_id: id2,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0,
            reihenfolge_manuell: true
        }).returning('id');
        neuerKampf = await trx('kaempfe').where({ id: typeof zeile === 'object' ? zeile.id : zeile }).first();
        await trx('pools').where({ id: poolId }).update({ status: 'gestartet' });
    });
    await reiheKampfAnZweiterStelleEin(knex, pool, neuerKampf);
    return neuerKampf.id;
}

export async function legeZusatzkampfAnRoute(knex, req, res) {
    try {
        const kampfId = await legeZusatzkampfAn(knex, parseInt(req.params.id, 10), req.body.kaempfer1_id, req.body.kaempfer2_id);
        return res.json({ success: true, kampfId });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

export async function zuruecksetzenKampf(knex, req, res) {
    try {
        await setzeKampfZurueck(knex, parseInt(req.params.id, 10));
        return res.json({ success: true, message: 'Kampf zurückgesetzt.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Neue Reihenfolge der noch nicht gestarteten Kämpfe einer Matte (Drag&Drop in Kampf-Seite und
// Scoreboard). kampfIds ist die gewünschte Reihenfolge; verwendet die bisherigen Positionswerte.
export async function setzeMattenReihenfolgeNeu(knex, kampfflaecheId, kampfIds) {
    const ids = (kampfIds || []).map(id => parseInt(id, 10));
    if (!ids.length || ids.some(Number.isNaN) || new Set(ids).size !== ids.length) {
        throw new FachFehler(400, 'kampfIds muss eine Liste verschiedener Kampf-IDs sein.');
    }
    const poolIds = (await knex('pools').where({ kampfflaeche_id: kampfflaecheId }).select('id')).map(p => p.id);
    const kaempfe = await knex('kaempfe').whereIn('id', ids);
    if (kaempfe.length !== ids.length) throw new FachFehler(404, 'Kampf nicht gefunden.');
    for (const k of kaempfe) {
        if (!poolIds.includes(k.pool_id)) throw new FachFehler(400, 'Alle Kämpfe müssen zur selben Kampffläche gehören.');
        if (k.status !== 'bereit') throw new FachFehler(409, 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") umsortiert werden.');
    }
    await schreibePositionen(knex, verteilePositionen(ids, new Map(kaempfe.map(k => [k.id, k]))));
}

export async function sortiereKaempfe(knex, req, res) {
    try {
        await setzeMattenReihenfolgeNeu(knex, parseInt(req.body.kampfflaecheId, 10), req.body.kampfIds);
        return res.json({ success: true, message: 'Reihenfolge gespeichert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Setzt die Matten-Reihenfolge eines einzelnen Kampfes (Sync-Brücke: eine Matte hat zwei Kämpfe
// getauscht, jede Seite kommt als eigene Dokument-Änderung an). Gleiche Einschränkung wie
// tauscheKaempfeReihenfolge: nur noch nicht gestartete Kämpfe.
export async function setzeMattenReihenfolge(knex, kampfId, wert) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf) throw new FachFehler(404, 'Kampf nicht gefunden.');
    if (kampf.status !== 'bereit') {
        throw new FachFehler(409, 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") umsortiert werden.');
    }
    await knex('kaempfe').where({ id: kampfId }).update({ matten_reihenfolge: wert, reihenfolge_manuell: true, updated_at: knex.fn.now() });
}

// Vertauscht die Matten-Reihenfolge zweier noch nicht gestarteter Kämpfe derselben Kampffläche
// — die manuelle Reaktion auf eine in der Steuerung angezeigte Pausenwarnung (siehe getKaempfe/
// pausenwarnung): der anstehende Kampf wird hinter den nächsten geschoben, um mehr Pause für die
// betroffenen Kämpfer zu gewinnen. Kann wiederholt aufgerufen werden, falls die Pause danach
// immer noch nicht reicht.
export async function tauscheKaempfeReihenfolge(knex, req, res) {
    try {
        const { kampf1Id, kampf2Id } = req.body;
        if (!kampf1Id || !kampf2Id) {
            return res.status(400).json({ success: false, error: 'kampf1Id und kampf2Id sind erforderlich.' });
        }
        if (parseInt(kampf1Id, 10) === parseInt(kampf2Id, 10)) {
            return res.status(400).json({ success: false, error: 'Es können nur zwei unterschiedliche Kämpfe getauscht werden.' });
        }

        const kampf1 = await knex('kaempfe').where({ id: kampf1Id }).first();
        const kampf2 = await knex('kaempfe').where({ id: kampf2Id }).first();
        if (!kampf1 || !kampf2) {
            return res.status(404).json({ success: false, error: 'Kampf nicht gefunden.' });
        }

        // Nur noch nicht gestartete Kämpfe dürfen umsortiert werden — ein laufender/beendeter
        // Kampf ist bereits Realität und kann nicht mehr "verschoben" werden.
        if (kampf1.status !== 'bereit' || kampf2.status !== 'bereit') {
            return res.status(409).json({ success: false, error: 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") getauscht werden.' });
        }
        if (kampf1.matten_reihenfolge == null || kampf2.matten_reihenfolge == null) {
            return res.status(409).json({ success: false, error: 'Beide Kämpfe müssen bereits einer Mattenreihenfolge zugeordnet sein.' });
        }

        const pool1 = await knex('pools').where({ id: kampf1.pool_id }).first();
        const pool2 = await knex('pools').where({ id: kampf2.pool_id }).first();
        if (!pool1 || !pool2 || pool1.kampfflaeche_id == null || pool1.kampfflaeche_id !== pool2.kampfflaeche_id) {
            return res.status(400).json({ success: false, error: 'Beide Kämpfe müssen derselben Kampffläche zugeordnet sein.' });
        }

        await knex.transaction(async (trx) => {
            await trx('kaempfe').where({ id: kampf1.id }).update({ matten_reihenfolge: kampf2.matten_reihenfolge, reihenfolge_manuell: true });
            await trx('kaempfe').where({ id: kampf2.id }).update({ matten_reihenfolge: kampf1.matten_reihenfolge, reihenfolge_manuell: true });
        });

        return res.json({ success: true, message: 'Reihenfolge erfolgreich getauscht.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function deleteKampf(knex, req, res) {
    try {
        const { id } = req.params;
        const kampf = await knex('kaempfe').where({ id }).first();
        if (!kampf) {
            return res.status(404).json({ success: false, error: 'Kampf nicht gefunden.' });
        }

        await knex('kaempfe').where({ id }).del();

        // Nach dem Löschen den Pool aktualisieren
        await triggerPoolUpdate(knex, kampf.pool_id);
        const pool = await knex('pools').where({ id: kampf.pool_id }).first();
        if (pool && pool.kampfflaeche_id) {
            await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
        }

        return res.json({ success: true, message: 'Kampf erfolgreich gelöscht.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateKampfColor(knex, req, res) {
    try {
        const { id } = req.params;
        const { color } = req.body;
        
        global.liveColors = global.liveColors || {};
        global.liveColors[id] = color;
        
        return res.json({ success: true, message: 'Live-Farbe aktualisiert.', color });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getErsatzOptionen(knex, req, res) {
    try {
        const { id } = req.params;
        const ergebnis = await ermittleErsatzKandidaten(knex, parseInt(id));
        if (!ergebnis) {
            return res.status(400).json({ success: false, error: 'Dies ist kein Mannschaftskampf-Einzelkampf.' });
        }
        return res.json({
            success: true,
            kaempfer1Optionen: ergebnis.kaempfer1Optionen,
            kaempfer2Optionen: ergebnis.kaempfer2Optionen
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function auswechseln(knex, req, res) {
    try {
        const { id } = req.params;
        const { seite, teilnehmerId } = req.body;
        if (!seite || !teilnehmerId) {
            return res.status(400).json({ success: false, error: 'seite und teilnehmerId sind erforderlich.' });
        }
        await wechsleKaempfer(knex, parseInt(id), seite, parseInt(teilnehmerId));
        return res.json({ success: true, message: 'Kämpfer erfolgreich ausgewechselt.' });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
}
