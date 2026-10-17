import { setzeAktivenVerein, ladeVereineFuerBenutzer, ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { sendeMail } from '../utils/mailer.js';
import {
    entscheideAnfrage, aendereRolle, entferneMitglied, ladeEmpfaengerFuerAnfrage, hatVereinAdmin, darfVereinVerwalten
} from '../services/vereinsRollen.js';
import { erzeugeToken } from '../services/einmalToken.js';
import { ermittleBasisUrl, HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';

export async function listVereine(knex, req, res) {
    try {
        const vereine = await knex('vereine').select('id', 'name').orderBy('name', 'asc');
        res.json(vereine);
    } catch (error) {
        console.error('[Vereine-List-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Vereine.' });
    }
}

/**
 * Benachrichtigt per Mail, wer über eine neue Beitrittsanfrage entscheiden muss: alle Admins des Vereins,
 * hat der Verein noch keinen Admin, alle Super-Admins (ladeEmpfaengerFuerAnfrage).
 * @param {Object} knex - Knex instance
 * @param {Object} antragsteller - Row from the benutzer table (der Beitretende)
 * @param {number} vereinId
 * @param {string} vereinName
 * @param {Function} [sende] - Mailversand (Standard sendeMail, in Tests ersetzbar)
 * @param {{ freischaltLink?: string }} [optionen] - einmaliger Link auf die Freischaltungs-Seite (Registrierung)
 */
export async function benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, vereinId, vereinName, sende = sendeMail, { freischaltLink } = {}) {
    const antragstellerName = `${antragsteller.vorname} ${antragsteller.nachname}`;
    const empfaenger = await ladeEmpfaengerFuerAnfrage(knex, vereinId);
    if (empfaenger.length === 0) return;
    const linkAbsatz = freischaltLink
        ? `

Direkt entscheiden (Rolle wählen, freischalten oder ablehnen; der Link gilt einmal):
${freischaltLink}`
        : '';

    if (!(await hatVereinAdmin(knex, vereinId))) {
        await sende({
            to: empfaenger,
            subject: `Hajime Pro: Anfrage für Verein "${vereinName}" ohne Admin wartet auf Prüfung`,
            text: `${antragstellerName} (${antragsteller.email}) möchte dem Verein "${vereinName}" beitreten. Der Verein hat noch keinen Admin, daher entscheiden Sie als Super-Admin.

Bitte prüfen Sie kurz, ob die Person berechtigt ist (z.B. Vorstand/Trainer laut Vereins-Website/Impressum), und schalten Sie den Account anschließend in Hajime Pro unter "Mein Profil" frei.${linkAbsatz}`
        });
        return;
    }

    await sende({
        to: empfaenger,
        subject: `Hajime Pro: Neue Freischaltungsanfrage für "${vereinName}"`,
        text: `${antragstellerName} (${antragsteller.email}) möchte sich für Ihren Verein "${vereinName}" freischalten.

Bitte prüfen Sie die Anfrage in Hajime Pro, wählen Sie eine Rolle (Admin, Benutzer oder Helfer) und schalten Sie sie frei.${linkAbsatz}`
    });
}

/**
 * POST /api/vereine/join — Beitrittsanfrage (Erstbeitritt oder weiterer Verein im Profil). Verlangt eine
 * bestätigte E-Mail-Adresse. Die Entscheider bekommen eine Mail mit einmaligem Freischaltungs-Link
 * (<basisUrl>/freigabe.html?token=…); ohne sichere Basis-URL (Cloud ohne PUBLIC_BASE_URL) ohne Link.
 * Die Quelle der Anfrage (Vorbelegung der Rolle) übernimmt die jüngste bestehende Mitgliedschaft, sonst 'verwaltung'.
 */
