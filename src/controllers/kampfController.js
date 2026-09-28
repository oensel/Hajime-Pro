import { JederGegenJedenManager } from '../services/JederGegenJedenManager.js';
import { DoppelKo8Manager } from '../services/DoppelKo8Manager.js';
import { DoppelKo16Manager } from '../services/DoppelKo16Manager.js';
import { DoppelKo32Manager } from '../services/DoppelKo32Manager.js';
import { GruppenUeberKreuzManager } from '../services/GruppenUeberKreuzManager.js';
import { planeKaempfeFuerKampfflaeche, synchronisiereMattenStatus } from './poolController.js';
import { baueMattenAnsicht } from '../shared/mattenAnsicht.js';
import { FachFehler } from '../utils/fachFehler.js';
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
            const kaempfeDerMatte = poolIds.length ? await knex('kaempfe').whereIn('pool_id', poolIds) : [];
            const teilnehmerIds = [...new Set(kaempfeDerMatte.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean))];
            const teilnehmer = teilnehmerIds.length ? await knex('turnier_teilnehmer').whereIn('id', teilnehmerIds) : [];
            const begegnungIds = [...new Set(kaempfeDerMatte.map(k => k.mannschaftskampf_id).filter(Boolean))];
            const mannschaftskaempfe = begegnungIds.length ? await knex('mannschaftskaempfe').whereIn('id', begegnungIds) : [];
            const mannschaftIds = [...new Set(mannschaftskaempfe.flatMap(m => [m.mannschaft1_id, m.mannschaft2_id]).filter(Boolean))];
            const mannschaften = mannschaftIds.length ? await knex('mannschaften').whereIn('id', mannschaftIds) : [];

            return res.json(baueMattenAnsicht({ kaempfe: kaempfeDerMatte, pools, teilnehmer, mannschaftskaempfe, mannschaften }, mattenId, Date.now()));
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
    // Protest, Tippfehler): blockieren, falls ein direkt abhängiger Folgekampf (Doppel-KO/
    // Gruppen-Überkreuz) bereits läuft oder sogar schon entschieden ist. Ohne diese Prüfung
    // würde die anschließende Kaskade (kampfProgression.js) den Folgekampf NICHT mehr
    // anfassen — der längst überholte, falsche Kämpfer bliebe dort stillschweigend stehen.
    // Nur 'angelegt'/'bereit' stehende Folgekämpfe lässt triggerPoolUpdate danach automatisch
    // korrekt nachziehen.
    if (
        (currentKampf.status === 'beendet' || currentKampf.status === 'freilos') &&
        sieger_id !== undefined &&
        sieger_id !== currentKampf.sieger_id
    ) {
        const abhaengigeKaempfe = await knex('kaempfe')
            .where({ pool_id: currentKampf.pool_id })
            .andWhere(function () {
                this.where('kaempfer1_quelle_kampf_id', currentKampf.id)
                    .orWhere('kaempfer2_quelle_kampf_id', currentKampf.id);
            });

        const bereitsFortgeschritten = abhaengigeKaempfe.filter(k => ['gestartet', 'beendet', 'freilos'].includes(k.status));
        if (bereitsFortgeschritten.length > 0) {
            const namen = bereitsFortgeschritten.map(k => k.reihenfolge_nummer || `#${k.id}`).join(', ');
            throw new FachFehler(409, `Das Ergebnis kann nicht mehr korrigiert werden: der Folgekampf (${namen}) läuft bereits oder wurde bereits gewertet. Bitte zuerst dessen Ergebnis manuell korrigieren.`);
        }

        console.log(`[Korrektur] Kampf ${currentKampf.id} (Pool ${currentKampf.pool_id}): Sieger geändert von ${currentKampf.sieger_id ?? 'keinem'} auf ${sieger_id ?? 'keinem'}.`);
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

    // Erster gestartete Kampf eines Pools markiert dessen Auslosung als tatsächlich gestartet.
    if (status === 'gestartet') {
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

// Setzt die Matten-Reihenfolge eines einzelnen Kampfes (Sync-Brücke: eine Matte hat zwei Kämpfe
// getauscht, jede Seite kommt als eigene Dokument-Änderung an). Gleiche Einschränkung wie
// tauscheKaempfeReihenfolge: nur noch nicht gestartete Kämpfe.
export async function setzeMattenReihenfolge(knex, kampfId, wert) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf) throw new FachFehler(404, 'Kampf nicht gefunden.');
    if (kampf.status !== 'bereit') {
        throw new FachFehler(409, 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") umsortiert werden.');
    }
    await knex('kaempfe').where({ id: kampfId }).update({ matten_reihenfolge: wert, updated_at: knex.fn.now() });
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
            await trx('kaempfe').where({ id: kampf1.id }).update({ matten_reihenfolge: kampf2.matten_reihenfolge });
            await trx('kaempfe').where({ id: kampf2.id }).update({ matten_reihenfolge: kampf1.matten_reihenfolge });
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
