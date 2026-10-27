// Freischaltung einer Beitrittsanfrage per Link aus der Mail (Helferverwaltung, Spec Abschnitt 4, Punkt 4/5).
// Der Einmal-Token (zweck 'freischaltung', src/services/einmalToken.js) trägt die Berechtigung, deshalb laufen
// die Routen ohne Anmeldung.
//   GET  /api/freigabe/:token  zeigt Antragsteller, Verein und vorbelegte Rolle; verbraucht den Token NICHT
//                              (Mail-Programme rufen Links vorab ab).
//   POST /api/freigabe/:token  { entscheidung: 'freigeben'|'ablehnen', rolle? } entscheidet einmalig. Erst nach der
//                              Prüfung von Entscheidung, Rolle und offener Anfrage wird der Token atomar verbraucht,
//                              ein Eingabefehler (400) lässt ihn gültig.
// Danach bekommt der Antragsteller eine Ergebnis-Mail; ein Mailfehler ändert am Ergebnis nichts.
import { sendeMail } from '../utils/mailer.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { helferAppAbsatz } from '../utils/helferAppLink.js';
import { pruefeToken, verbrauchePruefe, tokenBekannt } from '../services/einmalToken.js';
import { entscheideAnfrage } from '../services/vereinsRollen.js';
import { istGueltigeRolle } from '../shared/rollen.js';

export const GEBRAUCHT_TEXT = 'Diese Anfrage wurde bereits entschieden oder ist abgelaufen.';
const UNGUELTIG_TEXT = 'Dieser Freischaltungs-Link ist ungültig.';
const ZWECK = 'freischaltung';

export const ROLLEN_NAMEN = { admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' };

/** Vorbelegung der Rolle: Anfrage über die Helfer-App → Helfer, sonst Benutzer (der Entscheider kann ändern). */
export function vorbelegteRolle(angefragtUeber) {
    return angefragtUeber === 'helfer-app' ? 'helfer' : 'benutzer';
}

function tokenAus(req) {
    const t = req.params && req.params.token;
    return typeof t === 'string' ? t : '';
}

async function antwortOhneGueltigenToken(knex, token, res) {
    if (await tokenBekannt(knex, token, ZWECK)) {
        return res.status(410).json({ success: false, error: GEBRAUCHT_TEXT });
    }
    return res.status(404).json({ success: false, error: UNGUELTIG_TEXT });
}

/**
 * Lädt zu einem gültigen Token die noch offene Anfrage. null = Token gültig, aber die Anfrage ist schon
 * entschieden (z.B. über die Liste offener Anfragen) oder Konto/Verein gibt es nicht mehr.
 */
async function ladeOffeneAnfrage(knex, eintrag) {
    if (!eintrag.verein_id) return null;
    const [mitgliedschaft, benutzer, verein] = await Promise.all([
        knex('benutzer_vereine').where({ benutzer_id: eintrag.benutzer_id, verein_id: eintrag.verein_id }).first(),
        knex('benutzer').where({ id: eintrag.benutzer_id }).first(),
        knex('vereine').where({ id: eintrag.verein_id }).first()
    ]);
    if (!mitgliedschaft || mitgliedschaft.freigegeben || !benutzer || !verein) return null;
    return { mitgliedschaft, benutzer, verein };
}

export async function zeigeFreigabe(knex, req, res) {
    try {
        const token = tokenAus(req);
        const eintrag = await pruefeToken(knex, token, ZWECK);
        if (!eintrag) return antwortOhneGueltigenToken(knex, token, res);

        const anfrage = await ladeOffeneAnfrage(knex, eintrag);
        if (!anfrage) return res.status(410).json({ success: false, error: GEBRAUCHT_TEXT });

        const { benutzer, verein, mitgliedschaft } = anfrage;
        res.json({
            success: true,
            benutzer: { vorname: benutzer.vorname, nachname: benutzer.nachname, email: benutzer.email },
            verein: { id: verein.id, name: verein.name },
            vorbelegteRolle: vorbelegteRolle(mitgliedschaft.angefragt_ueber || eintrag.angefragt_ueber)
        });
    } catch (error) {
        console.error('[Freigabe-Anzeige-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Anfrage.' });
    }
}