export async function joinVerein(knex, req, res, { sende = sendeMail } = {}) {
    try {
        const userId = req.user.id;
        const { vereinId, newVereinName } = req.body || {};

        if (!vereinId && !newVereinName) {
            return res.status(400).json({ success: false, error: 'Verein-ID oder Name eines neuen Vereins ist erforderlich.' });
        }

        const konto = await knex('benutzer').where({ id: userId }).first();
        if (!konto) {
            return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });
        }
        if (!konto.email_bestaetigt_am) {
            return res.status(403).json({
                success: false,
                code: 'email_unbestaetigt',
                error: 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.'
            });
        }

        let targetVereinId;
        let targetVereinName;

        if (newVereinName && newVereinName.trim()) {
            const name = newVereinName.trim();
            const existing = await knex('vereine').where({ name }).first();
            if (existing) {
                return res.status(409).json({ success: false, error: 'Ein Verein mit diesem Namen existiert bereits.' });
            }
            const [inserted] = await knex('vereine').insert({ name }).returning('id');
            targetVereinId = typeof inserted === 'object' ? inserted.id : inserted;
            targetVereinName = name;
        } else {
            targetVereinId = parseInt(vereinId);
            const verein = await knex('vereine').where({ id: targetVereinId }).first();
            if (!verein) {
                return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
            }
            targetVereinName = verein.name;

            const bestehendeMitgliedschaft = await knex('benutzer_vereine')
                .where({ benutzer_id: userId, verein_id: targetVereinId })
                .first();
            if (bestehendeMitgliedschaft) {
                return res.status(409).json({ success: false, error: 'Sie sind diesem Verein bereits beigetreten.' });
            }
        }

        // Jeder Beitritt startet als "wartet auf Prüfung" — ob der Super-Admin (Verein ohne Admin) oder
        // ein Admin des Vereins prüft, entscheidet sich allein daran, ob der Verein schon einen Admin hat.
        const letzteMitgliedschaft = await knex('benutzer_vereine')
            .where({ benutzer_id: userId })
            .whereNotNull('angefragt_ueber')
            .orderBy('id', 'desc')
            .first();
        const angefragtUeber = letzteMitgliedschaft ? letzteMitgliedschaft.angefragt_ueber : 'verwaltung';

        await knex('benutzer_vereine').insert({
            benutzer_id: userId,
            verein_id: targetVereinId,
            freigegeben: 0,
            angefragt_ueber: angefragtUeber
        });

        // Der neu beigetretene Verein wird direkt zum aktiven Verein — der Nutzer wollte
        // gerade dorthin wechseln (Erstbeitritt oder bewusster Beitritt zu einem weiteren Verein).
        await knex('benutzer').where({ id: userId }).update({
            aktiver_verein_id: targetVereinId,
            updated_at: knex.fn.now()
        });

        try {
            let freischaltLink;
            const basisUrl = ermittleBasisUrl(req);
            if (basisUrl) {
                const token = await erzeugeToken(knex, {
                    benutzerId: userId, zweck: 'freischaltung', vereinId: targetVereinId, angefragtUeber
                });
                freischaltLink = `${basisUrl}/freigabe.html?token=${encodeURIComponent(token)}`;
            } else {
                console.error(`[Verein-Join] ${HINWEIS_FEHLENDE_BASIS_URL} Freischaltungs-Mail ohne Link.`);
            }
            await benachrichtigeUeberBeitrittsanfrage(knex, konto, targetVereinId, targetVereinName, sende, { freischaltLink });
        } catch (err) {
            // Ohne Mail bleibt die Anfrage in der Liste offener Anfragen (Spec 4).
            console.error('[Verein-Join-Benachrichtigung-Fehler]:', err);
        }

        res.json({
            success: true,
            verein_id: targetVereinId,
            verein_freigegeben: false
        });
    } catch (error) {
        console.error('[Verein-Join-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Vereinsbeitritt.' });
    }
}

export async function leaveVerein(knex, req, res) {
    try {
        const userId = req.user.id;
        const vereinId = parseInt(req.body.vereinId);
        if (!vereinId) {
            return res.status(400).json({ success: false, error: 'vereinId ist erforderlich.' });
        }

        // Nicht-Mitglied (404), einziger Verein (409), letzter Admin, offene Helferdienste und das Aufräumen
        // (aktiver Verein, verwaister Verein) regelt der Service — derselbe Weg wie POST /entfernen.
        const ergebnis = await entferneMitglied(knex, { vereinId, benutzerId: userId, durchId: userId });
        if (!ergebnis.ok) {
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        res.json({ success: true, verein_geloescht: ergebnis.vereinGeloescht });
    } catch (error) {
        console.error('[Verein-Leave-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Verlassen des Vereins.' });
    }
}

