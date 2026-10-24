import crypto from 'node:crypto';
import { hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein } from '../utils/vereinHelper.js';
import { normalisiereSichtbarkeit, filtereSichtbareTurniere, darfTurnierSehen } from '../services/turnierSichtbarkeit.js';
import { gueltigeFarbe } from '../shared/kampfFarbe.js';
import { exportiereVorlagen, importiereVorlagen } from '../services/urkundenVorlagenTransfer.js';
import { exportiereHelferplan, ersetzeHelferplan } from '../services/helferTransfer.js';
import { exportiereOrga, ersetzeOrga } from '../services/orgaTransfer.js';
import { erzeugeToken } from '../liveCloud/token.js';
import { istLiveApiAktiv } from '../liveCloud/liveApiAktiv.js';
import { entfernungZuPlzInKm } from '../utils/entfernungHelper.js';
import { turnierHatEchteKaempfe } from './poolController.js';
import { FachFehler } from '../utils/fachFehler.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { legeAusVorlageAn, berechneFaelligkeitenNeu, ladeOrga } from '../services/orgaPlan.js';
import { datumAlsText } from '../services/helferPlan.js';
import { findeTerminKonflikt, ermittleAktivierbarkeit, kopiereTeilnehmerFuerNeuesTurnier, datumAlsIso } from '../shared/turnierAktivierung.js';
const { istEinzelbenutzerBetrieb } = betriebsmodus;

// Anmeldeschluss wird als reines Datum (ohne Uhrzeit) gespeichert; die Frist gilt bis
// einschließlich 24:00 Uhr Ortszeit dieses Tages (identische Logik zu teilnehmerController.js).
// setHours (lokale Zeit) statt setUTCHours, da UTC-Mitternacht je nach Zeitzone des Servers
// mehrere Stunden von der tatsächlichen deutschen Ortszeit abweicht.
function berechneAnmeldefrist(anmeldeschluss) {
    const deadline = new Date(anmeldeschluss);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(anmeldeschluss).trim())) {
        deadline.setHours(23, 59, 59, 999);
    }
    return deadline;
}

// Export und Ergebnis-Upload sind erst sinnvoll, wenn sich die Anmeldungen nicht mehr ändern
// können — ohne hinterlegte Frist gilt sie als noch nicht abgelaufen (sicherer Default).
function istAnmeldefristAbgelaufen(turnier) {
    if (!turnier.anmeldeschluss) return false;
    return new Date() > berechneAnmeldefrist(turnier.anmeldeschluss);
}

// Nur 'entwurf' | 'veroeffentlicht' | 'abgeschlossen' | 'abgesagt' werden physisch gespeichert.
// 'anmeldung_geschlossen' und 'in_durchfuehrung' sind reine Ableitungen (kein Cronjob nötig).
// "Keine Online-Aktionen" während der Durchführung betrifft die vereinsübergreifende Anmeldung/
// Stammdaten-Bearbeitung (bereits durch dieselbe Prüfung gesperrt) — Pools/Matten/Kampf-Seiten
// sind ohnehin schon auf den ausrichtenden Verein beschränkt und bleiben davon unberührt.
export function ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {}) {
    if (turnier.status !== 'veroeffentlicht') return turnier.status;

    const heuteStr = new Date().toISOString().slice(0, 10);
    const wettkampftagErreicht = turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;
    if (wettkampftagErreicht || hatEchteKaempfe) return 'in_durchfuehrung';
    if (istAnmeldefristAbgelaufen(turnier)) return 'anmeldung_geschlossen';
    return 'veroeffentlicht';
}

const GUELTIGE_STATUS_WERTE = ['entwurf', 'veroeffentlicht', 'abgeschlossen', 'abgesagt'];

// Alle Spalten außer der PDF-Binärdatei selbst — für Listen-/Auswahl-Abfragen, die die
// Ausschreibung nur als "vorhanden ja/nein" (siehe hat_ausschreibung) benötigen und die
// potenziell mehrere MB große Binärspalte nicht aus der DB laden sollen.
export const TURNIER_SPALTEN_OHNE_PDF = [
    'id', 'bezeichnung', 'ort', 'plz', 'bundesland', 'datum', 'ausrichter',
    'nutze_gewichtsklassen', 'anzahl_kampfflaechen', 'verein_id', 'altersklassen',
    'mannschafts_altersklassen', 'status', 'anmeldeschluss', 'startgeld', 'iban',
    'kontoinhaber', 'verwendungszweck', 'ausschreibung_dateiname', 'farbe_kaempfer2',
    'beginn_min', 'ende_min', 'waagen_anzahl', 'planungs_tools', 'sichtbarkeit', 'created_at', 'updated_at'
];

const AUSSCHREIBUNG_MAX_MB = 10;
const AUSSCHREIBUNG_MAX_BYTES = AUSSCHREIBUNG_MAX_MB * 1024 * 1024;

// Baut das Update-Fragment für die Ausschreibungs-PDF aus dem Request-Body:
// - String (Base64) -> neue/ersetzte PDF wird gespeichert
// - null -> Nutzer hat "PDF entfernen" geklickt, Spalten werden geleert
// - undefined (Feld gar nicht im Body) -> unverändert lassen, leeres Fragment
// Gibt bei zu großer Datei einen Fehlertext statt eines Fragments zurück.
function baueAusschreibungFragment(ausschreibungPdfBase64, ausschreibungDateiname) {
    if (ausschreibungPdfBase64 === null) {
        return { fragment: { ausschreibung_pdf: null, ausschreibung_dateiname: null } };
    }
    if (typeof ausschreibungPdfBase64 === 'string' && ausschreibungPdfBase64.trim() !== '') {
        const buffer = Buffer.from(ausschreibungPdfBase64, 'base64');
        if (buffer.length > AUSSCHREIBUNG_MAX_BYTES) {
            return { fehler: `Die Ausschreibung ist zu groß (max. ${AUSSCHREIBUNG_MAX_MB} MB).` };
        }
        return {
            fragment: {
                ausschreibung_pdf: buffer,
                ausschreibung_dateiname: ausschreibungDateiname || 'Ausschreibung.pdf'
            }
        };
    }
    return { fragment: {} };
}

// Wird ein Startgeld verlangt, müssen die Zahlungsdaten vollständig sein, sonst kann später
// niemand zuverlässig bezahlen (fehlende IBAN/Kontoinhaber/Verwendungszweck).
function validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck) {
    const startgeldWert = startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : 0;
    if (startgeldWert > 0) {
        if (!iban || !iban.trim() || !kontoinhaber || !kontoinhaber.trim() || !verwendungszweck || !verwendungszweck.trim()) {
            return 'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.';
        }
    }
    return null;
}

// Turnierzeit für den Helferplan (Spec Helferverwaltung 7): beginn_min/ende_min als ganze Minuten seit
// Mitternacht (0..1439, also bis 23:59, optional, ende > beginn), waagen_anzahl 1..10. `bisher` = gespeicherte Werte (Update):
// nicht mitgesendete Felder bleiben unverändert, leer ('' / null) entfernt die Uhrzeit.
const MAX_TAGESMINUTE = 1439; // 23:59
function leseTurnierzeit(body, bisher = null) {
    const fragment = {};
    const minuten = (wert, name) => {
        if (wert === null || wert === '') return null;
        const n = Number(wert);
        if (!Number.isInteger(n) || n < 0 || n > MAX_TAGESMINUTE) {
            throw new FachFehler(400, `${name} muss eine Uhrzeit zwischen 00:00 und 23:59 in ganzen Minuten sein.`);
        }
        return n;
    };
    if (body.beginn_min !== undefined) fragment.beginn_min = minuten(body.beginn_min, 'Der Turnierbeginn');
    if (body.ende_min !== undefined) fragment.ende_min = minuten(body.ende_min, 'Das Turnierende');
    if (body.waagen_anzahl !== undefined && body.waagen_anzahl !== null && body.waagen_anzahl !== '') {
        const n = Number(body.waagen_anzahl);
        if (!Number.isInteger(n) || n < 1 || n > 10) throw new FachFehler(400, 'Die Anzahl der Waagen muss zwischen 1 und 10 liegen.');
        fragment.waagen_anzahl = n;
    }
    const beginn = 'beginn_min' in fragment ? fragment.beginn_min : bisher?.beginn_min ?? null;
    const ende = 'ende_min' in fragment ? fragment.ende_min : bisher?.ende_min ?? null;
    if (beginn != null && ende != null && ende <= beginn) {
        throw new FachFehler(400, 'Das Turnierende muss nach dem Turnierbeginn liegen.');
    }
    return fragment;
}

