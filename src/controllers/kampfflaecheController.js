import { synchronisiereMattenStatus, poolHatBereitsEchteKaempfe, aktualisierePoolStatusNachAuslosung } from './poolController.js';
import { FachFehler } from '../utils/fachFehler.js';

export async function createKampfflaeche(knex, req, res) {
    try {
        const { turnier_id, bezeichnung } = req.body;

        if (!turnier_id || !bezeichnung) {
            return res.status(400).json({ success: false, error: 'Pflichtfelder fehlen (turnier_id, bezeichnung).' });
        }

        const [idObj] = await knex('kampfflaechen').insert({
            turnier_id: parseInt(turnier_id),
            bezeichnung
        }).returning('id');

        const kampfflaecheId = typeof idObj === 'object' ? idObj.id : idObj;
        return res.status(201).json({ success: true, kampfflaecheId });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getKampfflaechen(knex, req, res) {
    try {
        const { turnierId } = req.query;

        if (!turnierId) {
            return res.status(400).json({ success: false, error: 'turnierId wird als Query-Parameter benötigt.' });
        }

        const kfList = await knex('kampfflaechen')
            .where({ turnier_id: parseInt(turnierId) })
            .orderBy('id', 'asc');

        return res.json(kfList);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getKampfflaeche(knex, req, res) {
    try {
        const { id } = req.params;

        const kf = await knex('kampfflaechen').where({ id }).first();
        if (!kf) {
            return res.status(404).json({ success: false, error: 'Kampffläche nicht gefunden.' });
        }

        return res.json(kf);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateKampfflaeche(knex, req, res) {
    try {
        const { id } = req.params;
        const { bezeichnung } = req.body;

        if (!bezeichnung) {
            return res.status(400).json({ success: false, error: 'Bezeichnung ist erforderlich.' });
        }

        await knex('kampfflaechen').where({ id }).update({
            bezeichnung,
            updated_at: knex.fn.now()
        });

        return res.json({ success: true, message: 'Kampffläche erfolgreich aktualisiert.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function deleteKampfflaeche(knex, req, res) {
    try {
        const { id } = req.params;

        const kf = await knex('kampfflaechen').where({ id }).first();
        if (!kf) {
            return res.status(404).json({ success: false, error: 'Kampffläche nicht gefunden.' });
        }

        // Verhindert, dass bereits ausgetragene echte Kämpfe durch das Löschen der Matte
        // stillschweigend "heimatlos" werden (siehe QA-Bericht F4) — die FK-Referenz auf
        // pools.kampfflaeche_id würde per ON DELETE SET NULL zwar nicht fehlschlagen, aber Pool-
        // Status und matte_reihenfolge blieben inkonsistent stehen.
        const zugeordnetePools = await knex('pools').where({ kampfflaeche_id: id }).select('id');
        for (const pool of zugeordnetePools) {
            if (await poolHatBereitsEchteKaempfe(knex, pool.id)) {
                return res.status(409).json({
                    success: false,
                    error: 'Diese Kampffläche kann nicht gelöscht werden, da mindestens ein zugeordneter Pool bereits echte Kampfergebnisse enthält.'
                });
            }
        }

        // Nicht (mehr) gesperrte Pools sauber lösen, statt sie über den FK-Cascade "SET NULL"
        // mit veraltetem Status/Reihenfolge zurückzulassen.
        if (zugeordnetePools.length > 0) {
            const poolIds = zugeordnetePools.map(p => p.id);
            await knex('kaempfe').whereIn('pool_id', poolIds).update({ matten_reihenfolge: null });
            await knex('pools').whereIn('id', poolIds).update({
                kampfflaeche_id: null,
                matte_reihenfolge: null
            });
            for (const poolId of poolIds) {
                await aktualisierePoolStatusNachAuslosung(knex, poolId);
            }
        }

        await knex('kampfflaechen').where({ id }).del();
        return res.json({ success: true, message: 'Kampffläche erfolgreich gelöscht.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Manueller Stopp einer Matte (z.B. Arzt auf der Matte, technisches Problem, Kampfrichter-
// Besprechung). Manuelle Zustände (pausiert/gesperrt) haben Vorrang vor der automatischen
// Neuberechnung durch synchronisiereMattenStatus, bis sie aktiv wieder aufgehoben werden.
export async function pausiereMatte(knex, id) {
    const kf = await knex('kampfflaechen').where({ id }).first();
    if (!kf) throw new FachFehler(404, 'Kampffläche nicht gefunden.');
    if (kf.status === 'gesperrt') throw new FachFehler(400, 'Eine gesperrte Matte muss erst entsperrt werden.');
    await knex('kampfflaechen').where({ id }).update({ status: 'pausiert', updated_at: knex.fn.now() });
}

export async function pausiereKampfflaeche(knex, req, res) {
    try {
        await pausiereMatte(knex, req.params.id);
        return res.json({ success: true, message: 'Matte pausiert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Hebt "pausiert" auf und berechnet den automatischen Status (frei/pools_vorhanden/
// in_austragung) aus der aktuellen Pool-Zuordnung neu.
export async function setzeMatteFort(knex, id) {
    const kf = await knex('kampfflaechen').where({ id }).first();
    if (!kf) throw new FachFehler(404, 'Kampffläche nicht gefunden.');
    if (kf.status !== 'pausiert') throw new FachFehler(400, 'Diese Matte ist nicht pausiert.');
    await knex('kampfflaechen').where({ id }).update({ status: 'frei', updated_at: knex.fn.now() });
    await synchronisiereMattenStatus(knex, parseInt(id, 10));
}

export async function setzeKampfflaecheFort(knex, req, res) {
    try {
        await setzeMatteFort(knex, req.params.id);
        return res.json({ success: true, message: 'Matte fortgesetzt.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Deaktiviert eine Matte für den Wettkampf (z.B. Mittagspause, vorzeitiger Abbau).
export async function sperreKampfflaeche(knex, req, res) {
    try {
        const { id } = req.params;
        const kf = await knex('kampfflaechen').where({ id }).first();
        if (!kf) return res.status(404).json({ success: false, error: 'Kampffläche nicht gefunden.' });
        await knex('kampfflaechen').where({ id }).update({ status: 'gesperrt', updated_at: knex.fn.now() });
        return res.json({ success: true, message: 'Matte gesperrt.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Hebt "gesperrt" auf und berechnet den automatischen Status neu.
export async function entsperreKampfflaeche(knex, req, res) {
    try {
        const { id } = req.params;
        const kf = await knex('kampfflaechen').where({ id }).first();
        if (!kf) return res.status(404).json({ success: false, error: 'Kampffläche nicht gefunden.' });
        if (kf.status !== 'gesperrt') {
            return res.status(400).json({ success: false, error: 'Diese Matte ist nicht gesperrt.' });
        }
        await knex('kampfflaechen').where({ id }).update({ status: 'frei', updated_at: knex.fn.now() });
        await synchronisiereMattenStatus(knex, parseInt(id, 10));
        return res.json({ success: true, message: 'Matte entsperrt.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
