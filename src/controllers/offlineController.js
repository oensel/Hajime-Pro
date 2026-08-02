import { triggerPoolUpdate } from './kampfController.js';
import { planeKaempfeFuerKampfflaeche } from './poolController.js';

export async function exportMatData(knex, req, res) {
    try {
        const kampfflaecheId = parseInt(req.query.kampfflaecheId, 10);
        if (!kampfflaecheId) {
            return res.status(400).json({ success: false, error: 'kampfflaecheId ist erforderlich' });
        }

        const kampfflaeche = await knex('kampfflaechen').where({ id: kampfflaecheId }).first();
        if (!kampfflaeche) {
            return res.status(404).json({ success: false, error: 'Kampffläche nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: kampfflaeche.turnier_id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Zugehöriges Turnier nicht gefunden.' });
        }

        const pools = await knex('pools').where({ kampfflaeche_id: kampfflaecheId });
        const poolIds = pools.map(p => p.id);

        let fights = [];
        let teilnehmer = [];

        if (poolIds.length > 0) {
            fights = await knex('kaempfe')
                .join('pools', 'kaempfe.pool_id', '=', 'pools.id')
                .leftJoin('turnier_teilnehmer as t1', 'kaempfe.kaempfer1_id', '=', 't1.id')
                .leftJoin('turnier_teilnehmer as t2', 'kaempfe.kaempfer2_id', '=', 't2.id')
                .whereIn('kaempfe.pool_id', poolIds)
                .select(
                    'kaempfe.*',
                    'pools.bezeichnung as pool_bezeichnung',
                    'pools.modus as pool_modus',
                    'pools.kampfzeit_sekunden as pool_kampfzeit',
                    'pools.altersklasse as pool_altersklasse',
                    'pools.golden_score_aktiv as pool_golden_score_aktiv',
                    'pools.golden_score_max_sekunden as pool_golden_score_max_sekunden',
                    't1.vorname as kaempfer1_vorname',
                    't1.nachname as kaempfer1_nachname',
                    't1.verein as kaempfer1_verein',
                    't2.vorname as kaempfer2_vorname',
                    't2.nachname as kaempfer2_nachname',
                    't2.verein as kaempfer2_verein'
                )
                .orderBy('kaempfe.id', 'asc');

            teilnehmer = await knex('turnier_teilnehmer').whereIn('pool_id', poolIds);
        }

        const payload = {
            version: '1.0',
            exportTimestamp: new Date().toISOString(),
            turnierId: turnier.id,
            turnierBezeichnung: turnier.bezeichnung,
            kampfflaecheId,
            kampfflaecheBezeichnung: kampfflaeche.bezeichnung,
            pools,
            teilnehmer,
            kaempfe: fights
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=turnier_${turnier.id}_matte_${kampfflaecheId}.json`);
        return res.json(payload);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function importMatResults(knex, req, res) {
    try {
        const { turnierId, kampfflaecheId, kaempfe } = req.body;

        if (!turnierId || !kampfflaecheId || !Array.isArray(kaempfe)) {
            return res.status(400).json({ success: false, error: 'Ungültiges Datenformat. turnierId, kampfflaecheId und kaempfe sind erforderlich.' });
        }

        await knex.transaction(async (trx) => {
            const poolIdsToUpdate = new Set();

            for (const fight of kaempfe) {
                if (fight.status === 'beendet' || fight.status === 'freilos') {
                    await trx('kaempfe')
                        .where({ id: fight.id })
                        .update({
                            kaempfer1_id: fight.kaempfer1_id,
                            kaempfer2_id: fight.kaempfer2_id,
                            status: fight.status,
                            sieger_id: fight.sieger_id,
                            unterbewertung_kaempfer1: parseInt(fight.unterbewertung_kaempfer1) || 0,
                            unterbewertung_kaempfer2: parseInt(fight.unterbewertung_kaempfer2) || 0,
                            kampfzeit_in_sekunden: parseInt(fight.kampfzeit_in_sekunden) || 0,
                            updated_at: trx.fn.now()
                        });
                    poolIdsToUpdate.add(fight.pool_id);
                } else if (['gestartet', 'bereit', 'angelegt', 'vorbereiten'].includes(fight.status)) {
                    await trx('kaempfe')
                        .where({ id: fight.id })
                        .update({
                            kaempfer1_id: fight.kaempfer1_id,
                            kaempfer2_id: fight.kaempfer2_id,
                            status: fight.status,
                            updated_at: trx.fn.now()
                        });
                    poolIdsToUpdate.add(fight.pool_id);
                }
            }

            for (const poolId of poolIdsToUpdate) {
                await triggerPoolUpdate(trx, poolId);
            }
        });

        await planeKaempfeFuerKampfflaeche(knex, parseInt(kampfflaecheId));

        return res.json({ success: true, message: 'Offline-Ergebnisse erfolgreich eingelesen und verarbeitet!' });
    } catch (error) {
        console.error('[Offline Import Error]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
