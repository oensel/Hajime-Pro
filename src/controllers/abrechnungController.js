// Startgeld-Abrechnung (Stufe 2): Stammdaten des Ausrichters und deren Prüfung für ein Turnier.
// Nur Cloud. `sende` (Mailversand) wird an den Rechnungslauf durchgereicht (Tests ersetzen ihn).
import { FachFehler } from '../utils/fachFehler.js';
import { darfVereinVerwalten } from '../services/vereinsRollen.js';
import { fehlendeStammdaten } from '../shared/abrechnung.js';
import { ladeStammdaten, speichereStammdaten, pruefeStammdatenFuerTurnier } from '../services/abrechnungStammdaten.js';
import { ladeAbrechnung, ordneVereinZu } from '../services/abrechnung.js';
import { erfasseVorOrt } from '../services/zahlwege.js';
import { erstelleRechnungen, sendeRechnungErneut, setzeBezahlt, ladeRechnungPdf } from '../services/rechnungslauf.js';
import betriebsmodus from '../config/betriebsmodus.cjs';

function antworteFehler(res, err) {
    if (err instanceof FachFehler) {
        // Abgebrochener Rechnungslauf: das Teilergebnis (bereits erstellte/versendete Rechnungen) mitliefern.
        return res.status(err.statusCode).json({ success: false, error: err.message, ...(err.code === 'rechnungslauf_abgebrochen' && err.daten ? { ergebnis: err.daten } : {}) });
    }
    console.error('[Abrechnung]', err?.code ?? '', err?.message ?? 'Fehler'); // nie das Fehlerobjekt: Knex-Fehler enthalten Bindings
    return res.status(500).json({ success: false, error: 'Interner Serverfehler.' });
}

export function erzeugeAbrechnungController(knex, { sende } = {}) {
    const versand = sende ? { sende } : {};

    function nurCloud() {
        if (betriebsmodus.istEinzelbenutzerBetrieb()) {
            throw new FachFehler(409, 'Die Abrechnung gibt es nur in der Cloud.');
        }
    }

    async function pruefeVereinsRecht(req) {
        nurCloud();
        const vereinId = /^\d+$/.test(String(req.params.vereinId)) ? parseInt(req.params.vereinId, 10) : NaN;
        if (!Number.isInteger(vereinId)) throw new FachFehler(404, 'Verein nicht gefunden.');
        if (!(await darfVereinVerwalten(knex, req.user.id, vereinId))) {
            throw new FachFehler(403, 'Nur Admins des Vereins dürfen die Abrechnungsdaten sehen und ändern.');
        }
        if (!(await knex('vereine').where({ id: vereinId }).first())) throw new FachFehler(404, 'Verein nicht gefunden.');
        return vereinId;
    }

    // Die Rechnung muss zum vom Gate geprüften Turnier gehören, sonst 404 (auch bei ungültiger ID).
    async function pruefeRechnung(req) {
        nurCloud();
        const roh = String(req.params.rechnungId ?? '');
        const rechnungId = /^\d+$/.test(roh) && Number(roh) <= 2147483647 ? Number(roh) : null;
        const zeile = rechnungId == null ? null
            : await knex('rechnungen').where({ id: rechnungId, turnier_id: req.tournament.id }).first('id');
        if (!zeile) throw new FachFehler(404, 'Rechnung nicht gefunden.');
        return rechnungId;
    }

    return {
        // Rechnungslauf: je Verein Rechnung/Quittung erstellen und versenden.
        async erstelleRechnungen(req, res) {
            try {
                nurCloud();
                res.json(await erstelleRechnungen(knex, { turnier: req.tournament, benutzerId: req.user.id, ...versand }));
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async sendeErneut(req, res) {
            try {
                const rechnungId = await pruefeRechnung(req);
                res.json(await sendeRechnungErneut(knex, rechnungId, versand));
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async setzeBezahlt(req, res) {
            try {
                const rechnungId = await pruefeRechnung(req);
                const rechnung = await setzeBezahlt(knex, rechnungId, { bezahlt: req.body?.bezahlt, benutzerId: req.user.id });
                res.json({ success: true, rechnung });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async ladePdf(req, res) {
            try {
                const rechnungId = await pruefeRechnung(req);
                const { nummer, pdf } = await ladeRechnungPdf(knex, rechnungId);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${String(nummer).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`);
                res.setHeader('Cache-Control', 'no-store');
                res.end(Buffer.from(pdf));
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        // Übersicht je Verein (Admin des Ausrichters, Gate: requireTurnierAdmin).
        async lade(req, res) {
            try {
                nurCloud();
                res.json(await ladeAbrechnung(knex, req.tournament));
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async ordneZu(req, res) {
            try {
                nurCloud();
                const anzahl = await ordneVereinZu(knex, req.tournament.id, {
                    vonVereinName: req.body?.vonVereinName, zuVereinName: req.body?.zuVereinName
                });
                res.json({ success: true, anzahl });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        // Rechnungsdaten für einen Verein ohne gewählten Zahlweg: Zahlweg immer Bar.
        async erfasseRechnungsdaten(req, res) {
            try {
                nurCloud();
                const vereinName = req.body?.vereinName;
                if (typeof vereinName !== 'string' || !vereinName) throw new FachFehler(400, 'Vereinsname fehlt.');
                const zeile = await erfasseVorOrt(knex, { turnier: req.tournament, vereinName, eingabe: req.body });
                res.json({ success: true, zahlweg: { verein_name: zeile.verein_name, zahlweg: zeile.zahlweg } });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        // Erlaubt ein weiteres Zurückspielen nach versandten Rechnungen (wird vom nächsten Rückspielen verbraucht).
        async gibRueckspielenFrei(req, res) {
            try {
                nurCloud();
                const versandt = await knex('rechnungen').where({ turnier_id: req.tournament.id }).whereNotNull('versandt_am').first('id');
                if (!versandt) throw new FachFehler(400, 'Es wurde noch keine Rechnung versandt, ein erneutes Zurückspielen braucht keine Freigabe.');
                await knex('turniere').where({ id: req.tournament.id }).update({ rueckspielen_freigegeben: true });
                res.json({ success: true });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

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
