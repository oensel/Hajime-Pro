import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveUserVereinName, hatVereinsZugriffAufTurnier } from '../utils/vereinHelper.js';
import { turnierHatEchteKaempfe } from './poolController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GRADUIERUNGEN = JSON.parse(readFileSync(path.join(__dirname, '../config/graduierungen.json'), 'utf-8'));
const GRADUIERUNG_IDS = new Set(GRADUIERUNGEN.map(g => g.id));
const DJB_ALTERSKLASSEN = JSON.parse(readFileSync(path.join(__dirname, '../config/altersklassen.json'), 'utf-8'));

// Anmeldeschluss wird als reines Datum (ohne Uhrzeit) gespeichert; die Frist gilt bis
// einschließlich 24:00 Uhr Ortszeit dieses Tages. Ältere Datensätze mit vollem ISO-Zeitstempel
// bleiben unverändert (Regex greift nur bei "YYYY-MM-DD"). setHours (lokale Zeit) statt
// setUTCHours, da UTC-Mitternacht je nach Zeitzone des Servers mehrere Stunden von der
// tatsächlichen deutschen Ortszeit abweicht.
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
// 'anmeldung_geschlossen' und 'in_durchfuehrung' sind reine Ableitungen (kein Cronjob nötig,
// identische Logik wie in turnierController.js).
function ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {}) {
    if (turnier.status !== 'veroeffentlicht') return turnier.status;

    const heuteStr = new Date().toISOString().slice(0, 10);
    const wettkampftagErreicht = turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;
    if (wettkampftagErreicht || hatEchteKaempfe) return 'in_durchfuehrung';
    if (istAnmeldefristAbgelaufen(turnier)) return 'anmeldung_geschlossen';
    return 'veroeffentlicht';
}

// Sobald für ein Turnier der erste echte (nicht Freilos-)Kampf stattgefunden hat, ist die
// Teilnehmerliste gesperrt (Anlegen, Bearbeiten, Löschen, Import) — bloße Pool-Existenz reicht
// dafür NICHT aus, da Pools nach der Generierung noch manuell nachbearbeitet werden können
// (siehe poolHatBereitsEchteKaempfe/turnierHatEchteKaempfe in poolController.js). Erst nach dem
// ersten echten Kampf gilt die Auslosung als endgültig.
const TEILNEHMERLISTE_GESPERRT_FEHLER = 'Die Teilnehmerliste ist gesperrt, da für dieses Turnier bereits Kämpfe stattgefunden haben.';