// Planungs-Tools (Helfer-Dienste/Vorbereitung): Standard beim Anlegen in der Cloud an, am Hallen-Server aus.
// Update: nicht mitgesendet -> unverändert.
function planungsToolsWert(wert, standard) {
    if (wert === undefined || wert === null || wert === '') return standard;
    return wert === true || wert === 1 || wert === '1' || wert === 'true';
}

// Turnierzeit aus einer Exportdatei, nachsichtig: ungültige oder fehlende Werte (ältere Dateien) werden
// leer (Beginn/Ende) bzw. 1 (Waagen), statt den Import abzubrechen; ein Turnierende 24:00 (1440) wird 23:59.
function importTurnierzeit(t) {
    const ganz = (w) => (w === null || w === undefined || w === '' || !Number.isInteger(Number(w)) ? null : Number(w));
    let beginn = ganz(t.beginn_min);
    let ende = ganz(t.ende_min);
    if (ende === 1440) ende = MAX_TAGESMINUTE;
    if (beginn != null && (beginn < 0 || beginn > MAX_TAGESMINUTE)) beginn = null;
    if (ende != null && (ende < 0 || ende > MAX_TAGESMINUTE)) ende = null;
    if (beginn != null && ende != null && ende <= beginn) { beginn = null; ende = null; }
    const waagen = ganz(t.waagen_anzahl);
    return { beginn_min: beginn, ende_min: ende, waagen_anzahl: waagen != null && waagen >= 1 && waagen <= 10 ? waagen : 1 };
}

// Ein Turnier pro Tag (Spec mehrere Turniere): nur am Hallen-Server mit Sync, also dort, wo mehrere
// Turniere nacheinander ausgetragen werden. Die Cloud kennt parallele Turniere verschiedener Vereine.
async function pruefeTerminFrei(knex, sync, datum, ausserId = null) {
    if (!sync) return;
    const turniere = await knex('turniere').select('id', 'bezeichnung', 'datum', 'status');
    const konflikt = findeTerminKonflikt(turniere, datum, ausserId);
    if (konflikt) {
        throw new FachFehler(409, `Am ${datumAlsIso(datum).split('-').reverse().join('.')} findet bereits das Turnier „${konflikt.bezeichnung}“ statt. Zwei Turniere dürfen sich nicht überschneiden.`);
    }
}