export async function wechsleAktivenVerein(knex, req, res) {
    try {
        const userId = req.user.id;
        const vereinId = parseInt(req.body.vereinId);
        if (!vereinId) {
            return res.status(400).json({ success: false, error: 'vereinId ist erforderlich.' });
        }

        await setzeAktivenVerein(knex, userId, vereinId);
        const vereine = await ladeVereineFuerBenutzer(knex, userId);

        res.json({ success: true, vereine });
    } catch (error) {
        console.error('[Verein-Wechsel-Fehler]:', error);
        res.status(400).json({ success: false, error: error.message || 'Vereinswechsel fehlgeschlagen.' });
    }
}

// Vereine, in denen der Benutzer freigegebener Admin ist — Genehmigungsrechte gelten für jeden dieser
// Vereine, unabhängig vom gerade aktiven Verein (der ist reine UI-Ansicht). Benutzer und Helfer
// verwalten keine Mitglieder (Helferverwaltung, Spec 3.2).
function ladeVerwalteteVereinIds(knex, benutzerId) {
    return ladeVereinIdsMitRolle(knex, benutzerId, 'admin');
}

function sendeErgebnis(res, ergebnis) {
    if (!ergebnis.ok) {
        return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
    }
    return res.json({ success: true });
}

function leseZiel(req) {
    return { userId: req.body.userId, vereinId: parseInt(req.body.vereinId) };
}

function fehlendesZiel(res) {
    return res.status(400).json({ success: false, error: 'userId und vereinId sind erforderlich.' });
}

export async function getPendingRequests(knex, req, res) {
    try {
        const verwalteteVereinIds = await ladeVerwalteteVereinIds(knex, req.user.id);
        if (verwalteteVereinIds.length === 0) {
            return res.status(403).json({ success: false, error: 'Kein Admin eines Vereins.' });
        }

        const pending = await knex('benutzer_vereine')
            .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .whereIn('benutzer_vereine.verein_id', verwalteteVereinIds)
            .where('benutzer_vereine.freigegeben', 0)
            .select(
                'benutzer.id as id', 'benutzer.email as email',
                'benutzer.vorname as vorname', 'benutzer.nachname as nachname',
                'vereine.id as verein_id', 'vereine.name as verein_name',
                'benutzer_vereine.angefragt_ueber as angefragt_ueber'
            );

        res.json(pending);
    } catch (error) {
        console.error('[Vereine-Pending-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Beitrittsanfragen.' });
    }
}

export async function approveMember(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const ergebnis = await entscheideAnfrage(knex, {
            vereinId, benutzerId: userId, entscheiderId: req.user.id, entscheidung: 'freigeben', rolle: req.body.rolle
        });
        sendeErgebnis(res, ergebnis);
    } catch (error) {
        console.error('[Verein-Approve-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe.' });
    }
}

export async function rejectMember(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const ergebnis = await entscheideAnfrage(knex, {
            vereinId, benutzerId: userId, entscheiderId: req.user.id, entscheidung: 'ablehnen'
        });
        sendeErgebnis(res, ergebnis);
    } catch (error) {
        console.error('[Verein-Reject-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Ablehnung.' });
    }
}

export async function changeRolle(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const ergebnis = await aendereRolle(knex, { vereinId, benutzerId: userId, neueRolle: req.body.rolle, durchId: req.user.id });
        sendeErgebnis(res, ergebnis);
    } catch (error) {
        console.error('[Verein-Rolle-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Ändern der Rolle.' });
    }
}

export async function removeMember(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const ergebnis = await entferneMitglied(knex, { vereinId, benutzerId: userId, durchId: req.user.id });
        if (!ergebnis.ok) return sendeErgebnis(res, ergebnis);
        res.json({ success: true, verein_geloescht: ergebnis.vereinGeloescht });
    } catch (error) {
        console.error('[Verein-Entfernen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Entfernen des Mitglieds.' });
    }
}

