// Startgeld-Abrechnung (Stufe 2): Stammdaten des Ausrichters und deren Prüfung für ein Turnier.
// Nur Cloud. `sende` (Mailversand) nimmt der Controller für die späteren Rechnungsrouten entgegen.
import { FachFehler } from '../utils/fachFehler.js';
import { darfVereinVerwalten } from '../services/vereinsRollen.js';
import { fehlendeStammdaten } from '../shared/abrechnung.js';
import { ladeStammdaten, speichereStammdaten, pruefeStammdatenFuerTurnier } from '../services/abrechnungStammdaten.js';
import betriebsmodus from '../config/betriebsmodus.cjs';

function antworteFehler(res, err) {
    if (err instanceof FachFehler) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[Abrechnung]', err);
    return res.status(500).json({ success: false, error: 'Interner Serverfehler.' });
}

export function erzeugeAbrechnungController(knex, { sende } = {}) {
    void sende;

    function nurCloud() {
        if (betriebsmodus.istEinzelbenutzerBetrieb()) {
            throw new FachFehler(409, 'Die Abrechnung gibt es nur in der Cloud.');
        }
    }

    async function pruefeVereinsRecht(req) {
        nurCloud();
        const vereinId = parseInt(req.params.vereinId, 10);
        if (!Number.isInteger(vereinId)) throw new FachFehler(404, 'Verein nicht gefunden.');
        if (!(await darfVereinVerwalten(knex, req.user.id, vereinId))) {
            throw new FachFehler(403, 'Nur Admins des Vereins dürfen die Abrechnungsdaten sehen und ändern.');
        }
        if (!(await knex('vereine').where({ id: vereinId }).first())) throw new FachFehler(404, 'Verein nicht gefunden.');
        return vereinId;
    }

    return {
        async leseStammdaten(req, res) {
            try {
                const vereinId = await pruefeVereinsRecht(req);
                const stammdaten = await ladeStammdaten(knex, vereinId);
                res.json({ stammdaten, fehlt: fehlendeStammdaten(stammdaten, null) });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async speichereStammdaten(req, res) {
            try {
                const vereinId = await pruefeVereinsRecht(req);
                const stammdaten = await speichereStammdaten(knex, vereinId, req.body, req.user.id);
                res.json({ success: true, stammdaten });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        // Für jedes freigegebene Ausrichter-Mitglied ab Rolle benutzer (Gate: requireTournamentEditAccess), ohne Feldinhalte.
        async pruefeStammdaten(req, res) {
            try {
                nurCloud();
                const turnier = req.tournament;
                const { vollstaendig, fehlt } = await pruefeStammdatenFuerTurnier(knex, turnier);
                const darfPflegen = turnier.verein_id ? await darfVereinVerwalten(knex, req.user.id, turnier.verein_id) : false;
                res.json({ vollstaendig, fehlt, vereinId: turnier.verein_id ?? null, darfPflegen });
            } catch (err) {
                antworteFehler(res, err);
            }
        }
    };
}
