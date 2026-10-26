// Startgeld-Zahlweg (Stufe 1): API für Anmelder (eigener Verein) und Kasse (Ausrichter).
// Die Kasse autorisiert requireTournamentEditAccess (Ausrichter-Mitglied ab Rolle benutzer, Super-Admin im Modus,
// im Einzelbenutzerbetrieb jeder); GET/PUT für den eigenen Verein prüft der Controller selbst.
import { FachFehler } from '../utils/fachFehler.js';
import { ladeBenutzerMitAktivemVerein, ladeVerwaltendenVereinsnamen } from '../utils/vereinHelper.js';
import { ermittleEffektivenStatus } from './turnierController.js';
import { turnierHatEchteKaempfe } from './poolController.js';
import { ladeZahlwegFuerVerein, ladeVorbelegung, speichereZahlweg, ladeKasse, kassiereBar, erfasseVorOrt, ermittleAngeboteneZahlwege } from '../services/zahlwege.js';
import { startgeldVerlangt } from '../shared/zahlweg.js';
import { darfTurnierSehen } from '../services/turnierSichtbarkeit.js';
import { ermittleZahlungsempfaenger } from '../services/abrechnungStammdaten.js';
import { ladeStammdaten } from '../services/abrechnungStammdaten.js';
import { ladeAktivesMandat, mandatOeffentlich } from '../services/mandate.js';
import { baueMandatstext } from '../shared/mandatText.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { clientIp } from '../liveCloud/ratenbegrenzung.js';
import betriebsmodus from '../config/betriebsmodus.cjs';

function antworteFehler(res, err) {
    if (err instanceof FachFehler) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error('[Zahlweg]', err);
    return res.status(500).json({ success: false, error: 'Interner Serverfehler.' });
}

