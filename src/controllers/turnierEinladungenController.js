// GET /api/turniere/einladungen — offene Turnier-Einladungen für Admins von Vereinen: Turniere, zu denen ein Verein
// des Benutzers (Rolle admin, freigegeben) per "Turnier teilen" eingeladen wurde. Offen = die Anmeldung läuft noch
// (status_effektiv 'veroeffentlicht'); eigene Turniere des Vereins zählen nicht. Super-Admins ohne Vereinsrolle sehen nichts.
import { ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { TURNIER_SPALTEN_OHNE_PDF, ermittleEffektivenStatus } from './turnierController.js';

function parseListe(wert) {
    if (typeof wert !== 'string') return wert || [];
    try {
        return JSON.parse(wert);
    } catch {
        return wert ? wert.split(',') : [];
    }
}

export async function getTurnierEinladungen(knex, req, res) {
    try {
        const vereinIds = await ladeVereinIdsMitRolle(knex, req.user.id, 'admin');
        if (vereinIds.length === 0) return res.json([]);

        const zeilen = await knex('turnier_einladungen as e')
            .join('turniere as t', 't.id', 'e.turnier_id')
            .join('vereine as v', 'v.id', 'e.verein_id')
            .whereIn('e.verein_id', vereinIds)
            .where({ 't.archiviert': false })
            .whereNot('t.status', 'entwurf')
            .whereNotIn('t.verein_id', vereinIds)
            .select([...TURNIER_SPALTEN_OHNE_PDF.map((s) => `t.${s}`), knex.raw('(t.ausschreibung_pdf is not null) as hat_ausschreibung'), 'v.name as eingeladener_verein'])
            .orderBy('t.datum', 'asc');

        const jeTurnier = new Map();
        for (const z of zeilen) {
            const { eingeladener_verein: verein, ...turnier } = z;
            const eintrag = jeTurnier.get(turnier.id) || { ...turnier, eingeladene_vereine: [] };
            eintrag.eingeladene_vereine.push(verein);
            jeTurnier.set(turnier.id, eintrag);
        }
        const offene = [...jeTurnier.values()].filter((t) => ermittleEffektivenStatus(t) === 'veroeffentlicht');

        const ids = offene.map((t) => t.id);
        const counts = ids.length > 0
            ? await knex('turnier_teilnehmer').whereIn('turnier_id', ids).groupBy('turnier_id').select('turnier_id').count('* as anzahl')
            : [];
        const anzahl = Object.fromEntries(counts.map((c) => [c.turnier_id, parseInt(c.anzahl, 10)]));

        res.json(offene.map((t) => ({
            ...t,
            altersklassen: parseListe(t.altersklassen),
            mannschafts_altersklassen: parseListe(t.mannschafts_altersklassen),
            teilnehmer_anzahl: anzahl[t.id] || 0,
            status_effektiv: 'veroeffentlicht'
        })));
    } catch (error) {
        console.error('[Turnier-Einladungen]:', error);
        res.status(500).json({ error: 'Einladungen konnten nicht geladen werden.' });
    }
}
