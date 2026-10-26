// Bestätigung eines SEPA-Lastschriftmandats per Mail-Link (Startgeld Stufe 3). Der Einmal-Token (Zweck 'mandat')
// trägt die Berechtigung, deshalb laufen die Routen ohne Anmeldung (Muster freigabeController.js).
//   GET  /api/mandat/:token  zeigt Verein, Turnier, Mandatstext und die MASKIERTE IBAN; verbraucht den Token NICHT
//                            (Mail-Programme rufen Links vorab ab).
//   POST /api/mandat/:token  { entscheidung: 'bestaetigen'|'ablehnen', vertretung_bestaetigt } entscheidet einmalig.
// Antworten: 404 unbekannter Link, 410 schon entschieden/abgelaufen/zurückgezogen, 403 Konto ist kein Admin mehr.
import { FachFehler } from '../utils/fachFehler.js';
import { clientIp } from '../liveCloud/ratenbegrenzung.js';
import { tokenBekannt } from '../services/einmalToken.js';
import { ladeMandatFuerToken, entscheideMandat } from '../services/mandate.js';

const ZWECK = 'mandat';
const UNGUELTIG_TEXT = 'Dieser Link ist ungültig.';
const ENTSCHIEDEN_TEXT = 'Über dieses Mandat wurde schon entschieden, der Link ist abgelaufen oder das Mandat wurde zurückgezogen.';

function tokenAus(req) {
    const t = req.params && req.params.token;
    return typeof t === 'string' && t.length <= 200 ? t : '';
}

function antworteFehler(res, err) {
    if (err instanceof FachFehler) return res.status(err.statusCode).json({ success: false, error: err.message });
    console.error('[Mandat]', err?.message ?? err);
    return res.status(500).json({ success: false, error: 'Interner Serverfehler.' });
}

export function erzeugeMandatController(knex) {
    return {
        async zeige(req, res) {
            try {
                const token = tokenAus(req);
                const daten = token ? await ladeMandatFuerToken(knex, token) : null;
                if (!daten) {
                    const bekannt = token && await tokenBekannt(knex, token, ZWECK);
                    return res.status(bekannt ? 410 : 404).json({ success: false, error: bekannt ? ENTSCHIEDEN_TEXT : UNGUELTIG_TEXT });
                }
                // Nur das, was die Seite anzeigt: nie Klar-IBAN, Kontoinhaber im Klartext oder IP.
                res.json({
                    mandat: { iban_maske: daten.mandat.iban_maske, kontoinhaber_maske: daten.mandat.kontoinhaber_maske, mandatsreferenz: daten.mandat.mandatsreferenz },
                    mandatstext: daten.mandatstext,
                    vereinName: daten.vereinName,
                    turnierBezeichnung: daten.turnierBezeichnung
                });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async entscheide(req, res) {
            try {
                const token = tokenAus(req);
                if (!token) throw new FachFehler(404, UNGUELTIG_TEXT);
                const body = req.body || {};
                const mandat = await entscheideMandat(knex, token, {
                    entscheidung: body.entscheidung,
                    vertretung_bestaetigt: body.vertretung_bestaetigt,
                    ip: clientIp(req)
                });
                res.json({ success: true, mandat: { status: mandat.status, iban_maske: mandat.iban_maske, mandatsreferenz: mandat.mandatsreferenz } });
            } catch (err) {
                antworteFehler(res, err);
            }
        }
    };
}