export function erzeugeZahlwegController(knex) {
    // Turnier, Anrufer und dessen verwaltender Verein (Rolle ab benutzer, freigegeben) für GET/PUT des eigenen Vereins.
    async function ladeKontext(req) {
        if (betriebsmodus.istEinzelbenutzerBetrieb()) {
            throw new FachFehler(409, 'Der Zahlweg wird bei der Anmeldung in der Cloud gewählt, nicht am Hallen-Server.');
        }
        const turnierId = parseInt(req.params.turnierId, 10);
        const turnier = Number.isInteger(turnierId) ? await knex('turniere').where({ id: turnierId }).first() : null;
        if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');
        const benutzer = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
        // Auch ein Super-Admin handelt hier nur als Mitglied seines aktiven Vereins.
        const vereinName = await ladeVerwaltendenVereinsnamen(knex, benutzer);
        if (!vereinName) {
            throw new FachFehler(403, 'Nur freigegebene Mitglieder eines Vereins (Rolle Benutzer oder Admin) wählen den Zahlweg.');
        }
        const istAusrichter = turnier.verein_id != null && benutzer.verein_id === turnier.verein_id;
        // Entwürfe, abgesagte und für den Verein unsichtbare Turniere gibt es für Nicht-Ausrichter nicht.
        if (!istAusrichter) {
            const effektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe: await turnierHatEchteKaempfe(knex, turnier.id) });
            if (['entwurf', 'abgesagt'].includes(effektiv) || !(await darfTurnierSehen(knex, benutzer, turnier))) {
                throw new FachFehler(404, 'Turnier nicht gefunden.');
            }
        }
        return { turnier, benutzer, vereinName, istAusrichter };
    }

    // Vorschau des Mandatstexts für den Dialog (Referenz wird erst beim Erteilen vergeben); nur wenn Lastschrift angeboten wird.
    async function baueMandatsvorschau(turnier, vereinName) {
        const stammdaten = turnier.verein_id ? await ladeStammdaten(knex, turnier.verein_id) : null;
        if (!stammdaten?.glaeubiger_id) return null;
        const glaeubigerName = stammdaten.absender_name || stammdaten.kontoinhaber;
        const vorabTage = turnier.vorabankuendigung_tage ?? 5;
        const mandatsreferenzMuster = 'wird bei Erteilung vergeben';
        return {
            mandatstext: baueMandatstext({
                glaeubigerName, glaeubigerId: stammdaten.glaeubiger_id, mandatsreferenz: mandatsreferenzMuster,
                vorabTage, turnierBezeichnung: turnier.bezeichnung, zahlenderVerein: vereinName
            }),
            glaeubigerId: stammdaten.glaeubiger_id,
            glaeubigerName,
            vorabTage,
            mandatsreferenzMuster
        };
    }

    async function istAnmeldungOffen(turnier) {
        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        return ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) === 'veroeffentlicht';
    }

    async function ladeKasseTurnier(req) {
        const turnierId = parseInt(req.params.turnierId, 10);
        const turnier = Number.isInteger(turnierId) ? await knex('turniere').where({ id: turnierId }).first() : null;
        if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');
        return turnier;
    }

    return {
        async lese(req, res) {
            try {
                const { turnier, benutzer, vereinName, istAusrichter } = await ladeKontext(req);
                const erforderlich = startgeldVerlangt(turnier) && !istAusrichter;
                const zahlweg = erforderlich ? await ladeZahlwegFuerVerein(knex, turnier.id, vereinName) : null;
                // Konto für den Girocode: nur wer per Überweisung zahlt, bekommt es (Turnierfelder vor Vereinskonto).
                // Bewusst freigegeben: dieses Empfängerkonto steht ohnehin auf Rechnungen und im Girocode des Zahlers.
                // Scheitert die Entschlüsselung (Schlüssel fehlt/geändert), bleibt es null; der Rest der Antwort ist unberührt.
                let empfaenger = null;
                if (zahlweg?.zahlweg === 'ueberweisung') {
                    try {
                        const e = await ermittleZahlungsempfaenger(knex, turnier);
                        if (e) empfaenger = { kontoinhaber: e.kontoinhaber, iban: e.iban, verwendungszweck: turnier.verwendungszweck || null };
                    } catch (fehler) {
                        console.error('[Zahlweg] Empfängerkonto nicht lesbar:', fehler?.code ?? '', fehler?.message ?? 'Fehler');
                    }
                }
                const angebotene = await ermittleAngeboteneZahlwege(knex, turnier);
                // Mandat nur maskiert (nie Klar-IBAN); Vorschau nur, wenn Lastschrift angeboten wird.
                const mandat = erforderlich ? mandatOeffentlich(await ladeAktivesMandat(knex, turnier.id, vereinName)) : null;
                const mandatsvorschau = erforderlich && angebotene.includes('lastschrift') ? await baueMandatsvorschau(turnier, vereinName) : null;
                res.json({
                    erforderlich,
                    empfaenger,
                    angebotene,
                    mandat,
                    mandatsvorschau,
                    istAdminDesVereins: benutzer.verein_rolle === 'admin',
                    startgeld: parseFloat(turnier.startgeld) || 0,
                    abrechnungsbasis: turnier.abrechnungsbasis,
                    zahlweg,
                    vorbelegung: erforderlich && !zahlweg ? await ladeVorbelegung(knex, vereinName) : null,
                    aenderbar: erforderlich && await istAnmeldungOffen(turnier)
                });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async speichere(req, res) {
            try {
                const { turnier, benutzer, vereinName, istAusrichter } = await ladeKontext(req);
                if (istAusrichter) {
                    throw new FachFehler(400, 'Der Ausrichter zahlt kein Startgeld, ein Zahlweg ist nicht nötig.');
                }
                const gespeichert = await speichereZahlweg(knex, {
                    turnier,
                    vereinName,
                    vereinId: benutzer.verein_id,
                    benutzerId: benutzer.id,
                    eingabe: req.body || {},
                    // Rolle im aktiven (= zahlenden) Verein des angemeldeten Kontos, nie aus dem Request-Body.
                    istAdminDesVereins: benutzer.verein_rolle === 'admin',
                    ip: clientIp(req),
                    basisUrl: ermittleBasisUrl(req)
                });
                res.json({
                    success: true,
                    zahlweg: gespeichert,
                    ...(gespeichert.zahlweg === 'lastschrift'
                        ? { bestaetigungNoetig: gespeichert.bestaetigungNoetig, mandat: gespeichert.mandat, empfaengerAnzahl: gespeichert.empfaengerAnzahl }
                        : {})
                });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async kasse(req, res) {
            try {
                const turnier = await ladeKasseTurnier(req);
                res.json({ eintraege: await ladeKasse(knex, turnier.id) });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        // Rechnungsdaten eines Vereins, der erst vor Ort auftaucht (Kasse am Wettkampftag, Zahlweg immer Bar).
        async erfasseVorOrt(req, res) {
            try {
                if (!betriebsmodus.istEinzelbenutzerBetrieb()) {
                    throw new FachFehler(409, 'Rechnungsdaten vor Ort werden nur am Hallen-Server erfasst; in der Cloud wählt der Verein seinen Zahlweg selbst.');
                }
                const turnier = await ladeKasseTurnier(req);
                const vereinName = req.body?.vereinName;
                if (typeof vereinName !== 'string' || !vereinName) {
                    throw new FachFehler(400, 'Vereinsname fehlt.');
                }
                const zahlweg = await erfasseVorOrt(knex, { turnier, vereinName, eingabe: req.body });
                res.json({ success: true, zahlweg });
            } catch (err) {
                antworteFehler(res, err);
            }
        },

        async kassiereBar(req, res) {
            try {
                const turnier = await ladeKasseTurnier(req);
                const vereinName = req.body?.vereinName;
                if (typeof vereinName !== 'string' || !vereinName) {
                    throw new FachFehler(400, 'Vereinsname fehlt.');
                }
                // Nur Bar-Zahler und Vereine ohne Zahlweg: Überweisungs- und Ausrichter-Kämpfer nie über diese Route.
                const kasse = await ladeKasse(knex, turnier.id);
                if (!kasse.some((e) => e.vereinName === vereinName)) {
                    throw new FachFehler(400, 'Dieser Verein steht nicht auf der Kassenliste.');
                }
                const anzahl = await kassiereBar(knex, turnier.id, vereinName);
                res.json({ success: true, anzahl });
            } catch (err) {
                antworteFehler(res, err);
            }
        }
    };
}
