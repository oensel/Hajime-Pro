// Startgeld-Abrechnung (Stufe 2): Stammdaten des Ausrichters und deren Prüfung für ein Turnier.
// Nur Cloud. `sende` (Mailversand) wird an den Rechnungslauf durchgereicht (Tests ersetzen ihn).
import { FachFehler } from '../utils/fachFehler.js';
import { darfVereinVerwalten } from '../services/vereinsRollen.js';
import { fehlendeStammdaten, fehlendeLastschriftDaten } from '../shared/abrechnung.js';
import { ladeStammdaten, speichereStammdaten, pruefeStammdatenFuerTurnier, ladeLastschriftStatus } from '../services/abrechnungStammdaten.js';
import { ladeAbrechnung, ordneVereinZu } from '../services/abrechnung.js';
import { erfasseVorOrt } from '../services/zahlwege.js';
import { erstelleRechnungen, sendeRechnungErneut, setzeBezahlt, ladeRechnungPdf, erfasseRuecklastschrift } from '../services/rechnungslauf.js';
import { erzeugeSepaExport, listeSepaDateien, pruefeSepaVorab } from '../services/sepaExport.js';
import { hatSperrendeRechnung } from '../services/rueckspielen.js';
import { pruefeSensibleAktion } from '../utils/sensibleAktion.js';
import { protokolliere, ladeKontext, beschreibeAktion } from '../services/aktionsProtokoll.js';
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

        // Rücklastschrift erfassen und den Verein auf Überweisung/Bar umstellen (Gate: requireTurnierAdmin). Bewusst OHNE
        // 2FA-Code für Super-Admins (anders als der SEPA-Download): es werden keine Kontodaten ausgeliefert und kein Geld
        // bewegt, nur ein Bankereignis festgehalten (wie „bezahlt“); die Aktion ist protokolliert und nicht umkehrbar.
        async erfasseRuecklastschrift(req, res) {
            try {
                const rechnungId = await pruefeRechnung(req);
                const ergebnis = await erfasseRuecklastschrift(knex, {
                    turnier: req.tournament, rechnungId, neuerZahlweg: req.body?.neuerZahlweg, benutzerId: req.user.id
                });
                // Eigener Eintrag mit Rechnung, neuem Zahlweg und Mandat (nie Kontodaten); die Middleware schreibt keinen zweiten.
                res.locals.protokolliert = true;
                const pfad = '/api/abrechnung/:id/rechnungen/:id/ruecklastschrift';
                const kontext = await ladeKontext(knex, req.user.id, { turnierId: req.tournament.id }).catch(() => null);
                const { aktion, beschreibung } = beschreibeAktion('POST', pfad);
                await protokolliere(knex, {
                    ...(kontext || { benutzerId: req.user.id }), turnierId: req.tournament.id, aktion, beschreibung,
                    methode: 'POST', pfad, status: 200,
                    details: { turnierId: req.tournament.id, rechnungId, neuerZahlweg: ergebnis.zahlweg.zahlweg, mandatId: ergebnis.mandatId }
                });
                res.json({ success: true, rechnung: ergebnis.rechnung, zahlweg: ergebnis.zahlweg });
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

        // SEPA-Lastschriftdatei (Gate: requireTurnierAdmin). Super-Admins IMMER mit aktuellem Code (X-2FA-Code), eine frische
        // Anmeldung genügt hier nicht. Die Datei enthält Klar-IBANs: nie gespeichert, nie im Protokoll, nicht zwischengespeichert.
        async erzeugeSepa(req, res) {
            try {
                nurCloud();
                // Reihenfolge: Anmeldung/Rechte (Gate) -> Eingabe und billige Fachprüfung (400/409, ohne Kontodaten) ->
                // 2FA-Code (verbraucht ihn) -> Arbeit. So kostet eine ohnehin scheiternde Anfrage keinen Einmal-Code;
                // die Vorprüfung gibt nur Auskünfte, die der Admin ohnehin sehen darf.
                const body = req.body && typeof req.body === 'object' ? req.body : {};
                const auftrag = { turnier: req.tournament, neu: body.neu ?? false, rechnungIds: body.rechnungIds ?? null };
                await pruefeSepaVorab(knex, auftrag);
                const pruefung = await pruefeSensibleAktion(knex, req, { frischeAnmeldungGenuegt: false });
                if (!pruefung.ok) return res.status(pruefung.status).json({ success: false, error: pruefung.error, code: pruefung.code });
                const ergebnis = await erzeugeSepaExport(knex, { ...auftrag, benutzerId: req.user.id });
                // Ein eigener Eintrag mit Anzahl/Summe (ohne Kontodaten); die allgemeine Middleware schreibt dann keinen zweiten.
                res.locals.protokolliert = true;
                const kontext = await ladeKontext(knex, req.user.id, { turnierId: req.tournament.id }).catch(() => null);
                const { aktion, beschreibung } = beschreibeAktion('POST', '/api/abrechnung/:id/sepa');
                await protokolliere(knex, {
                    ...(kontext || { benutzerId: req.user.id }), turnierId: req.tournament.id, aktion, beschreibung,
                    methode: 'POST', pfad: '/api/abrechnung/:id/sepa', status: 200,
                    details: { turnierId: req.tournament.id, anzahl: ergebnis.anzahl, summeCent: ergebnis.summeCent, sepaDateiId: ergebnis.sepaDateiId }
                });
                res.setHeader('Content-Type', 'application/xml; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${String(ergebnis.dateiname).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('X-Sepa-Datei-Id', String(ergebnis.sepaDateiId));
                // Header nur ASCII und kurz (URL-kodiert, höchstens rund 1 KB; Oberfläche: decodeURIComponent).
                // Die vollständige Warnung liefert GET /:turnierId/sepa je Datei.
                if (ergebnis.warnungHeader) res.setHeader('X-Sepa-Warnung', ergebnis.warnungHeader);
                res.status(200).send(ergebnis.xml);
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async listeSepa(req, res) {
            try {
                nurCloud();
                res.setHeader('Cache-Control', 'no-store');
                res.json({ dateien: await listeSepaDateien(knex, req.tournament.id) });
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
                if (!(await hatSperrendeRechnung(knex, req.tournament.id))) throw new FachFehler(400, 'Es wurde noch keine Rechnung versandt, ein erneutes Zurückspielen braucht keine Freigabe.');
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
                res.json({ stammdaten, fehlt: fehlendeStammdaten(stammdaten, null), fehltLastschrift: fehlendeLastschriftDaten(stammdaten, null) });
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
                const lastschrift = await ladeLastschriftStatus(knex, turnier);
                const stammdaten = turnier.verein_id ? await ladeStammdaten(knex, turnier.verein_id) : null;
                res.json({ vollstaendig, fehlt, fehltLastschrift: fehlendeLastschriftDaten(stammdaten, turnier), vereinId: turnier.verein_id ?? null, darfPflegen, lastschrift });
            } catch (err) {
                antworteFehler(res, err);
            }
        }
    };
}