export async function createTeilnehmer(knex, req, res) {
    try {
        const {
            turnier_id, judopass_id, vorname, nachname, geburtsdatum,
            lizenz_ablauf, geschlecht, verein, gewicht, altersklasse, gewichtsklasse,
            startgeld_bezahlt, graduierung
        } = req.body;

        // Benutzer laden
        const user = await knex('benutzer').where({ id: req.user.id }).first();
        if (!user) {
            return res.status(401).json({ success: false, error: 'Benutzerprofil nicht gefunden.' });
        }

        // Turnier laden
        const turnier = await knex('turniere').where({ id: parseInt(turnier_id) }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        const userVereinName = await resolveUserVereinName(knex, user);

        // 1. Validierung: Überprüfen, ob alle Pflichtfelder da sind (Verein nur für Nicht-Gastgeber Pflicht).
        // geburtsdatum ist hier bewusst Pflicht (nicht defaultbar): es steuert die Alters-
        // klassen-Herleitung und damit sicherheitsrelevante Alterseinteilungen.
        if (!turnier_id || !vorname || !nachname || !geburtsdatum || (!istGastgeberVerein && !verein)) {
            return res.status(400).json({ success: false, error: 'Fehlende Pflichtfelder (Turnier-ID, Vorname, Nachname, Geburtsdatum).' });
        }

        // Wer nicht Mitglied des Gastgeber-Vereins ist, muss Club-Zugehörigkeit und Turnierstatus erfüllen
        if (!istGastgeberVerein) {
            if (ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) !== 'veroeffentlicht') {
                return res.status(403).json({ success: false, error: 'Die Anmeldung für dieses Turnier ist nicht geöffnet.' });
            }

            if (!userVereinName) {
                return res.status(400).json({ success: false, error: 'Bitte tragen Sie zuerst Ihren Verein im Profil ein.' });
            }

            if (verein !== userVereinName) {
                return res.status(403).json({ success: false, error: `Sie dürfen nur Teilnehmer für Ihren eigenen Verein (${userVereinName}) anmelden.` });
            }
        }

        // --- DUPLETTEN-SCHUTZ PRÜFUNG ---
        if (judopass_id) {
            const bestehenderTeilnehmer = await knex('turnier_teilnehmer')
                .where({
                    turnier_id: parseInt(turnier_id),
                    judopass_id: judopass_id.trim()
                })
                .first();

            if (bestehenderTeilnehmer) {
                return res.status(409).json({
                    success: false,
                    error: `${bestehenderTeilnehmer.vorname} ${bestehenderTeilnehmer.nachname} wurde für dieses Turnier bereits eingewogen/angemeldet.`
                });
            }
        }

        // Falls keine Altersklasse übergeben wurde, anhand des Geburtsdatums ermitteln (analog zu waage.html)
        const ermittelteAltersklasse = altersklasse || ermittleAltersklasse(
            geburtsdatum,
            geschlecht,
            turnier.datum ? new Date(turnier.datum).getFullYear() : new Date().getFullYear(),
            ermittleTurnierAltersklassenKeys(turnier)
        );

        // Gewicht robust parsen (deutsches Komma-Dezimaltrennzeichen wie beim CSV-Import zulassen).
        const gewichtGeparst = parseFloat(String(gewicht ?? '').replace(',', '.')) || 0.00;

        // gewichtsklasse ist in der Datenbank ein Pflichtfeld (NOT NULL). Wird sie nicht
        // mitgeschickt (z.B. eigener API-Aufruf ohne die waage.js-Dropdown-Logik), serverseitig
        // aus Gewicht/Geschlecht/Altersklasse herleiten (identische Logik zum CSV-Import) statt
        // mit einem rohen SQL-NOT-NULL-Fehler abzustürzen.
        const ermittelteGewichtsklasse = gewichtsklasse || ermittleGewichtsklasse(geschlecht, ermittelteAltersklasse, gewichtGeparst);
        if (!ermittelteGewichtsklasse) {
            return res.status(400).json({
                success: false,
                error: 'Die Gewichtsklasse konnte nicht ermittelt werden. Bitte Gewicht angeben oder die Gewichtsklasse manuell wählen.'
            });
        }

        // 2. Insert in die Datenbank
        const [idObj] = await knex('turnier_teilnehmer').insert({
            turnier_id: parseInt(turnier_id),
            // judopass_id ist ebenfalls NOT NULL, wird von der Anwendung aber als optional
            // behandelt (z.B. Kinder/ausländische Gäste ohne Judopass) — leerer String statt
            // null, das erfüllt die Spalte und wird an allen Stellen (istTeilnehmerStartberechtigt
            // u.a.) bereits als "kein Judopass hinterlegt" gewertet.
            judopass_id: judopass_id || '',
            vorname: vorname,
            nachname: nachname,
            geburtsdatum: geburtsdatum,
            // lizenz_ablauf ist NOT NULL; ein bewusst in der Vergangenheit liegender Default
            // (wie beim CSV-Import) markiert "keine gültige Lizenz hinterlegt", statt abzustürzen.
            lizenz_ablauf: lizenz_ablauf || '1970-01-01',
            geschlecht: geschlecht,
            verein: verein,
            gewicht: gewichtGeparst,
            altersklasse: ermittelteAltersklasse,
            gewichtsklasse: ermittelteGewichtsklasse,
            graduierung: GRADUIERUNG_IDS.has(graduierung) ? graduierung : null,
            startgeld_bezahlt: startgeld_bezahlt ? 1 : 0
        }).returning('id');

        const teilnehmerId = typeof idObj === 'object' ? idObj.id : idObj;
        return res.status(201).json({ success: true, teilnehmerId });

    } catch (error) {
        console.error('[Backend-Fehler Waage/Anmeldung]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTeilnehmerByTurnier(knex, req, res) {
    try {
        const { turnierId } = req.query;

        if (!turnierId) {
            return res.status(400).json({ error: 'Parameter turnierId wird benötigt.' });
        }

        const turnier = await knex('turniere').where({ id: parseInt(turnierId) }).first();
        if (!turnier) {
            return res.status(404).json({ error: 'Turnier nicht gefunden.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const userVereinName = user ? await resolveUserVereinName(knex, user) : null;

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);

        let query = knex('turnier_teilnehmer').where({ turnier_id: parseInt(turnierId) });

        // Wer kein freigegebenes Mitglied des ausrichtenden Vereins ist, sieht
        // ausschließlich die Teilnehmer des eigenen Vereins.
        if (!istGastgeberVerein) {
            query = query.andWhere({ verein: userVereinName || ' _kein_verein_ ' });
        }

        const athleten = await query.orderBy('nachname', 'asc');

        return res.json(athleten);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Hartes Löschen bleibt dem ausrichtenden Verein vorbehalten (Korrektur von Fehleinträgen/
// Duplikaten). Die Selbstabmeldung des eigenen Vereins läuft seit der Teilnehmer-Status-
// Einführung stattdessen über ziehZurueck (status='zurueckgezogen', Datensatz bleibt erhalten).
export async function deleteTeilnehmer(knex, req, res) {
    try {
        const { id } = req.params;

        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, athlet.turnier_id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        if (!istGastgeberVerein) {
            return res.status(403).json({ success: false, error: 'Nur Mitglieder des ausrichtenden Vereins dürfen Teilnehmer endgültig löschen. Zum Zurückziehen der eigenen Anmeldung bitte die entsprechende Funktion verwenden.' });
        }

        await knex('turnier_teilnehmer').where({ id }).del();
        return res.json({ success: true, message: 'Teilnehmer erfolgreich entfernt.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Selbstabmeldung des eigenen Vereins vor Anmeldeschluss: ersetzt das harte Löschen durch einen
// Statuswechsel — der Datensatz bleibt für Nachvollziehbarkeit erhalten (Zustand 2 der
// Teilnehmer-Spezifikation). Gleiche Guards wie das bisherige deleteTeilnehmer für Nicht-
// Gastgeber (Frist, Vereinszugehörigkeit, Teilnehmerlisten-Sperre).
export async function ziehZurueck(knex, req, res) {
    try {
        const { id } = req.params;

        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, athlet.turnier_id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const userVereinName = await resolveUserVereinName(knex, user);
        const isSameClub = userVereinName && athlet.verein === userVereinName;
        if (!isSameClub) {
            return res.status(403).json({ success: false, error: 'Sie dürfen nur Teilnehmer Ihres eigenen Vereins zurückziehen.' });
        }
        if (ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) !== 'veroeffentlicht') {
            return res.status(403).json({ success: false, error: 'Abmeldungen sind für dieses Turnier nicht mehr möglich.' });
        }

        await knex('turnier_teilnehmer').where({ id }).update({ status: 'zurueckgezogen', updated_at: knex.fn.now() });
        return res.json({ success: true, message: 'Teilnehmer erfolgreich zurückgezogen.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTeilnehmerById(knex, req, res) {
    try {
        const { id } = req.params;
        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }
        return res.json(athlet);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateTeilnehmer(knex, req, res) {
    try {
        const { id } = req.params;
        const { vorname, nachname, judopass_id, verein, geburtsdatum, lizenz_ablauf, geschlecht, gewicht, altersklasse, gewichtsklasse, startgeld_bezahlt, graduierung } = req.body;

        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, athlet.turnier_id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        const userVereinName = await resolveUserVereinName(knex, user);
        const isSameClub = userVereinName && athlet.verein === userVereinName;

        if (!istGastgeberVerein) {
            if (!isSameClub) {
                return res.status(403).json({ success: false, error: 'Sie dürfen nur Teilnehmer Ihres eigenen Vereins bearbeiten.' });
            }
            if (ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) !== 'veroeffentlicht') {
                return res.status(403).json({ success: false, error: 'Änderungen sind für dieses Turnier nicht mehr möglich.' });
            }
            if (verein && verein !== userVereinName) {
                return res.status(403).json({ success: false, error: `Sie können den Verein nicht auf einen anderen Club als Ihren eigenen (${userVereinName}) ändern.` });
            }
        }

        await knex('turnier_teilnehmer')
            .where({ id })
            .update({
                vorname,
                nachname,
                judopass_id,
                verein: istGastgeberVerein ? (verein !== undefined ? (verein || '') : athlet.verein) : userVereinName,
                geburtsdatum,
                lizenz_ablauf,
                geschlecht,
                gewicht: gewicht !== undefined ? parseFloat(gewicht) : athlet.gewicht,
                altersklasse,
                gewichtsklasse,
                graduierung: graduierung !== undefined ? (GRADUIERUNG_IDS.has(graduierung) ? graduierung : null) : athlet.graduierung,
                startgeld_bezahlt: startgeld_bezahlt !== undefined ? (startgeld_bezahlt ? 1 : 0) : athlet.startgeld_bezahlt,
                updated_at: knex.fn.now()
            });

        return res.json({ success: true, message: 'Teilnehmer erfolgreich aktualisiert.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Bestätigt "kampfbereit" am Wiegetisch: Judoka ist erschienen, Gewicht passt, Lizenz/Pass
// wurden geprüft (Zustand 3 der Teilnehmer-Spezifikation, Voraussetzung für die Auslosung).
// Gleiche Zugriffsregel wie aendereStatusFelder — nur der ausrichtende Verein bestätigt.
export async function bestaetigeKampfbereit(knex, req, res) {
    try {
        const { id } = req.params;
        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();
        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        if (!istGastgeberVerein) {
            return res.status(403).json({ success: false, error: 'Nur Mitglieder des ausrichtenden Vereins dürfen Kampfbereitschaft bestätigen.' });
        }

        // Erneutes Bestätigen nach einer versehentlichen nicht_erschienen-Markierung (spätes
        // Erscheinen vor dem Start der Pool-Zuteilung) bleibt möglich.
        if (!['angemeldet', 'nicht_erschienen'].includes(athlet.status)) {
            return res.status(400).json({ success: false, error: `Kampfbereitschaft kann aus dem Status "${athlet.status}" nicht bestätigt werden.` });
        }

        const heuteStr = new Date().toISOString().split('T')[0];
        if (!athlet.lizenz_ablauf || athlet.lizenz_ablauf < heuteStr) {
            return res.status(400).json({ success: false, error: 'Die Lizenz ist abgelaufen oder nicht hinterlegt.' });
        }
        // Bei kostenlosen Turnieren (Startgeld 0€) gilt jeder als bezahlt, analog zur
        // Frontend-Logik in teilnehmer.js (berechneStatus).
        const turnierKostenlos = (parseFloat(turnier.startgeld) || 0) === 0;
        if (!turnierKostenlos && !athlet.startgeld_bezahlt) {
            return res.status(400).json({ success: false, error: 'Das Startgeld ist noch nicht bezahlt.' });
        }
        if (!athlet.gewicht || parseFloat(athlet.gewicht) <= 0) {
            return res.status(400).json({ success: false, error: 'Es ist kein gültiges Gewicht hinterlegt.' });
        }
        if (!athlet.judopass_id || !String(athlet.judopass_id).trim()) {
            return res.status(400).json({ success: false, error: 'Es ist keine Judopass-Nummer hinterlegt.' });
        }

        await knex('turnier_teilnehmer').where({ id }).update({ status: 'kampfbereit', updated_at: knex.fn.now() });
        return res.json({ success: true, message: 'Kampfbereitschaft bestätigt.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Löst den aktuellen Kampf eines Teilnehmers als Forfeit-Sieg für den Gegner auf (10 Punkte,
// identisches Muster zum bestehenden automatischen Freilos-Sieg) und setzt den Teilnehmer-
// Status. Gemeinsame Grundlage für markiereNichtAngetreten/disqualifiziere.
async function loeseKampfAlsForfeitAuf(knex, athlet, kampfId, neuerTeilnehmerStatus) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf) {
        throw Object.assign(new Error('Kampf nicht gefunden.'), { statusCode: 404 });
    }
    if (kampf.kaempfer1_id !== athlet.id && kampf.kaempfer2_id !== athlet.id) {
        throw Object.assign(new Error('Der Teilnehmer ist an diesem Kampf nicht beteiligt.'), { statusCode: 400 });
    }
    if (kampf.status === 'beendet' || kampf.status === 'freilos') {
        throw Object.assign(new Error('Dieser Kampf ist bereits abgeschlossen.'), { statusCode: 409 });
    }

    const istKaempfer1 = kampf.kaempfer1_id === athlet.id;
    const gegnerId = istKaempfer1 ? kampf.kaempfer2_id : kampf.kaempfer1_id;
    if (!gegnerId) {
        throw Object.assign(new Error('Der Kampf hat keinen Gegner, gegen den gewertet werden könnte.'), { statusCode: 400 });
    }

    await knex('turnier_teilnehmer').where({ id: athlet.id }).update({ status: neuerTeilnehmerStatus, updated_at: knex.fn.now() });
    await knex('kaempfe').where({ id: kampfId }).update({
        status: 'beendet',
        sieger_id: gegnerId,
        unterbewertung_kaempfer1: istKaempfer1 ? 0 : 10,
        unterbewertung_kaempfer2: istKaempfer1 ? 10 : 0,
        updated_at: knex.fn.now()
    });

    const { triggerPoolUpdate } = await import('./kampfController.js');
    const { planeKaempfeFuerKampfflaeche } = await import('./poolController.js');
    await triggerPoolUpdate(knex, kampf.pool_id);
    const pool = await knex('pools').where({ id: kampf.pool_id }).first();
    if (pool && pool.kampfflaeche_id) {
        await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
    }
}

// Zustand 6: war kampfbereit, stand aber bei Aufruf nicht auf der Matte (z.B. Verletzung beim
// Aufwärmen). Der Kampf wird als regulärer Sieg mit 10 Punkten für den Gegner gewertet.
export async function markiereNichtAngetreten(knex, req, res) {
    try {
        const { id } = req.params;
        const { kampf_id } = req.body;
        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();
        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        if (!istGastgeberVerein) {
            return res.status(403).json({ success: false, error: 'Nur Mitglieder des ausrichtenden Vereins dürfen dies markieren.' });
        }

        await loeseKampfAlsForfeitAuf(knex, athlet, parseInt(kampf_id, 10), 'nicht_angetreten');
        return res.json({ success: true, message: 'Teilnehmer als nicht angetreten markiert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Zustand 7: Ausschluss wegen schwerem Regelverstoß (z.B. direktes Hansoku-make). Gleiche
// Forfeit-Wertung wie nicht_angetreten.
export async function disqualifiziere(knex, req, res) {
    try {
        const { id } = req.params;
        const { kampf_id } = req.body;
        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();
        const user = await knex('benutzer').where({ id: req.user.id }).first();
        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        if (!istGastgeberVerein) {
            return res.status(403).json({ success: false, error: 'Nur Mitglieder des ausrichtenden Vereins dürfen dies markieren.' });
        }

        await loeseKampfAlsForfeitAuf(knex, athlet, parseInt(kampf_id, 10), 'disqualifiziert');
        return res.json({ success: true, message: 'Teilnehmer disqualifiziert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Automatischer Übergang zu "teilgenommen": mindestens ein Kampf mit Kampfzeit > 0 oder ein
// reguläres Freilos mit echtem Sieger. Aufgerufen aus kampfController.js's triggerPoolUpdate
// nach jedem Manager-Update, idempotent durch die status='kampfbereit'-Bedingung.
export async function markiereTeilgenommenFuerBeendeteKaempfe(knex, poolId) {
    const kaempfe = await knex('kaempfe')
        .where({ pool_id: poolId })
        .andWhere(function () {
            this.where('status', 'beendet').orWhere(function () {
                this.where('status', 'freilos').whereNotNull('sieger_id');
            });
        });

    const teilnehmerIds = new Set();
    kaempfe.forEach(k => {
        if (k.kaempfer1_id) teilnehmerIds.add(k.kaempfer1_id);
        if (k.kaempfer2_id) teilnehmerIds.add(k.kaempfer2_id);
    });

    if (teilnehmerIds.size === 0) return;

    await knex('turnier_teilnehmer')
        .whereIn('id', Array.from(teilnehmerIds))
        .andWhere('status', 'kampfbereit')
        .update({ status: 'teilgenommen', updated_at: knex.fn.now() });
}

// Bezahlt-/Gewogen-Status ändern (Einzel- und Bulk-Toggle in teilnehmer.html). Bewusst
// striktere Zugriffsregel als das generische updateTeilnehmer: im Online-Modus darf NUR ein
// Mitglied des ausrichtenden Vereins den Status setzen (nicht auch der eigene Verein des
// Teilnehmers) — im Offline-Modus wie gewohnt jeder. Nicht durch turnierHatEchteKaempfe gesperrt, da
// das Bezahlt-/Gewogen-Markieren die Pool-Zusammensetzung nicht verändert.
export async function aendereStatusFelder(knex, req, res) {
    try {
        const { id } = req.params;
        const { startgeld_bezahlt, lizenz_ablauf } = req.body;

        const athlet = await knex('turnier_teilnehmer').where({ id }).first();
        if (!athlet) {
            return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        }

        const turnier = await knex('turniere').where({ id: athlet.turnier_id }).first();
        const user = await knex('benutzer').where({ id: req.user.id }).first();

        const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
        if (!istGastgeberVerein) {
            return res.status(403).json({ success: false, error: 'Nur Mitglieder des ausrichtenden Vereins dürfen den Bezahlt-/Gewogen-Status ändern.' });
        }

        const updates = {};
        if (startgeld_bezahlt !== undefined) updates.startgeld_bezahlt = startgeld_bezahlt ? 1 : 0;
        if (lizenz_ablauf !== undefined) updates.lizenz_ablauf = lizenz_ablauf;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'Keine gültigen Felder zum Aktualisieren übergeben.' });
        }

        // Nach der Gewogen-/Bezahlt-Änderung automatisch prüfen, ob die Kampfbereitschafts-
        // Kriterien (dieselben Regeln wie in bestaetigeKampfbereit) jetzt erfüllt bzw. nicht
        // mehr erfüllt sind, und den Lebenszyklus-Status entsprechend mitziehen.
        const merged = { ...athlet, ...updates };
        const heuteStr = new Date().toISOString().split('T')[0];
        const lizenzGueltig = !!merged.lizenz_ablauf && merged.lizenz_ablauf >= heuteStr;
        const gewichtGueltig = !!merged.gewicht && parseFloat(merged.gewicht) > 0;
        const judopassVorhanden = !!merged.judopass_id && String(merged.judopass_id).trim() !== '';
        // Bei kostenlosen Turnieren (Startgeld 0€) gilt jeder als bezahlt, analog zur
        // Frontend-Logik in teilnehmer.js (berechneStatus) und zu bestaetigeKampfbereit.
        const turnierKostenlos = (parseFloat(turnier.startgeld) || 0) === 0;
        const startgeldBezahlt = turnierKostenlos || !!merged.startgeld_bezahlt;
        const kampfbereitErfuellt = lizenzGueltig && gewichtGueltig && judopassVorhanden && startgeldBezahlt;

        if (kampfbereitErfuellt && ['angemeldet', 'nicht_erschienen'].includes(athlet.status)) {
            updates.status = 'kampfbereit';
        } else if (!kampfbereitErfuellt && athlet.status === 'kampfbereit') {
            updates.status = 'angemeldet';
        }

        await knex('turnier_teilnehmer').where({ id }).update({ ...updates, updated_at: knex.fn.now() });
        return res.json({ success: true, status: updates.status || athlet.status });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// --- CSV / XLSX IMPORT ---

function normalizeHeader(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_FIELD_MAP = {
    vorname: 'vorname',
    name: 'nachname',
    nachname: 'nachname',
    passnr: 'judopass_id',
    passnummer: 'judopass_id',
    judopassnr: 'judopass_id',
    judopassnummer: 'judopass_id',
    geburtsdatum: 'geburtsdatum',
    geburtstag: 'geburtsdatum',
    verein: 'verein',
    club: 'verein',
    geschlecht: 'geschlecht',
    graduierung: 'graduierung',
    kyu: 'graduierung',
    grtel: 'graduierung',
    gurt: 'graduierung',
    gewicht: 'gewicht'
};

function normalizeDatum(wert) {
    const str = String(wert || '').trim();
    const deMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (deMatch) {
        let [, day, month, year] = deMatch;
        if (year.length === 2) year = `20${year}`;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return str;
}

function normalizeGeschlecht(wert) {
    const str = String(wert || '').trim().toLowerCase();
    if (str === 'm' || str === 'männlich' || str === 'maennlich') return 'männlich';
    if (str === 'w' || str === 'weiblich') return 'weiblich';
    if (str === 'mixed' || str === 'x') return 'mixed';
    return '';
}

// Faltet deutsche Umlaute/ß auf ASCII, damit z.B. "weiß" und "weiss" gleich behandelt werden.
function faltUmlaute(str) {
    return str.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

const KYU_GRADUIERUNGEN = GRADUIERUNGEN.filter(g => g.id.endsWith('kyu'));
const DAN_GRADUIERUNGEN = GRADUIERUNGEN.filter(g => g.id.endsWith('dan'));
const MAX_KYU = KYU_GRADUIERUNGEN.length;
const MAX_DAN = DAN_GRADUIERUNGEN.length;

// Farbname aus der Klammer im Label (z.B. "weiß-gelb" aus "8. Kyu (weiß-gelb)") -> Graduierungs-ID.
// Wird direkt aus graduierungen.json abgeleitet, damit Änderungen an der Farbskala (z.B. Anzahl
// der Kyu-Grade) hier nicht separat nachgepflegt werden müssen. Für Kombi-Farben wird zusätzlich
// eine bindestrichlose Variante erzeugt (z.B. "orangegrün" neben "orange-grün"). Längste Namen
// zuerst geprüft, damit z.B. "orange-grün" nicht schon als "orange" erkannt wird.
const GRADUIERUNG_FARB_REIHENFOLGE = KYU_GRADUIERUNGEN
    .flatMap(g => {
        const match = g.label.match(/\(([^)]+)\)/);
        if (!match) return [];
        const farbe = faltUmlaute(match[1].toLowerCase());
        const varianten = new Set([farbe, farbe.replace(/-/g, '')]);
        return [...varianten].map(v => [v, g.id]);
    })
    .sort((a, b) => b[0].length - a[0].length);

function extrahiereGrad(str, art) {
    let match = str.match(new RegExp(`(\\d+)\\s*\\.?\\s*${art}`));
    if (match) return parseInt(match[1], 10);
    match = str.match(new RegExp(`${art}\\s*\\.?\\s*(\\d+)`));
    if (match) return parseInt(match[1], 10);
    return null;
}

// Wandelt Freitext aus dem Import (z.B. "8. Kyu", "Kyu 3", "orange-grün", "1. Dan") in die
// interne Graduierungs-ID (z.B. "8kyu", "3kyu", "4kyu", "1dan") um.
function normalizeGraduierung(wert) {
    const str = faltUmlaute(String(wert || '').trim().toLowerCase());
    if (!str) return '';

    const kyuNr = extrahiereGrad(str, 'kyu');
    if (kyuNr && kyuNr >= 1 && kyuNr <= MAX_KYU) return `${kyuNr}kyu`;

    const danNr = extrahiereGrad(str, 'dan');
    if (danNr && danNr >= 1 && danNr <= MAX_DAN) return `${danNr}dan`;

    for (const [farbe, id] of GRADUIERUNG_FARB_REIHENFOLGE) {
        if (str.includes(farbe)) return id;
    }

    return '';
}

// Liest die vom Turnier ausgetragenen Altersklassen-Schlüssel aus (identische Herleitung wie
// ermittleTurnierAltersklassenKeys in poolController.js) — null = keine Einschränkung bekannt.
function ermittleTurnierAltersklassenKeys(turnier) {
    let ak = turnier.altersklassen;
    if (typeof ak === 'string') {
        try { ak = JSON.parse(ak); } catch (e) { ak = {}; }
    }
    let keys = null;
    if (Array.isArray(ak)) keys = ak;
    else if (ak && typeof ak === 'object') keys = Object.keys(ak);
    return keys && keys.length > 0 ? keys : null;
}

const STANDARD_ALTERSKLASSEN_IDS = ['U9', 'U11', 'U13', 'U15', 'U18', 'U21', 'Männer', 'Frauen', 'Mixed'];

// Ermittelt die Altersklasse anhand des Geburtsjahres und des Wettkampfjahres (Spiegelt die
// Alterslogik aus der Waage-Maske, siehe bestimmeUndWaehleAltersklasse in waage.js).
//
// 1. Zuerst wird wie bisher die feste Standardtabelle geprüft — ist deren Ergebnis für dieses
//    Geschlecht beim Turnier aktiviert, bleibt das bisherige Verhalten unverändert (kein Risiko
//    für bereits funktionierende Turniere).
// 2. Andernfalls werden die frei benannten Klassen dieses Turniers (siehe "+"-Button in
//    turnier.html) durchsucht: "U<Zahl>" (Alter < Zahl, kleinste passende Zahl gewinnt) und
//    "Ü<Zahl>"/"Veteranen" (Alter >= Zahl, ohne explizite Zahl gilt "Veteranen" als Ü30; größte
//    passende Zahl gewinnt).
function ermittleAltersklasse(geburtsdatum, geschlecht, wettkampfJahr, turnierAltersklassenKeys) {
    const geburtsJahr = parseInt(String(geburtsdatum).slice(0, 4), 10);
    if (!geburtsJahr || !wettkampfJahr) return '';

    const alter = wettkampfJahr - geburtsJahr;

    let standardKandidat = '';
    if (alter >= 5 && alter <= 7) standardKandidat = 'U9';
    else if (alter >= 8 && alter <= 10) standardKandidat = 'U11';
    else if (alter >= 11 && alter <= 12) standardKandidat = 'U13';
    else if (alter >= 13 && alter <= 14) standardKandidat = 'U15';
    else if (alter >= 15 && alter <= 17) standardKandidat = 'U18';
    else if (alter >= 18 && alter <= 20) standardKandidat = 'U21';
    else if (alter > 20) {
        standardKandidat = geschlecht === 'weiblich' ? 'Frauen' : (geschlecht === 'mixed' ? 'Mixed' : 'Männer');
    }

    if (!turnierAltersklassenKeys) return standardKandidat;

    const istAktiviert = (id) => turnierAltersklassenKeys.includes(`${geschlecht}_${id}`) || turnierAltersklassenKeys.includes(`mixed_${id}`);

    if (standardKandidat && istAktiviert(standardKandidat)) {
        return standardKandidat;
    }

    // Frei benannte Klassen dieses Geschlechts (inkl. "mixed") ermitteln
    const freieIds = turnierAltersklassenKeys
        .filter(k => k.startsWith(`${geschlecht}_`) || k.startsWith('mixed_'))
        .map(k => k.slice(k.indexOf('_') + 1))
        .filter(id => !STANDARD_ALTERSKLASSEN_IDS.includes(id));

    let besteUKlasse = null;
    let besteVeteranenKlasse = null;

    freieIds.forEach(id => {
        const uMatch = id.match(/^U\s*(\d+)$/i);
        if (uMatch) {
            const n = parseInt(uMatch[1], 10);
            if (alter < n && (!besteUKlasse || n < besteUKlasse.n)) {
                besteUKlasse = { id, n };
            }
            return;
        }

        const ueExplizit = id.match(/Ü\s*(\d+)/i);
        const istVeteranenName = /veteranen/i.test(id);
        if (ueExplizit || istVeteranenName) {
            const n = ueExplizit ? parseInt(ueExplizit[1], 10) : 30;
            if (alter >= n && (!besteVeteranenKlasse || n > besteVeteranenKlasse.n)) {
                besteVeteranenKlasse = { id, n };
            }
        }
    });

    if (besteUKlasse) return besteUKlasse.id;
    if (besteVeteranenKlasse) return besteVeteranenKlasse.id;

    // Nichts Passendes unter den aktivierten Klassen gefunden: trotzdem die alters-typische
    // Standardklasse zurückgeben (statt komplett leer zu bleiben) — sonst zeigt die
    // Teilnehmerliste beim Import nur noch das Geschlecht ohne jede Alters-/Gewichtsklasse an.
    // Das ist unschädlich für die Pool-Bildung: istAltersklasseAusgetragen(Server) prüft ohnehin
    // strikt gegen turnierAltersklassenKeys, ein hier zurückgegebener, nicht aktivierter Wert
    // bleibt also weiterhin korrekt "rot"/ausgeschlossen von der Auslosung.
    return standardKandidat;
}

// Ordnet ein Gewicht der passenden DJB-Gewichtsklasse zu (kleinste "-X"-Klasse, die das Gewicht
// noch aufnimmt, sonst die "+X"-Schwergewichtsklasse) — identische Logik zu
// befehleGewichtsklassenDropdown() in public/js/waage.js, hier für den CSV/XLSX-Import benötigt,
// da dort keine manuelle Dropdown-Auswahl stattfindet.
function ermittleGewichtsklasse(geschlecht, altersklasse, gewicht) {
    if (!gewicht || gewicht <= 0) return '';

    const klassenFuerGeschlecht = DJB_ALTERSKLASSEN[geschlecht] || [];
    const selektierteKlasse = klassenFuerGeschlecht.find(k => k.id === altersklasse);
    if (!selektierteKlasse || !selektierteKlasse.gewichtsklassen) return '';

    const plusKlasse = selektierteKlasse.gewichtsklassen.find(g => g.startsWith('+'));
    const minusKlassen = selektierteKlasse.gewichtsklassen
        .filter(g => g.startsWith('-'))
        .map(g => parseFloat(g.replace('-', '')))
        .sort((a, b) => a - b);

    const passendeMinusGrenze = minusKlassen.find(grenze => gewicht <= grenze);
    if (passendeMinusGrenze !== undefined) return `-${passendeMinusGrenze}`;
    return plusKlasse || '';
}

function parseImportRows(buffer, filename) {
    const isCsv = /\.csv$/i.test(filename || '');
    const workbook = isCsv
        ? XLSX.read(buffer.toString('utf-8'), { type: 'string' })
        : XLSX.read(buffer, { type: 'buffer', cellDates: true });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
    if (rows.length === 0) return [];

    const headerRow = rows[0];
    const fieldByColumn = headerRow.map(h => HEADER_FIELD_MAP[normalizeHeader(h)] || null);

    const records = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(cell => cell === '' || cell === undefined || cell === null)) continue;

        const record = {};
        fieldByColumn.forEach((field, colIdx) => {
            if (field) record[field] = row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';
        });
        records.push({ rowNumber: i + 1, record });
    }

    return records;
}

export async function importTeilnehmer(knex, req, res) {
    try {
        const { turnier_id, filename, contentBase64 } = req.body;

        if (!turnier_id || !contentBase64) {
            return res.status(400).json({ success: false, error: 'Turnier-ID und Dateiinhalt sind erforderlich.' });
        }

        const turnier = await knex('turniere').where({ id: parseInt(turnier_id) }).first();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const hatEchteKaempfe = await turnierHatEchteKaempfe(knex, turnier.id);
        if (hatEchteKaempfe) {
            return res.status(409).json({ success: false, error: TEILNEHMERLISTE_GESPERRT_FEHLER });
        }

        const user = await knex('benutzer').where({ id: req.user.id }).first();
        if (!user) {
            return res.status(401).json({ success: false, error: 'Benutzerprofil nicht gefunden.' });
        }

        const userVereinName = await resolveUserVereinName(knex, user);
        const istOffline = process.env.IS_OFFLINE === 'true';
        const istGastgeberVerein = istOffline || hatVereinsZugriffAufTurnier(user, turnier);

        if (!istGastgeberVerein) {
            if (ermittleEffektivenStatus(turnier, { hatEchteKaempfe }) !== 'veroeffentlicht') {
                return res.status(403).json({ success: false, error: 'Die Anmeldung für dieses Turnier ist nicht geöffnet.' });
            }
            if (!userVereinName) {
                return res.status(400).json({ success: false, error: 'Bitte treten Sie zuerst einem Verein bei.' });
            }
        }

        let buffer;
        try {
            buffer = Buffer.from(contentBase64, 'base64');
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Ungültiger Dateiinhalt.' });
        }

        let rows;
        try {
            rows = parseImportRows(buffer, filename);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        if (rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Die Datei enthält keine verwertbaren Datenzeilen.' });
        }

        const wettkampfJahr = turnier.datum ? new Date(turnier.datum).getFullYear() : new Date().getFullYear();
        const turnierAltersklassenKeys = ermittleTurnierAltersklassenKeys(turnier);

        let imported = 0;
        const skipped = [];

        for (const { rowNumber, record } of rows) {
            const vorname = record.vorname || '';
            const nachname = record.nachname || '';
            const judopass_id = record.judopass_id || '';
            const geburtsdatum = normalizeDatum(record.geburtsdatum);
            const geschlecht = normalizeGeschlecht(record.geschlecht);
            const graduierung = normalizeGraduierung(record.graduierung) || null;
            let verein = record.verein || '';

            if (!vorname || !nachname || !geburtsdatum || !geschlecht) {
                skipped.push({ row: rowNumber, reason: 'Vorname, Name, Geburtsdatum und Geschlecht sind Pflichtfelder.' });
                continue;
            }

            // Altersklasse anhand des Geburtsdatums ermitteln (analog zu waage.html)
            const altersklasse = ermittleAltersklasse(geburtsdatum, geschlecht, wettkampfJahr, turnierAltersklassenKeys);

            // Online: Verein wird nie aus der Datei übernommen, sondern immer auf den Verein
            // des angemeldeten Benutzers gesetzt (verhindert falsche/fremde Vereinsangaben in
            // der Importdatei). Offline: Der Wert aus der Datei wird unverändert übernommen.
            if (!istOffline) {
                verein = userVereinName;
            }

            if (!verein) {
                skipped.push({ row: rowNumber, reason: 'Verein fehlt.' });
                continue;
            }

            try {
                if (judopass_id) {
                    const bestehender = await knex('turnier_teilnehmer')
                        .where({ turnier_id: parseInt(turnier_id), judopass_id: judopass_id.trim() })
                        .first();

                    // Bereits vorhandene Pass-Nr. wird nicht erneut angelegt, aber auch nicht mehr
                    // als Fehler gemeldet — bei wiederholtem Import derselben Vereinsliste ist das
                    // erwartetes, unauffälliges Verhalten statt eine Meldung wert.
                    if (bestehender) {
                        continue;
                    }
                }

                // Gewicht robust parsen: deutsches Komma-Dezimaltrennzeichen (z.B. "26,5" aus
                // Excel-Exporten) wird wie bei der manuellen Eingabe in waage.js in einen Punkt
                // umgewandelt, sonst schneidet parseFloat bei "26,5" auf 26 ab.
                const gewichtGeparst = parseFloat(String(record.gewicht ?? '').replace(',', '.')) || 0.00;

                await knex('turnier_teilnehmer').insert({
                    turnier_id: parseInt(turnier_id),
                    // judopass_id ist NOT NULL, wird von der Anwendung aber als optional
                    // behandelt — leerer String statt null (siehe createTeilnehmer).
                    judopass_id: judopass_id || '',
                    vorname,
                    nachname,
                    geburtsdatum,
                    lizenz_ablauf: '1970-01-01',
                    geschlecht,
                    verein,
                    gewicht: gewichtGeparst,
                    altersklasse,
                    gewichtsklasse: ermittleGewichtsklasse(geschlecht, altersklasse, gewichtGeparst),
                    graduierung
                });

                imported++;
            } catch (rowError) {
                skipped.push({ row: rowNumber, reason: rowError.message });
            }
        }

        return res.json({ success: true, imported, skipped, total: rows.length });
    } catch (error) {
        console.error('[Teilnehmer-Import-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