/** Mitglieder eines Vereins (Admin des Vereins oder Super-Admin): Name, E-Mail, Rolle, Status. */
export async function getMitglieder(knex, req, res) {
    try {
        const vereinId = parseInt(req.query.vereinId);
        if (!vereinId) {
            return res.status(400).json({ success: false, error: 'vereinId ist erforderlich.' });
        }
        if (!(await darfVereinVerwalten(knex, req.user.id, vereinId))) {
            return res.status(403).json({ success: false, error: 'Nur Admins dieses Vereins sehen die Mitglieder.' });
        }

        const zeilen = await knex('benutzer_vereine')
            .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
            .where('benutzer_vereine.verein_id', vereinId)
            .select(
                'benutzer.id as id', 'benutzer.vorname as vorname', 'benutzer.nachname as nachname',
                'benutzer.email as email', 'benutzer_vereine.rolle as rolle', 'benutzer_vereine.freigegeben as freigegeben'
            )
            .orderBy([{ column: 'benutzer.nachname' }, { column: 'benutzer.vorname' }]);

        res.json(zeilen.map(z => ({
            id: z.id,
            vorname: z.vorname,
            nachname: z.nachname,
            email: z.email,
            rolle: z.freigegeben ? z.rolle : null,
            status: z.freigegeben ? 'freigegeben' : 'wartend'
        })));
    } catch (error) {
        console.error('[Verein-Mitglieder-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Mitglieder.' });
    }
}

// --- Super-Admin: Anfragen für Vereine ohne Admin ---
// Getrennt von getPendingRequests/approveMember/rejectMember oben: jene sind für Admins, die Mitglieder
// ihres eigenen Vereins freischalten. Hat ein Verein noch keinen Admin (Erstregistrierung, Altbestand),
// gibt es dort niemanden, der das könnte. Diese Anfragen sieht ausschließlich der Super-Admin.

export async function getSuperAdminPendingRequests(knex, req, res) {
    try {
        const pending = await knex('benutzer_vereine')
            .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .where('benutzer_vereine.freigegeben', 0)
            .whereNotExists(function () {
                this.select('*').from('benutzer_vereine as bv2')
                    .whereRaw('bv2.verein_id = benutzer_vereine.verein_id')
                    .andWhere('bv2.freigegeben', 1)
                    .andWhere('bv2.rolle', 'admin');
            })
            .select(
                'benutzer.id as id', 'benutzer.email as email',
                'benutzer.vorname as vorname', 'benutzer.nachname as nachname',
                'vereine.id as verein_id', 'vereine.name as verein_name'
            );

        res.json(pending);
    } catch (error) {
        console.error('[Super-Admin-Pending-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Erstregistrierungen.' });
    }
}

async function pruefeVereinOhneAdmin(knex, vereinId) {
    if (await hatVereinAdmin(knex, vereinId)) {
        return { ok: false, status: 409, error: 'Dieser Verein hat bereits einen Admin — die Freigabe obliegt jetzt ihm.' };
    }
    return { ok: true };
}

export async function superApproveMember(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const check = await pruefeVereinOhneAdmin(knex, vereinId);
        if (!check.ok) return sendeErgebnis(res, check);

        // Ohne Angabe wird die erste freigegebene Person eines Vereins ohne Admin dessen Admin.
        const rolle = req.body.rolle === undefined ? 'admin' : req.body.rolle;
        const ergebnis = await entscheideAnfrage(knex, {
            vereinId, benutzerId: userId, entscheiderId: req.user.id, entscheidung: 'freigeben', rolle
        });
        sendeErgebnis(res, ergebnis);
    } catch (error) {
        console.error('[Super-Admin-Approve-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe.' });
    }
}

export async function superRejectMember(knex, req, res) {
    try {
        const { userId, vereinId } = leseZiel(req);
        if (!userId || !vereinId) return fehlendesZiel(res);
        const check = await pruefeVereinOhneAdmin(knex, vereinId);
        if (!check.ok) return sendeErgebnis(res, check);

        // Ablehnen räumt auch einen dadurch verwaisten Verein ab (siehe entscheideAnfrage).
        const ergebnis = await entscheideAnfrage(knex, {
            vereinId, benutzerId: userId, entscheiderId: req.user.id, entscheidung: 'ablehnen'
        });
        sendeErgebnis(res, ergebnis);
    } catch (error) {
        console.error('[Super-Admin-Reject-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Ablehnung.' });
    }
}