async function sendeErgebnisMail(sende, benutzer, vereinName, entscheidung, rolle, basisUrl) {
    const freigegeben = entscheidung === 'freigeben';
    try {
        await sende({
            to: benutzer.email,
            subject: freigegeben
                ? `Hajime Pro: Du bist bei "${vereinName}" freigeschaltet`
                : `Hajime Pro: Deine Anfrage bei "${vereinName}"`,
            text: freigegeben
                ? `Hallo ${benutzer.vorname},

Du bist als ${ROLLEN_NAMEN[rolle]} bei ${vereinName} freigeschaltet. Du kannst dich jetzt in Hajime Pro anmelden.${rolle === 'helfer' ? helferAppAbsatz(basisUrl, '') : ''}`
                : `Hallo ${benutzer.vorname},

deine Anfrage beim Verein ${vereinName} wurde leider abgelehnt. Bei Fragen wende dich bitte direkt an den Verein.`
        });
    } catch (err) {
        // Die Entscheidung steht bereits; eine fehlende Mail darf daran nichts ändern.
        console.error('[Freigabe] Ergebnis-Mail fehlgeschlagen:', err.message);
    }
}

export async function entscheideFreigabe(knex, req, res, { sende = sendeMail } = {}) {
    try {
        const token = tokenAus(req);
        const { entscheidung, rolle } = req.body || {};

        const eintrag = await pruefeToken(knex, token, ZWECK);
        if (!eintrag) return antwortOhneGueltigenToken(knex, token, res);

        // Erst alle Eingaben prüfen: ein Fehler hier lässt den Token gültig.
        if (entscheidung !== 'freigeben' && entscheidung !== 'ablehnen') {
            return res.status(400).json({ success: false, error: 'Bitte „Freischalten“ oder „Ablehnen“ wählen.' });
        }
        if (entscheidung === 'freigeben' && !istGueltigeRolle(rolle)) {
            return res.status(400).json({ success: false, error: 'Bitte eine Rolle wählen (Admin, Benutzer oder Helfer).' });
        }
        const anfrage = await ladeOffeneAnfrage(knex, eintrag);
        if (!anfrage) return res.status(410).json({ success: false, error: GEBRAUCHT_TEXT });

        // Atomar verbrauchen: bei gleichzeitigen Klicks gewinnt genau einer.
        const verbraucht = await verbrauchePruefe(knex, token, ZWECK);
        if (!verbraucht) return res.status(410).json({ success: false, error: GEBRAUCHT_TEXT });

        const ergebnis = await entscheideAnfrage(knex, {
            vereinId: verbraucht.verein_id,
            benutzerId: verbraucht.benutzer_id,
            entscheiderId: null,
            perToken: true,
            entscheidung,
            rolle: entscheidung === 'freigeben' ? rolle : undefined
        });
        if (!ergebnis.ok) {
            // Inzwischen anderweitig entschieden (404/409) — für den Link heißt das: erledigt.
            if (ergebnis.status === 404 || ergebnis.status === 409) {
                return res.status(410).json({ success: false, error: GEBRAUCHT_TEXT });
            }
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }

        await sendeErgebnisMail(sende, anfrage.benutzer, anfrage.verein.name, entscheidung, rolle, ermittleBasisUrl(req));

        const name = `${anfrage.benutzer.vorname} ${anfrage.benutzer.nachname}`;
        res.json({
            success: true,
            entscheidung,
            rolle: entscheidung === 'freigeben' ? rolle : null,
            message: entscheidung === 'freigeben'
                ? `${name} ist jetzt als ${ROLLEN_NAMEN[rolle]} bei ${anfrage.verein.name} freigeschaltet.`
                : `Die Anfrage von ${name} bei ${anfrage.verein.name} wurde abgelehnt.`
        });
    } catch (error) {
        console.error('[Freigabe-Entscheidung-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Entscheidung.' });
    }
}