export async function createTurnier(knex, req, res) {
    try {
        const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, plz, altersklassen, mannschafts_altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck, ausschreibung_pdf_base64, ausschreibung_dateiname, farbe_kaempfer2 } = req.body;
        const userId = req.user.id; // Logged in user ID from middleware

        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const { fragment: ausschreibungFragment, fehler: ausschreibungFehler } = baueAusschreibungFragment(ausschreibung_pdf_base64, ausschreibung_dateiname);
        if (ausschreibungFehler) {
            return res.status(400).json({ success: false, error: ausschreibungFehler });
        }
        const turnierzeit = leseTurnierzeit(req.body);

        // Turnier wird an den Verein des anlegenden Benutzers gekoppelt (nicht mehr an
        // den Benutzer selbst), und zwar an seinen aktiven Verein. Im Super-Admin-Modus gibt es keinen
        // „eigenen“ Verein: dort wählt der Super-Admin den ausrichtenden Verein aus der Vereinsliste (verein_id).
        const user = await ladeBenutzerMitAktivemVerein(knex, userId);
        let vereinId = user ? user.verein_id : null;
        if (user && user.super_admin_aktiv && !istEinzelbenutzerBetrieb()) {
            const gewaehlt = /^\d+$/.test(String(req.body.verein_id ?? '')) ? parseInt(req.body.verein_id, 10) : null;
            const verein = gewaehlt ? await knex('vereine').where({ id: gewaehlt }).first('id') : null;
            if (!verein) {
                return res.status(400).json({ success: false, error: 'Bitte den ausrichtenden Verein aus der Liste wählen.' });
            }
            vereinId = verein.id;
        }
        if (!vereinId) {
            return res.status(400).json({ success: false, error: 'Bitte zuerst einen aktiven Verein wählen.' });
        }

        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        const wertFuerDB = (nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true') ? 1 : 0;

        const altersklassenDB = typeof altersklassen === 'string' ? altersklassen : JSON.stringify(altersklassen || {});
        const mannschaftsAltersklassenDB = typeof mannschafts_altersklassen === 'string' ? mannschafts_altersklassen : JSON.stringify(mannschafts_altersklassen || []);

        // Hallen-Server: weitere Turniere entstehen als Entwurf neben dem aktiven; aktiviert wird per
        // Knopf am Wettkampftag (aktiviereTurnierRoute).
        const sync = req.app.get('sync');
        await pruefeTerminFrei(knex, sync, datum);

        const [idObj] = await knex('turniere').insert({
            bezeichnung,
            ort,
            datum,
            ausrichter,
            anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
            nutze_gewichtsklassen: wertFuerDB,
            verein_id: vereinId,
            bundesland: bundesland || null,
            plz: plz || null,
            altersklassen: altersklassenDB,
            mannschafts_altersklassen: mannschaftsAltersklassenDB,
            status: 'entwurf', // neue Turniere starten immer im Entwurf (Zustand 1 der Spezifikation)
            anmeldeschluss: anmeldeschluss || null,
            startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
            iban: iban || null,
            kontoinhaber: kontoinhaber || null,
            verwendungszweck: verwendungszweck || null,
            farbe_kaempfer2: gueltigeFarbe(farbe_kaempfer2) || 'blau',
            ...turnierzeit,
            planungs_tools: planungsToolsWert(req.body.planungs_tools, !istEinzelbenutzerBetrieb()),
            sichtbarkeit: normalisiereSichtbarkeit(req.body.sichtbarkeit),
            ...ausschreibungFragment
        }).returning('id');

        const turnierId = typeof idObj === 'object' ? idObj.id : idObj;
        await synchronisiereKampfflaechen(knex, turnierId, parseInt(anzahl_kampfflaechen) || 1);
        if (bundesland) await knex('vereine').where({ id: vereinId }).where(function () { this.whereNull('bundesland').orWhere('bundesland', ''); }).update({ bundesland });
        // Orga-Planer: Standardvorlage anlegen (nur mit Planungs-Tools; Best-Effort, ein Fehler darf das Anlegen nicht scheitern lassen).
        if (planungsToolsWert(req.body.planungs_tools, !istEinzelbenutzerBetrieb())) {
            try {
                await legeAusVorlageAn(knex, turnierId);
            } catch (orgaFehler) {
                console.error('Orga-Planer: Vorlage konnte nicht angelegt werden:', orgaFehler);
            }
        }
        res.status(201).json({ success: true, turnierId });
    } catch (error) {
        if (error instanceof FachFehler) return res.status(error.statusCode).json({ success: false, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, plz, altersklassen, mannschafts_altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck, ausschreibung_pdf_base64, ausschreibung_dateiname, farbe_kaempfer2 } = req.body;

        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const { fragment: ausschreibungFragment, fehler: ausschreibungFehler } = baueAusschreibungFragment(ausschreibung_pdf_base64, ausschreibung_dateiname);
        if (ausschreibungFehler) {
            return res.status(400).json({ success: false, error: ausschreibungFehler });
        }

        const bestehendesTurnier = await knex('turniere').where({ id }).first();
        if (!bestehendesTurnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        // 'abgeschlossen' wird nie abgeleitet, sondern immer direkt gespeichert -> Statusvergleich reicht.
        if (bestehendesTurnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier befindet sich im schreibgeschützten Archiv-Zustand.' });
        }
        const turnierzeit = leseTurnierzeit(req.body, bestehendesTurnier);

        if (datum) await pruefeTerminFrei(knex, req.app.get('sync'), datum, id);

        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        const wertFuerDB = (nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true') ? 1 : 0;

        const altersklassenDB = typeof altersklassen === 'string' ? altersklassen : JSON.stringify(altersklassen || {});
        const mannschaftsAltersklassenDB = typeof mannschafts_altersklassen === 'string' ? mannschafts_altersklassen : JSON.stringify(mannschafts_altersklassen || []);

        // verein_id wird hier absichtlich nicht angefasst — die Vereinszuordnung ist nach der
        // Anlage unveränderlich, damit kein Mitglied das Turnier einem anderen Verein zuordnen
        // und sich selbst (und den eigenen Verein) aussperren kann. "ausrichter" ist nur noch
        // ein Anzeigetext und darf frei bearbeitet werden.
        await knex('turniere').where({ id }).update({
            bezeichnung,
            ort,
            datum,
            ausrichter,
            anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
            nutze_gewichtsklassen: wertFuerDB,
            bundesland: bundesland || null,
            plz: plz || null,
            altersklassen: altersklassenDB,
            mannschafts_altersklassen: mannschaftsAltersklassenDB,
            anmeldeschluss: anmeldeschluss || null,
            startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
            iban: iban || null,
            kontoinhaber: kontoinhaber || null,
            verwendungszweck: verwendungszweck || null,
            // Nicht mitgesendet -> unverändert lassen
            ...(gueltigeFarbe(farbe_kaempfer2) ? { farbe_kaempfer2 } : {}),
            ...turnierzeit,
            ...(req.body.planungs_tools !== undefined ? { planungs_tools: planungsToolsWert(req.body.planungs_tools, true) } : {}),
            ...(req.body.sichtbarkeit !== undefined ? { sichtbarkeit: normalisiereSichtbarkeit(req.body.sichtbarkeit, bestehendesTurnier.sichtbarkeit || 'alle') } : {}),
            ...ausschreibungFragment,
            updated_at: knex.fn.now()
        });

        await synchronisiereKampfflaechen(knex, parseInt(id), parseInt(anzahl_kampfflaechen) || 1);

        // Planungs-Tools eingeschaltet: Standarddienste (Matten, Waagen) und Orga-Vorlage jetzt anlegen
        if (planungsToolsWert(req.body.planungs_tools, false)) {
            try {
                const { synchronisiereWennAktiv } = await import('../services/helferPlan.js');
                await synchronisiereWennAktiv(knex, parseInt(id));
                await legeAusVorlageAn(knex, parseInt(id));
            } catch (err) {
                console.error('[Planungs-Tools-Anlegen]:', err.message);
            }
        }

        // Orga-Planer: Fälligkeiten folgen Turniertag/Anmeldeschluss (Best-Effort).
        if (datumAlsText(bestehendesTurnier.datum) !== datumAlsText(datum)
            || datumAlsText(bestehendesTurnier.anmeldeschluss) !== datumAlsText(anmeldeschluss || null)) {
            try {
                await berechneFaelligkeitenNeu(knex, parseInt(id));
            } catch (orgaFehler) {
                console.error('Orga-Planer: Fälligkeiten konnten nicht neu berechnet werden:', orgaFehler);
            }
        }

        res.json({ success: true, message: 'Turnier erfolgreich aktualisiert.' });
    } catch (error) {
        if (error instanceof FachFehler) return res.status(error.statusCode).json({ success: false, error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTurnier(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: req.params.id }).first();
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });

        // Entwurf: nur für Mitglieder des ausrichtenden Vereins sichtbar (Zustand 1: "Nur für
        // den Ersteller sichtbar"). Offline-Betrieb ist Single-Tenant und bleibt ausgenommen.
        if (statusEffektiv === 'entwurf' && !istEinzelbenutzerBetrieb()) {
            const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
            if (!hatVereinsZugriffAufTurnier(user, turnier)) {
                return res.status(403).json({ error: 'Dieses Turnier befindet sich noch im Entwurf und ist nicht sichtbar.' });
            }
        }

        if (!istEinzelbenutzerBetrieb() && !(await darfTurnierSehen(knex, await ladeBenutzerMitAktivemVerein(knex, req.user.id), turnier))) {
            return res.status(404).json({ error: 'Turnier nicht gefunden.' });
        }

        // Altersklassen parsen
        let ak = turnier.altersklassen;
        if (typeof ak === 'string') {
            try {
                ak = JSON.parse(ak);
            } catch (e) {
                ak = ak ? ak.split(',') : [];
            }
        }
        turnier.altersklassen = ak || [];

        let mak = turnier.mannschafts_altersklassen;
        if (typeof mak === 'string') {
            try {
                mak = JSON.parse(mak);
            } catch (e) {
                mak = mak ? mak.split(',') : [];
            }
        }
        turnier.mannschafts_altersklassen = mak || [];

        turnier.status_effektiv = statusEffektiv;
        if (istEinzelbenutzerBetrieb()) {
            const aktives = (await knex('turniere').where({ aktiv: true }).first('id', 'bezeichnung')) || null;
            const a = ermittleAktivierbarkeit({ turnier, aktivesTurnier: aktives });
            turnier.aktivierbar = a.moeglich;
            turnier.aktivierbar_grund = a.grund;
        }
        turnier.teilnehmer_anzahl = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id }).count('* as anzahl').first().then(r => parseInt(r.anzahl, 10));

        // Die PDF-Binärdaten selbst gehören nicht in die JSON-Antwort (Größe, falsches Format) —
        // nur ein Flag, ob eine Ausschreibung hinterlegt ist. Der eigentliche Download/die Anzeige
        // läuft über GET /api/turniere/:id/ausschreibung (siehe ladeAusschreibung unten).
        turnier.hat_ausschreibung = !!turnier.ausschreibung_pdf;
        delete turnier.ausschreibung_pdf;
        // Zugangsdaten der Teilnehmer-App verlassen den Server nie.
        delete turnier.live_token;
        delete turnier.live_geheimnis;
        delete turnier.live_ruecknahme;

        res.json(turnier);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Liefert die hinterlegte Ausschreibung als PDF-Binärdatei aus (siehe Klick auf "Ausschreibung
// ansehen" in turniere.html/turnier.js). Dieselbe Sichtbarkeitsregel wie getTurnier: ein Entwurf
// ist nur für Mitglieder des ausrichtenden Vereins abrufbar.
export async function ladeAusschreibung(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: req.params.id }).first();
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });

        if (statusEffektiv === 'entwurf' && !istEinzelbenutzerBetrieb()) {
            const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
            if (!hatVereinsZugriffAufTurnier(user, turnier)) {
                return res.status(403).json({ error: 'Dieses Turnier befindet sich noch im Entwurf und ist nicht sichtbar.' });
            }
        }

        if (!istEinzelbenutzerBetrieb() && !(await darfTurnierSehen(knex, await ladeBenutzerMitAktivemVerein(knex, req.user.id), turnier))) {
            return res.status(404).json({ error: 'Turnier nicht gefunden.' });
        }

        if (!turnier.ausschreibung_pdf) {
            return res.status(404).json({ error: 'Für dieses Turnier ist keine Ausschreibung hinterlegt.' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${turnier.ausschreibung_dateiname || 'Ausschreibung.pdf'}"`);
        res.send(turnier.ausschreibung_pdf);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getTurniere(knex, req, res) {
    try {
        const userId = req.user.id;
        const { mine, zukuenftig, lat, lon } = req.query;
        const user = await ladeBenutzerMitAktivemVerein(knex, userId);
        // Super-Admins sehen die Turniere aller Vereine, auch Entwürfe (keine Vereinsfilter)
        const istSuperAdmin = !!(user && user.super_admin_aktiv);

        // Explizite Spaltenliste ohne die (potenziell mehrere MB große) PDF-Binärspalte — dieser
        // Endpunkt liefert oft viele Turniere auf einmal (siehe turniere.html) und soll die
        // Ausschreibungen dafür nicht unnötig aus der DB laden.
        let query = knex('turniere').select([...TURNIER_SPALTEN_OHNE_PDF, 'aktiv', knex.raw('(ausschreibung_pdf is not null) as hat_ausschreibung')]);
        // Archivierte Turniere (Super-Admin, admin-turniere.html) erscheinen in keiner Turnierliste
        query = query.where({ archiviert: false });

        if (mine === 'true') {
            // "Eigene" Turniere = Turniere des eigenen Vereins
            if (user && user.verein_id) {
                query = query.where({ verein_id: user.verein_id });
            } else {
                query = query.whereNull('id'); // kein Verein -> keine eigenen Turniere
            }
        } else if (!istEinzelbenutzerBetrieb() && !istSuperAdmin) {
            // Entwurf: nur für den ausrichtenden Verein sichtbar (Zustand 1 der Spezifikation).
            // Offline-Betrieb ist Single-Tenant und bleibt ausgenommen.
            if (user && user.verein_id) {
                query = query.where(function () {
                    this.whereNot({ status: 'entwurf' }).orWhere({ verein_id: user.verein_id });
                });
            } else {
                query = query.whereNot({ status: 'entwurf' });
            }
        }

        if (zukuenftig === 'true') {
            const jetzt = new Date();
            const heuteStr = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;

            // Eigene Entwürfe bleiben unabhängig vom (ggf. noch vorläufigen/falschen) Datum
            // sichtbar — ein Entwurf ist noch in Bearbeitung, kein "vergangenes" Turnier, dessen
            // Anlegerin/Anleger ihn sonst in der eigenen Übersicht nie wiederfinden würde.
            if (user && user.verein_id && !istSuperAdmin) {
                query = query.where(function () {
                    this.where('datum', '>=', heuteStr)
                        .orWhere({ status: 'entwurf', verein_id: user.verein_id });
                });
            } else {
                query = query.where('datum', '>=', heuteStr);
            }
        }

        // Sichtbarkeit: Turniere mit Einschränkung nur für berechtigte Vereine ("mine" zeigt ohnehin nur eigene)
        const turniere = mine === 'true'
            ? await query.orderBy('datum', 'desc')
            : await filtereSichtbareTurniere(knex, user, await query.orderBy('datum', 'desc'));
        const aktivesTurnier = turniere.find(t => t.aktiv) || null;
        const heute = datumAlsIso(new Date());

        const ids = turniere.map(t => t.id);
        const counts = ids.length > 0
            ? await knex('turnier_teilnehmer').whereIn('turnier_id', ids).groupBy('turnier_id').select('turnier_id').count('* as anzahl')
            : [];
        const countMap = {};
        counts.forEach(c => { countMap[c.turnier_id] = parseInt(c.anzahl, 10); });

        // Fortschritt der Planungs-Tools je Turnier: Helfer-Plätze (belegt/Bedarf, ein Slot zählt höchstens mit seinem
        // Bedarf) und Orga-Hauptaufgaben (erledigt/gesamt). Turniere ohne Planungs-Tools bekommen nichts.
        const helferMap = {};
        const orgaMap = {};
        const mitTools = turniere.filter(t => t.planungs_tools !== false).map(t => t.id);
        if (mitTools.length > 0) {
            const slots = await knex('helfer_slots as s')
                .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
                .whereIn('t.turnier_id', mitTools)
                .select('s.id as slot_id', 's.bedarf', 't.turnier_id');
            const belegtJeSlot = {};
            if (slots.length > 0) {
                const e = await knex('helfer_einsaetze').whereIn('slot_id', slots.map(x => x.slot_id)).groupBy('slot_id').select('slot_id').count('* as anzahl');
                e.forEach(x => { belegtJeSlot[x.slot_id] = parseInt(x.anzahl, 10); });
            }
            slots.forEach(sl => {
                const h = helferMap[sl.turnier_id] || (helferMap[sl.turnier_id] = { bedarf: 0, belegt: 0 });
                h.bedarf += sl.bedarf;
                h.belegt += Math.min(belegtJeSlot[sl.slot_id] || 0, sl.bedarf);
            });
            await Promise.all(mitTools.map(async (tid) => {
                try {
                    const { kennzahlen } = await ladeOrga(knex, tid);
                    if (kennzahlen.gesamt > 0) orgaMap[tid] = { erledigt: kennzahlen.erledigt, gesamt: kennzahlen.gesamt };
                } catch (err) {
                    // ohne Orga-Daten (z. B. Secondary) einfach keine Anzeige
                }
            }));
        }

        // Altersklassen parsen
        const turniereMitParsen = turniere.map(t => {
            let ak = t.altersklassen;
            if (typeof ak === 'string') {
                try {
                    ak = JSON.parse(ak);
                } catch (e) {
                    ak = ak ? ak.split(',') : [];
                }
            }

            let mak = t.mannschafts_altersklassen;
            if (typeof mak === 'string') {
                try {
                    mak = JSON.parse(mak);
                } catch (e) {
                    mak = mak ? mak.split(',') : [];
                }
            }

            // Listen-Badge: ohne hatEchteKaempfe berechnet, um N+1-Abfragen zu vermeiden (siehe
            // Plan) — kann "in_durchfuehrung" in einem schmalen Edge-Fall kurz verzögert zeigen;
            // die exakte, gate-relevante Berechnung erfolgt in getTurnier (Einzelabruf).
            return {
                ...t,
                altersklassen: ak || [],
                mannschafts_altersklassen: mak || [],
                teilnehmer_anzahl: countMap[t.id] || 0,
                helfer_bedarf: helferMap[t.id] ? helferMap[t.id].bedarf : 0,
                helfer_belegt: helferMap[t.id] ? helferMap[t.id].belegt : 0,
                orga_gesamt: orgaMap[t.id] ? orgaMap[t.id].gesamt : 0,
                orga_erledigt: orgaMap[t.id] ? orgaMap[t.id].erledigt : 0,
                status_effektiv: ermittleEffektivenStatus(t),
                // Hallen-Server: darf das Turnier jetzt aktiviert werden (Knopf "Aktivieren")?
                ...(istEinzelbenutzerBetrieb() ? (() => {
                    const a = ermittleAktivierbarkeit({ turnier: t, aktivesTurnier, heute });
                    return { aktivierbar: a.moeglich, aktivierbar_grund: a.grund };
                })() : {}),
                // Nur befüllt, wenn der Browser des Nutzers einen Standort mitliefert (lat/lon
                // per Geolocation-API, siehe turniere.html) UND das Turnier eine PLZ hinterlegt
                // hat — sonst null (z.B. Standort-Freigabe abgelehnt oder Turnier ohne PLZ).
                entfernung_km: entfernungZuPlzInKm(t.plz, lat, lon)
            };
        });

        res.json(turniereMitParsen);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// "Gelöscht" ist kein gespeicherter Status, sondern echtes Entfernen der Zeile (Zustand 7 der
// Spezifikation): nur erlaubt, solange das Turnier nicht in Durchführung/abgeschlossen ist UND
// bislang kein einziger Teilnehmer registriert wurde.
export async function deleteTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (statusEffektiv === 'in_durchfuehrung' || statusEffektiv === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein Turnier in Durchführung oder abgeschlossenes Turnier kann nicht gelöscht werden.' });
        }

        if (turnier.aktiv) {
            return res.status(409).json({ success: false, error: 'Das aktive Turnier kann nicht gelöscht werden.' });
        }

        const teilnehmerAnzahl = await knex('turnier_teilnehmer').where({ turnier_id: id }).count('* as anzahl').first().then(r => parseInt(r.anzahl, 10));
        if (teilnehmerAnzahl > 0) {
            return res.status(409).json({ success: false, error: 'Ein Turnier mit angemeldeten Teilnehmern kann nicht gelöscht werden.' });
        }

        await knex('turniere').where({ id }).del();
        res.json({ success: true, message: 'Turnier erfolgreich gelöscht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 1 -> 2: gibt das Turnier für externe Vereine frei (Anmeldung beginnt).
export async function veroeffentlicheTurnier(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status !== 'entwurf') {
            return res.status(400).json({ success: false, error: 'Nur Turniere im Entwurf können veröffentlicht werden.' });
        }

        await knex('turniere').where({ id }).update({ status: 'veroeffentlicht', updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Turnier erfolgreich veröffentlicht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 6: jederzeit möglich, außer das Turnier ist bereits abgeschlossen oder gelöscht.
export async function sageTurnierAb(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein bereits abgeschlossenes Turnier kann nicht mehr abgesagt werden.' });
        }

        if (turnier.aktiv) await deaktiviereAktivesTurnier(req);
        await knex('turniere').where({ id }).update({ status: 'abgesagt', aktiv: false, updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Turnier erfolgreich abgesagt.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Zustand 4 -> 5 manuell, per Button "Durchführung beendet" (Gegenstück zum automatischen
// Übergang durch importTurnierErgebnisse).
export async function beendeDurchfuehrung(knex, req, res) {
    try {
        const { id } = req.params;
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, id);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (statusEffektiv !== 'in_durchfuehrung') {
            return res.status(403).json({ success: false, error: 'Nur ein Turnier in Durchführung kann als beendet markiert werden.' });
        }

        if (turnier.aktiv) await deaktiviereAktivesTurnier(req);
        await knex('turniere').where({ id }).update({ status: 'abgeschlossen', aktiv: false, updated_at: knex.fn.now() });
        res.json({ success: true, message: 'Durchführung erfolgreich beendet.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Übersetzt den alten 3-Werte-Kampf-Status (wartet/laufend/beendet) aus vor dieser Migration
// exportierten Dateien in das neue 6-Werte-Vokabular; bereits neue Werte bleiben unverändert.
function normalisiereKampfStatus(status, kaempfer1Id, kaempfer2Id) {
    if (status === 'laufend') return 'gestartet';
    if (status === 'wartet') return (kaempfer1Id != null && kaempfer2Id != null) ? 'bereit' : 'angelegt';
    if (status === 'beendet' && (kaempfer1Id == null || kaempfer2Id == null)) return 'freilos';
    return status || 'angelegt';
}

// Fügt Kampfflächen/Pools/Teilnehmer/Kämpfe aus einer Export-JSON in ein Turnier ein, mit
// frischen IDs (nie die alten Export-IDs wiederverwenden) und korrekt umgeschriebenen
// Fremdschlüsseln (kampfflaeche_id, pool_id, kaempfer1/2_id, sieger_id, sowie die
// selbstreferenzierenden Kampf-Quelle-Verknüpfungen). Gemeinsam genutzt von importTurnier
// (komplette Neuanlage, offline) und importTurnierErgebnisse (Ergebnisse eines bestehenden
// Turniers ersetzen, online).
export async function importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften = [], mannschaftMitglieder = [] }) {
    const kampfflaecheIdMap = new Map();
    for (const kf of kampfflaechen) {
        const [neueIdObj] = await trx('kampfflaechen').insert({
            turnier_id: turnierId,
            bezeichnung: kf.bezeichnung,
            status: kf.status || 'frei'
        }).returning('id');
        kampfflaecheIdMap.set(kf.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    const poolIdMap = new Map();
    for (const p of pools) {
        const [neueIdObj] = await trx('pools').insert({
            turnier_id: turnierId,
            kampfflaeche_id: p.kampfflaeche_id != null ? (kampfflaecheIdMap.get(p.kampfflaeche_id) ?? null) : null,
            bezeichnung: p.bezeichnung,
            modus: p.modus || 'Jeder-gegen-Jeden',
            altersklasse: p.altersklasse,
            geschlecht: p.geschlecht,
            gewichtsklasse: p.gewichtsklasse,
            kampfzeit_sekunden: p.kampfzeit_sekunden || 240,
            matte_reihenfolge: p.matte_reihenfolge ?? null,
            status: p.status || 'angelegt',
            // Ohne diese vier Felder würden Mannschafts-Pools bei jedem Import/Reimport auf den
            // Spalten-Default "typ: 'einzel'" zurückfallen — der Pool wäre danach für
            // pools.html/mannschaften.html nicht mehr als Mannschafts-Pool erkennbar (siehe
            // getPoolsMitDetails: .andWhereNot({ typ: 'mannschaft' })) und hätte seine
            // Gewichtsklassen-Positionsliste sowie individuellen Golden-Score-Einstellungen verloren.
            typ: p.typ || 'einzel',
            mannschafts_gewichtsklassen: p.mannschafts_gewichtsklassen ?? null,
            golden_score_aktiv: p.golden_score_aktiv === undefined ? true : !!p.golden_score_aktiv,
            golden_score_max_sekunden: p.golden_score_max_sekunden ?? null,
            farbe_kaempfer2: gueltigeFarbe(p.farbe_kaempfer2),
            // Sammelpool der Nachzügler ("Verspätet") muss den Marker behalten, sonst wird er nach
            // dem Import zu einem gewöhnlichen Pool (Siegerliste, Urkunden, Matten ...).
            verspaetet: !!p.verspaetet
        }).returning('id');
        poolIdMap.set(p.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    const teilnehmerIdMap = new Map();
    for (const teil of teilnehmer) {
        const [neueIdObj] = await trx('turnier_teilnehmer').insert({
            turnier_id: turnierId,
            pool_id: teil.pool_id != null ? (poolIdMap.get(teil.pool_id) ?? null) : null,
            judopass_id: teil.judopass_id || '',
            vorname: teil.vorname,
            nachname: teil.nachname,
            geburtsjahr: teil.geburtsjahr,
            lizenz_ablauf: teil.lizenz_ablauf || '1970-01-01',
            geschlecht: teil.geschlecht,
            verein: teil.verein,
            gewicht: teil.gewicht || 0,
            altersklasse: teil.altersklasse,
            gewichtsklasse: teil.gewichtsklasse,
            startgeld_bezahlt: teil.startgeld_bezahlt ? 1 : 0,
            graduierung: teil.graduierung || null,
            status: teil.status || 'angemeldet',
            fuer_mannschaft: teil.fuer_mannschaft ? 1 : 0
        }).returning('id');
        teilnehmerIdMap.set(teil.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    // Erster Durchlauf ohne die selbstreferenzierenden Quelle-Felder (deren Zielkämpfe evtl.
    // noch gar nicht eingefügt sind), zweiter Durchlauf trägt sie nach.
    const kampfIdMap = new Map();
    for (const k of kaempfe) {
        const neuerKaempfer1Id = k.kaempfer1_id != null ? (teilnehmerIdMap.get(k.kaempfer1_id) ?? null) : null;
        const neuerKaempfer2Id = k.kaempfer2_id != null ? (teilnehmerIdMap.get(k.kaempfer2_id) ?? null) : null;
        const [neueIdObj] = await trx('kaempfe').insert({
            pool_id: poolIdMap.get(k.pool_id),
            kaempfer1_id: neuerKaempfer1Id,
            kaempfer2_id: neuerKaempfer2Id,
            sieger_id: k.sieger_id != null ? (teilnehmerIdMap.get(k.sieger_id) ?? null) : null,
            kampfzeit_in_sekunden: k.kampfzeit_in_sekunden || 0,
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1 || 0,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2 || 0,
            status: normalisiereKampfStatus(k.status, neuerKaempfer1Id, neuerKaempfer2Id),
            reihenfolge_nummer: k.reihenfolge_nummer ?? null,
            matten_reihenfolge: k.matten_reihenfolge ?? null,
            gruppe: k.gruppe ?? null
        }).returning('id');
        kampfIdMap.set(k.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
    }

    for (const k of kaempfe) {
        if (k.kaempfer1_quelle_kampf_id == null && k.kaempfer2_quelle_kampf_id == null) continue;

        await trx('kaempfe').where({ id: kampfIdMap.get(k.id) }).update({
            kaempfer1_quelle_kampf_id: k.kaempfer1_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer1_quelle_kampf_id) ?? null) : null,
            kaempfer1_quelle_typ: k.kaempfer1_quelle_typ ?? null,
            kaempfer2_quelle_kampf_id: k.kaempfer2_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer2_quelle_kampf_id) ?? null) : null,
            kaempfer2_quelle_typ: k.kaempfer2_quelle_typ ?? null
        });
    }

    // --- MANNSCHAFTEN + MANNSCHAFT_MITGLIEDER ---
    // Per (verein, bezeichnung) mit einer eventuell schon vorhandenen Mannschaft DIESES Turniers
    // abgleichen, statt sie blind neu anzulegen: importTurnierErgebnisse importiert in ein
    // BESTEHENDES Online-Turnier, dessen Mannschaften über den regulären Anmeldungs-Workflow
    // (Teilnehmer-Import/Waage, siehe teilnehmerController.js) bereits dort existieren — deren IDs
    // dürfen sich beim Reimport nicht ändern, u.a. weil mannschaftskaempfe darauf verweisen.
    // importTurnier (frischer Offline-Turnier-Import) legt dagegen immer ein brandneues Turnier
    // an, hier gibt es nie eine bestehende Zeile zum Abgleichen — derselbe Code läuft dann als
    // reiner Insert.
    const mannschaftIdMap = new Map();
    for (const m of mannschaften) {
        const neuerPoolId = m.pool_id != null ? (poolIdMap.get(m.pool_id) ?? null) : null;
        const bestehende = await trx('mannschaften')
            .where({ turnier_id: turnierId, verein: m.verein, bezeichnung: m.bezeichnung })
            .first();

        if (bestehende) {
            await trx('mannschaften').where({ id: bestehende.id }).update({
                pool_id: neuerPoolId,
                status: m.status || bestehende.status,
                updated_at: trx.fn.now()
            });
            mannschaftIdMap.set(m.id, bestehende.id);
        } else {
            const [neueIdObj] = await trx('mannschaften').insert({
                turnier_id: turnierId,
                pool_id: neuerPoolId,
                verein: m.verein,
                bezeichnung: m.bezeichnung,
                status: m.status || 'angemeldet'
            }).returning('id');
            mannschaftIdMap.set(m.id, typeof neueIdObj === 'object' ? neueIdObj.id : neueIdObj);
        }
    }

    // Roster-Positionen komplett ersetzen statt zu mergen — einfacher und robust genug, da die
    // importierte Datei ohnehin den vollständigen, aktuellen Stand jeder Mannschaft enthält.
    if (mannschaftIdMap.size > 0) {
        await trx('mannschaft_mitglieder').whereIn('mannschaft_id', [...mannschaftIdMap.values()]).del();
    }
    for (const mm of mannschaftMitglieder) {
        const neueMannschaftId = mannschaftIdMap.get(mm.mannschaft_id);
        const neueTeilnehmerId = mm.turnier_teilnehmer_id != null ? (teilnehmerIdMap.get(mm.turnier_teilnehmer_id) ?? null) : null;
        if (!neueMannschaftId || !neueTeilnehmerId) continue;

        await trx('mannschaft_mitglieder').insert({
            mannschaft_id: neueMannschaftId,
            turnier_teilnehmer_id: neueTeilnehmerId,
            gewichtsklasse: mm.gewichtsklasse
        });
    }
}

// Gegenstück zu exportTurnier: importiert eine zuvor exportierte Turnier-JSON-Datei als
// komplett NEUES Turnier mit frischen IDs. Ausschließlich im Offline-Modus verfügbar. Bestehende
// Turniere bleiben unangetastet; das importierte Turnier wird nicht aktiviert.
export async function importTurnier(knex, req, res) {
    try {
        if (!istEinzelbenutzerBetrieb()) {
            return res.status(403).json({ success: false, error: 'Der Turnier-Import ist nur im Offline-Modus verfügbar.' });
        }

        const { contentBase64 } = req.body;
        if (!contentBase64) {
            return res.status(400).json({ success: false, error: 'Dateiinhalt ist erforderlich.' });
        }

        let daten;
        try {
            const jsonStr = Buffer.from(contentBase64, 'base64').toString('utf-8');
            daten = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        const ergebnis = await importiereTurnierDaten(knex, req.app.get('sync'), daten);
        return res.status(201).json({ success: true, ...ergebnis });
    } catch (error) {
        if (error instanceof FachFehler) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        console.error('[Turnier-Import-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Kern des Turnier-Imports, gemeinsam für den Datei-Import (importTurnier) und das Holen aus der
// Cloud (cloudRoutes.js). Legt ein neues Turnier an (ohne es zu aktivieren); wirft FachFehler bei
// ungültigem Format oder Terminüberschneidung. Der Aufrufer prüft vorher den Einzelbenutzerbetrieb.
// Ingest-Token der Cloud aus der Exportdatei (`live.token`); alles andere gilt als nicht vorhanden.
function gueltigesLiveToken(wert) {
    return typeof wert === 'string' && wert.length >= 10 && wert.length <= 200 ? wert : null;
}

export async function importiereTurnierDaten(knex, sync, daten) {
        const t = daten && daten.turnier;
        const liveToken = gueltigesLiveToken(daten && daten.live && daten.live.token);
        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];
        const mannschaften = (daten && daten.mannschaften) || [];
        const mannschaftMitglieder = (daten && daten.mannschaft_mitglieder) || [];

        if (!t || !t.bezeichnung || !t.ort || !t.datum || !t.ausrichter) {
            throw new FachFehler(400, 'Ungültiges Import-Format: Turnier-Pflichtfelder (Bezeichnung, Ort, Datum, Ausrichter) fehlen.');
        }

        let ak = t.altersklassen;
        if (typeof ak === 'string') {
            try { ak = JSON.parse(ak); } catch (e) { ak = []; }
        }

        let mak = t.mannschafts_altersklassen;
        if (typeof mak === 'string') {
            try { mak = JSON.parse(mak); } catch (e) { mak = []; }
        }

        await pruefeTerminFrei(knex, sync, t.datum);

        const neuesTurnierId = await knex.transaction(async (trx) => {
            // Verein anhand des Ausrichter-Namens wiederverwenden/anlegen (analog zur
            // rückwirkenden Verknüpfung in link_turniere_zu_vereine-Migration).
            let verein = await trx('vereine').where({ name: t.ausrichter }).first();
            if (!verein) {
                const [insertedId] = await trx('vereine').insert({ name: t.ausrichter }).returning('id');
                verein = { id: typeof insertedId === 'object' ? insertedId.id : insertedId };
            }

            // Vereinsliste der Quelle (Cloud) in die lokale Tabelle übernehmen, damit die Vorschläge im
            // Feld "Verein" auch hier alle bekannten Vereine kennen. Vorhandene Namen bleiben unberührt;
            // ältere Exporte ohne Liste werden einfach übersprungen.
            const vereinsNamen = [...new Set((Array.isArray(daten.vereine) ? daten.vereine : [])
                .map(n => (typeof n === 'string' ? n : n && n.name))
                .map(n => (n || '').trim())
                .filter(Boolean))];
            for (let i = 0; i < vereinsNamen.length; i += 200) {
                await trx('vereine')
                    .insert(vereinsNamen.slice(i, i + 200).map(name => ({ name })))
                    .onConflict('name').ignore();
            }

            const [turnierIdObj] = await trx('turniere').insert({
                bezeichnung: t.bezeichnung,
                ort: t.ort,
                datum: t.datum,
                ausrichter: t.ausrichter,
                nutze_gewichtsklassen: t.nutze_gewichtsklassen ? 1 : 0,
                anzahl_kampfflaechen: kampfflaechen.length || parseInt(t.anzahl_kampfflaechen, 10) || 1,
                bundesland: t.bundesland || null,
                plz: t.plz || null,
                ausschreibung_pdf: t.ausschreibung_pdf_base64 ? Buffer.from(t.ausschreibung_pdf_base64, 'base64') : null,
                ausschreibung_dateiname: t.ausschreibung_pdf_base64 ? (t.ausschreibung_dateiname || 'Ausschreibung.pdf') : null,
                altersklassen: JSON.stringify(ak || {}),
                mannschafts_altersklassen: JSON.stringify(mak || []),
                status: GUELTIGE_STATUS_WERTE.includes(t.status) ? t.status : 'entwurf',
                anmeldeschluss: t.anmeldeschluss || null,
                startgeld: t.startgeld !== undefined && t.startgeld !== '' ? parseFloat(t.startgeld) : null,
                iban: t.iban || null,
                kontoinhaber: t.kontoinhaber || null,
                verwendungszweck: t.verwendungszweck || null,
                farbe_kaempfer2: gueltigeFarbe(t.farbe_kaempfer2) || 'blau',
                // Turnierzeit und Waagenanzahl (Helferplan); ältere Dateien ohne diese Felder: leer bzw. 1
                ...importTurnierzeit(t),
                planungs_tools: planungsToolsWert(t.planungs_tools, !istEinzelbenutzerBetrieb()),
                // Teilnehmer-App: Token aus der Cloud und ein eigenes Geheimnis für die Teilnehmer-Schlüssel; ein geholtes
                // Turnier startet immer mit ausgeschalteter Freigabe (Spalte live_freigabe bleibt auf ihrem Standard).
                live_token: liveToken,
                live_geheimnis: liveToken ? crypto.randomBytes(32).toString('hex') : null,
                verein_id: verein.id,
                // Hält die ID des Quell-Turniers fest, damit ein späterer Online-Reimport
                // (importTurnierErgebnisse) dieses (neu angelegte, lokal andere) Offline-Turnier
                // wieder dem richtigen Online-Turnier zuordnen kann (siehe dortiger ID-Abgleich).
                // t.urspruengliche_id bevorzugt, falls die importierte Datei selbst schon von einem
                // vorherigen Offline-Import stammt (Mehrfach-Hop) — sonst wäre die eigentliche
                // Online-Herkunft nach dem zweiten Hop verloren.
                urspruengliche_id: t.urspruengliche_id ?? t.id ?? null
            }).returning('id');
            const turnierId = typeof turnierIdObj === 'object' ? turnierIdObj.id : turnierIdObj;

            await importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaftMitglieder });
            await importiereVorlagen(trx, verein.id, daten.urkunden_vorlagen);
            // Helferplan gehört zum neu angelegten Turnier (Einsätze als name_manuell); fehlt er, bleibt er leer
            if (daten.helferplan) await ersetzeHelferplan(trx, turnierId, daten.helferplan);
            // Orga-Checkliste; alte Exportdateien ohne Abschnitt lassen sie leer (wird beim ersten Öffnen aus der Vorlage angelegt)
            await ersetzeOrga(trx, turnierId, daten.orga);

            return turnierId;
        });

        // Das importierte Turnier wartet als neues Turnier auf seinen Wettkampftag; aktiviert wird per Knopf.
        return {
            turnierId: neuesTurnierId,
            imported: {
                kampfflaechen: kampfflaechen.length,
                pools: pools.length,
                teilnehmer: teilnehmer.length,
                kaempfe: kaempfe.length
            }
        };
}

// Lädt die Ergebnisse eines Turniers hoch, das offline durchgeführt wurde, und ersetzt DAMIT
// NUR die Wettkampfdaten (Kampfflächen/Pools/Teilnehmer/Kämpfe) DIESES EINEN, bereits online
// bestehenden Turniers. Ausschließlich online und nur für Mitglieder des ausrichtenden Vereins
// (Gegenteil von importTurnier: rührt turniere/benutzer/vereine nicht an, löscht nichts
// anderes). Schützt per Turnier-ID-Abgleich davor, versehentlich die falsche Datei hochzuladen.
export async function importTurnierErgebnisse(knex, req, res) {
    try {
        if (istEinzelbenutzerBetrieb()) {
            return res.status(403).json({ success: false, error: 'Der Ergebnis-Upload ist nur im Online-Modus verfügbar.' });
        }

        const turnierId = parseInt(req.params.id, 10);
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfeVorUpload = await turnierHatEchteKaempfe(knex, turnierId);
        const statusVorUpload = ermittleEffektivenStatus(turnier, { hatEchteKaempfe: hatEchteKaempfeVorUpload });
        if (!['anmeldung_geschlossen', 'in_durchfuehrung'].includes(statusVorUpload)) {
            return res.status(403).json({ success: false, error: 'Ergebnisse können erst hochgeladen werden, wenn die Anmeldefrist abgelaufen ist. Ein bereits abgeschlossenes Turnier ist schreibgeschützt.' });
        }

        const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
        if (!user || !hatVereinsZugriffAufTurnier(user, turnier)) {
            return res.status(403).json({ success: false, error: 'Nur freigegebene Mitglieder des ausrichtenden Vereins dürfen Ergebnisse hochladen.' });
        }

        const { contentBase64 } = req.body;
        if (!contentBase64) {
            return res.status(400).json({ success: false, error: 'Dateiinhalt ist erforderlich.' });
        }

        let daten;
        try {
            const jsonStr = Buffer.from(contentBase64, 'base64').toString('utf-8');
            daten = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        const t = daten && daten.turnier;
        if (!t || t.id == null) {
            return res.status(400).json({ success: false, error: 'Ungültiges Import-Format: Turnier-ID fehlt in der Datei.' });
        }
        // Stammt die Datei aus einem Offline-Import (siehe urspruengliche_id in importTurnier),
        // steht dort die tatsächliche Online-Herkunfts-ID — die eigene (lokale) Offline-ID der
        // Datei wäre für den Abgleich mit diesem Online-Turnier bedeutungslos.
        const quellTurnierId = t.urspruengliche_id ?? t.id;
        if (parseInt(quellTurnierId, 10) !== turnierId) {
            return res.status(400).json({
                success: false,
                error: `Die Datei gehört zu Turnier-ID ${quellTurnierId}, nicht zum ausgewählten Turnier (ID ${turnierId}).`
            });
        }

        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];
        const mannschaften = (daten && daten.mannschaften) || [];
        const mannschaftMitglieder = (daten && daten.mannschaft_mitglieder) || [];

        await knex.transaction(async (trx) => {
            // Nur die Wettkampfdaten DIESES Turniers ersetzen — turniere/benutzer/vereine
            // bleiben unangetastet, andere Turniere sind von dieser Löschung nicht betroffen.
            // mannschaften bewusst NICHT gelöscht (siehe importWettkampfdaten): sie werden dort
            // per (verein, bezeichnung) mit den online bereits bestehenden Zeilen abgeglichen statt
            // neu angelegt, damit ihre IDs stabil bleiben (worauf mannschaftskaempfe verweisen).
            const altePools = await trx('pools').where({ turnier_id: turnierId }).select('id');
            const altePoolIds = altePools.map(p => p.id);
            if (altePoolIds.length > 0) {
                await trx('kaempfe').whereIn('pool_id', altePoolIds).del();
            }
            await trx('turnier_teilnehmer').where({ turnier_id: turnierId }).del();
            await trx('pools').where({ turnier_id: turnierId }).del();
            await trx('kampfflaechen').where({ turnier_id: turnierId }).del();

            await importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaftMitglieder });

            // Automatischer Übergang in den Archiv-Zustand (Zustand 5: "wird automatisch durch
            // den Upload der Ergebnisdaten ... ausgelöst").
            await trx('turniere').where({ id: turnierId }).update({ status: 'abgeschlossen', updated_at: trx.fn.now() });
        });

        return res.json({
            success: true,
            turnierId,
            imported: {
                kampfflaechen: kampfflaechen.length,
                pools: pools.length,
                teilnehmer: teilnehmer.length,
                kaempfe: kaempfe.length
            }
        });
    } catch (error) {
        console.error('[Turnier-Ergebnisse-Upload-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function exportTurnier(knex, req, res) {
    try {
        const turnierId = parseInt(req.params.id);
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnierId);
        const statusEffektiv = ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
        if (!['anmeldung_geschlossen', 'in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv)) {
            return res.status(403).json({ success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
        }

        const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
        const hatZugriff = istEinzelbenutzerBetrieb() || hatVereinsZugriffAufTurnier(user, turnier);

        if (!hatZugriff) {
            return res.status(403).json({ success: false, error: 'Nur freigegebene Mitglieder des ausrichtenden Vereins dürfen das Turnier exportieren.' });
        }

        // Cloud-Live: ein Turnier läuft entweder in der Cloud oder an einem Hallen-Server, nie an beiden. Solange es in der Cloud live
        // geführt wird, gibt es keinen Export (und damit kein Holen auf einen Hallen-Server).
        const liveInDerCloud = await knex('cloud_live').where({ turnier_id: turnierId }).whereNull('beendet_am').first('turnier_id');
        if (liveInDerCloud) {
            return res.status(409).json({ success: false, error: 'Das Turnier läuft live in der Cloud. Es kann erst exportiert werden, wenn der Live-Betrieb beendet ist.' });
        }

        const exportData = await baueTurnierExport(knex, turnierId, turnier);

        // Die Datei lässt sich auf einem Hallen-Server einspielen: Live-Schalten in der Cloud warnt danach (Cloud-Live, Mischen-Sperre).
        if (betriebsmodus.liesBetriebsmodus().istCloud) {
            await knex('turniere').where({ id: turnierId }).update({ auf_hallen_server_geholt_am: knex.fn.now() });
        }

        // Teilnehmer-App: nur wer ausdrücklich ein Live-Token anfordert (der Hallen-Server beim Holen), bekommt eines. Frühere
        // Tokens dieses Turniers verfallen erst, wenn das neue am Ingest benutzt wird (sperreAelterTokens in liveRoutes.js).
        if (req.query.liveToken === '1' && istLiveApiAktiv()) {
            const turnierKey = String(turnier.urspruengliche_id ?? turnier.id);
            const { token } = await erzeugeToken(knex, { name: `Hallen-Server ${turnier.bezeichnung}`, turnierKey });
            exportData.live = { token };
        }

        const dateiname = `turnier_${turnierId}_export_${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
        console.error('[Turnier-Export-Fehler]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * Inhalt der Turnier-Exportdatei (ohne Zugriffs- und Statusprüfung, die macht exportTurnier).
 * Enthält seit der Helferverwaltung auch `helferplan` (nur Anzeigenamen, siehe services/helferTransfer.js).
 */
export async function baueTurnierExport(knex, turnierId, turnierZeile = null) {
        const turnier = turnierZeile || await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');

        const kampfflaechen = await knex('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id', 'asc');
        const pools = await knex('pools').where({ turnier_id: turnierId }).orderBy('id', 'asc');
        const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).orderBy('id', 'asc');

        const poolIds = pools.map(p => p.id);
        const kaempfe = poolIds.length > 0
            ? await knex('kaempfe').whereIn('pool_id', poolIds).orderBy('id', 'asc')
            : [];

        // Mannschaften + ihre Roster-Positionen — ohne diese beiden würde jeder Turnier-Import
        // (Offline-Ersteinlesen wie auch der Online-Ergebnis-Reimport) alle Team-Meldungen
        // stillschweigend verlieren (siehe importWettkampfdaten). mannschaftskaempfe selbst bleiben
        // bewusst unexportiert — ihr Ergebnis wird nach dem Import serverseitig aus den
        // zugehörigen kaempfe-Zeilen neu berechnet (siehe triggerPoolUpdate in kampfController.js).
        const mannschaften = await knex('mannschaften').where({ turnier_id: turnierId }).orderBy('id', 'asc');
        const mannschaftIds = mannschaften.map(m => m.id);
        const mannschaftMitglieder = mannschaftIds.length > 0
            ? await knex('mannschaft_mitglieder').whereIn('mannschaft_id', mannschaftIds).orderBy('id', 'asc')
            : [];

        let ak = turnier.altersklassen;
        if (typeof ak === 'string') {
            try {
                ak = JSON.parse(ak);
            } catch (e) {
                ak = ak ? ak.split(',') : [];
            }
        }

        let mak = turnier.mannschafts_altersklassen;
        if (typeof mak === 'string') {
            try {
                mak = JSON.parse(mak);
            } catch (e) {
                mak = mak ? mak.split(',') : [];
            }
        }

        // Ausschreibungs-PDF (Buffer) als Base64-String exportieren statt als rohes Buffer-Objekt
        // ({"type":"Buffer","data":[...]}) — analog zum bestehenden contentBase64-Muster beim
        // Turnier-Import (siehe importTurnier unten).
        // Token und Geheimnis der Teilnehmer-App gehören nie in eine Exportdatei.
        const { ausschreibung_pdf, live_token, live_geheimnis, live_ruecknahme, ...turnierOhnePdf } = turnier;
        const ausschreibungPdfBase64 = ausschreibung_pdf ? Buffer.from(ausschreibung_pdf).toString('base64') : null;

        const exportData = {
            exportiert_am: new Date().toISOString(),
            turnier: {
                ...turnierOhnePdf,
                altersklassen: ak || [],
                mannschafts_altersklassen: mak || [],
                ausschreibung_pdf_base64: ausschreibungPdfBase64
            },
            kampfflaechen,
            pools,
            teilnehmer,
            kaempfe,
            mannschaften,
            mannschaft_mitglieder: mannschaftMitglieder,
            // Namen aller bekannten Vereine, damit der Import die lokale Vereinsliste auffüllt
            vereine: (await knex('vereine').orderBy('name', 'asc').select('name')).map(v => v.name),
            urkunden_vorlagen: await exportiereVorlagen(knex, turnier.verein_id),
            helferplan: await exportiereHelferplan(knex, turnierId, kampfflaechen),
            orga: await exportiereOrga(knex, turnierId)
        };
        return exportData;
}

async function synchronisiereKampfflaechen(knex, turnierId, anzahl) {
    const aktuelleMatten = await knex('kampfflaechen')
        .where({ turnier_id: turnierId })
        .orderBy('id', 'asc');

    const aktuelleAnzahl = aktuelleMatten.length;

    if (aktuelleAnzahl < anzahl) {
        for (let i = aktuelleAnzahl + 1; i <= anzahl; i++) {
            await knex('kampfflaechen').insert({
                turnier_id: turnierId,
                bezeichnung: `Matte ${i}`
            });
        }
    } else if (aktuelleAnzahl > anzahl) {
        const mattenZuLoeschen = aktuelleMatten.slice(anzahl);
        const idsZuLoeschen = mattenZuLoeschen.map(m => m.id);
        await knex('kampfflaechen')
            .whereIn('id', idsZuLoeschen)
            .del();
    }
}

// Live-Freigabe (Teilnehmer-App, docs/specs/2026-10-12-teilnehmer-app-design.md): Opt-in des Veranstalters. Ein Turnier
// ohne urspruengliche_id stammt nicht aus der Cloud und ist ihr unbekannt, die Freigabe ist dafür gesperrt.
export async function leseLiveFreigabe(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: req.params.id }).first('live_freigabe', 'urspruengliche_id');
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        res.json({ freigegeben: !!turnier.live_freigabe, moeglich: turnier.urspruengliche_id != null });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function setzeLiveFreigabe(knex, req, res) {
    try {
        const { freigegeben } = req.body || {};
        if (typeof freigegeben !== 'boolean') {
            return res.status(400).json({ success: false, error: 'Feld "freigegeben" muss true oder false sein.' });
        }
        const turnier = await knex('turniere').where({ id: req.params.id }).first('id', 'status', 'urspruengliche_id');
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (freigegeben) {
            if (turnier.urspruengliche_id == null) {
                return res.status(409).json({ success: false, error: 'Dieses Turnier stammt nicht aus der Cloud und kann nicht live freigegeben werden.' });
            }
            if (turnier.status === 'abgeschlossen') {
                return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier kann nicht live freigegeben werden.' });
            }
        }
        await knex('turniere').where({ id: turnier.id }).update({ live_freigabe: freigegeben });
        res.json({ success: true, freigegeben });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Beenden/Absagen des aktiven Turniers: Brücke stoppen, letzten Stand sichern, Dokument-DB verwerfen.
async function deaktiviereAktivesTurnier(req) {
    const sync = req.app.get('sync');
    if (sync) await sync.deaktiviereTurnier();
}

// Hallen-Server: macht das Turnier zum aktiven (Matten, Waage, Client-Geräte hängen dann daran).
// Nur am Wettkampftag und nur, wenn kein anderes Turnier aktiv ist (ermittleAktivierbarkeit). Ein
// Entwurf wird dabei veröffentlicht, damit sich die Durchführung später regulär beenden lässt.
// Nur unter NODE_ENV=test kann mit { erzwingen: true } Termin und aktives Turnier übergangen werden.
export async function aktiviereTurnierRoute(knex, req, res) {
    try {
        if (!istEinzelbenutzerBetrieb()) {
            return res.status(403).json({ success: false, error: 'Das Aktivieren gibt es nur am Hallen-Server.' });
        }
        const id = parseInt(req.params.id, 10);
        const turnier = await knex('turniere').where({ id }).first();
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });

        const aktives = (await knex('turniere').where({ aktiv: true }).first()) || null;
        const erzwingen = process.env.NODE_ENV === 'test' && req.body && req.body.erzwingen === true;
        if (erzwingen && turnier.aktiv) return res.json({ success: true, message: 'Turnier ist bereits aktiv.' });
        if (!erzwingen) {
            const pruefung = ermittleAktivierbarkeit({ turnier, aktivesTurnier: aktives });
            if (!pruefung.moeglich) return res.status(409).json({ success: false, error: pruefung.grund });
        }

        const sync = req.app.get('sync');
        if (aktives && aktives.id !== id) {
            if (sync) await sync.deaktiviereTurnier();
            await knex('turniere').where({ id: aktives.id }).update({ aktiv: false });
        }
        await knex('turniere').where({ id }).update({
            aktiv: true,
            status: turnier.status === 'entwurf' ? 'veroeffentlicht' : turnier.status,
            updated_at: knex.fn.now()
        });
        if (sync) await sync.aktiviereTurnier(id);
        res.json({ success: true, message: 'Turnier aktiviert.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// Kopiert ein Turnier als neuen Entwurf (Spec mehrere Turniere). Übernommen werden Stammdaten,
// Ausschreibung und Matten; Pools, Mattenzuordnungen, Kämpfe und Mannschaften nie. Optional kommen
// die Teilnehmer mit (Gewicht und Lizenz-Ablaufdatum bleiben, gewogen/Startgeld/Pool werden zurückgesetzt).
export async function dupliziereTurnier(knex, req, res) {
    try {
        if (!istEinzelbenutzerBetrieb()) {
            return res.status(403).json({ success: false, error: 'Das Duplizieren gibt es nur am Hallen-Server.' });
        }
        const id = parseInt(req.params.id, 10);
        const quelle = await knex('turniere').where({ id }).first();
        if (!quelle) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });

        const datum = datumAlsIso(req.body && req.body.datum);
        if (!datum) return res.status(400).json({ success: false, error: 'Bitte einen Wettkampftag für die Kopie angeben.' });
        await pruefeTerminFrei(knex, req.app.get('sync'), datum);

        const teilnehmerUebernehmen = !!(req.body && req.body.teilnehmerUebernehmen);
        const neueId = await knex.transaction(async (trx) => {
            const [idObj] = await trx('turniere').insert({
                bezeichnung: quelle.bezeichnung,
                ort: quelle.ort,
                datum,
                ausrichter: quelle.ausrichter,
                anzahl_kampfflaechen: quelle.anzahl_kampfflaechen,
                nutze_gewichtsklassen: quelle.nutze_gewichtsklassen,
                verein_id: quelle.verein_id,
                bundesland: quelle.bundesland,
                plz: quelle.plz,
                altersklassen: quelle.altersklassen,
                mannschafts_altersklassen: quelle.mannschafts_altersklassen,
                status: 'entwurf',
                aktiv: false,
                startgeld: quelle.startgeld,
                iban: quelle.iban,
                kontoinhaber: quelle.kontoinhaber,
                verwendungszweck: quelle.verwendungszweck,
                farbe_kaempfer2: quelle.farbe_kaempfer2,
                ausschreibung_pdf: quelle.ausschreibung_pdf,
                ausschreibung_dateiname: quelle.ausschreibung_dateiname
            }).returning('id');
            const neu = typeof idObj === 'object' ? idObj.id : idObj;
            await synchronisiereKampfflaechen(trx, neu, parseInt(quelle.anzahl_kampfflaechen, 10) || 1);
            if (teilnehmerUebernehmen) {
                const teilnehmer = await trx('turnier_teilnehmer').where({ turnier_id: id }).orderBy('id', 'asc');
                const zeilen = teilnehmer.map(t => kopiereTeilnehmerFuerNeuesTurnier(t, neu));
                for (let i = 0; i < zeilen.length; i += 200) {
                    await trx('turnier_teilnehmer').insert(zeilen.slice(i, i + 200));
                }
            }
            return neu;
        });
        res.status(201).json({ success: true, turnierId: neueId });
    } catch (error) {
        if (error instanceof FachFehler) return res.status(error.statusCode).json({ success: false, error: error.message });
        console.error('[Turnier-Duplizieren-Fehler]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
