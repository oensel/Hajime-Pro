import { setzeAktivenVerein, ladeVereineFuerBenutzer } from '../utils/vereinHelper.js';
import { sendeMail } from '../utils/mailer.js';
import { SUPER_ADMIN_EMAIL } from '../utils/superAdmin.js';

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
 * Benachrichtigt per Mail, wer über eine neue Beitrittsanfrage entscheiden muss: den Super-Admin,
 * wenn der Verein noch kein freigegebenes Mitglied hat (Erstregistrierung, siehe "Erstnutzer-
 * Freigabe-Flow"), sonst alle bereits freigegebenen Mitglieder dieses Vereins.
 * @param {Object} knex - Knex instance
 * @param {Object} antragsteller - Row from the benutzer table (der Beitretende)
 * @param {number} vereinId
 * @param {string} vereinName
 * @param {boolean} istErstregistrierung
 */
async function benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, vereinId, vereinName, istErstregistrierung) {
    const antragstellerName = `${antragsteller.vorname} ${antragsteller.nachname}`;

    if (istErstregistrierung) {
        await sendeMail({
            to: SUPER_ADMIN_EMAIL,
            subject: `Hajime Pro: Erstregistrierung für Verein "${vereinName}" wartet auf Prüfung`,
            text: `${antragstellerName} (${antragsteller.email}) hat sich als erste Person für den Verein "${vereinName}" registriert und wartet auf Ihre Prüfung.\n\nBitte prüfen Sie kurz, ob die Person berechtigt ist (z.B. Vorstand/Trainer laut Vereins-Website/Impressum), und schalten Sie den Account anschließend in Hajime Pro unter "Mein Profil" frei.`
        });
        return;
    }

    const bestehendeMitglieder = await knex('benutzer_vereine')
        .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
        .where({ 'benutzer_vereine.verein_id': vereinId, 'benutzer_vereine.freigegeben': 1 })
        .select('benutzer.email');

    const empfaenger = bestehendeMitglieder.map(m => m.email);
    if (empfaenger.length === 0) return;

    await sendeMail({
        to: empfaenger,
        subject: `Hajime Pro: Neue Freischaltungsanfrage für "${vereinName}"`,
        text: `${antragstellerName} (${antragsteller.email}) möchte sich als Funktionär für Ihren Verein "${vereinName}" freischalten.\n\nBitte prüfen und bestätigen Sie die Anfrage in Hajime Pro auf der Turnierübersicht.`
    });
}

export async function joinVerein(knex, req, res) {
    try {
        const userId = req.user.id;
        const { vereinId, newVereinName } = req.body;

        if (!vereinId && !newVereinName) {
            return res.status(400).json({ success: false, error: 'Verein-ID oder Name eines neuen Vereins ist erforderlich.' });
        }

        let targetVereinId;
        let targetVereinName;
        let istErstregistrierung;

        if (newVereinName && newVereinName.trim()) {
            const name = newVereinName.trim();
            const existing = await knex('vereine').where({ name }).first();
            if (existing) {
                return res.status(409).json({ success: false, error: 'Ein Verein mit diesem Namen existiert bereits.' });
            }
            const [inserted] = await knex('vereine').insert({ name }).returning('id');
            targetVereinId = typeof inserted === 'object' ? inserted.id : inserted;
            targetVereinName = name;
            istErstregistrierung = true;
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

            const approvedMember = await knex('benutzer_vereine')
                .where({ verein_id: targetVereinId, freigegeben: 1 })
                .first();
            istErstregistrierung = !approvedMember;
        }

        // Jeder Beitritt startet als "wartet auf Prüfung" — ob der Super-Admin (Erstregistrierung
        // eines Vereins) oder ein bereits freigegebenes Mitglied (weiterer Funktionär) prüft,
        // entscheidet sich allein daran, ob der Verein schon ein freigegebenes Mitglied hat.
        await knex('benutzer_vereine').insert({
            benutzer_id: userId,
            verein_id: targetVereinId,
            freigegeben: 0
        });

        // Der neu beigetretene Verein wird direkt zum aktiven Verein — der Nutzer wollte
        // gerade dorthin wechseln (Erstbeitritt oder bewusster Beitritt zu einem weiteren Verein).
        await knex('benutzer').where({ id: userId }).update({
            aktiver_verein_id: targetVereinId,
            updated_at: knex.fn.now()
        });

        const antragsteller = await knex('benutzer').where({ id: userId }).first();
        benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, targetVereinId, targetVereinName, istErstregistrierung)
            .catch(err => console.error('[Verein-Join-Benachrichtigung-Fehler]:', err));

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

        const eigeneMitgliedschaften = await knex('benutzer_vereine').where({ benutzer_id: userId });
        const zuVerlassen = eigeneMitgliedschaften.find(m => m.verein_id === vereinId);
        if (!zuVerlassen) {
            return res.status(404).json({ success: false, error: 'Sie sind kein Mitglied dieses Vereins.' });
        }
        if (eigeneMitgliedschaften.length <= 1) {
            return res.status(409).json({
                success: false,
                error: 'Sie können Ihren einzigen Verein nicht verlassen — ein Benutzer muss immer mindestens einem Verein angehören. Treten Sie zuerst einem anderen Verein bei.'
            });
        }

        // Vor dem Löschen erfassen: Löschen eines verwaisten Vereins unten setzt
        // benutzer.aktiver_verein_id per ON DELETE SET NULL bereits automatisch zurück, bevor
        // wir selbst nachschauen könnten, ob der verlassene Verein der aktive war.
        const benutzerVorherigerStand = await knex('benutzer').where({ id: userId }).first();
        const warAktiverVerein = benutzerVorherigerStand.aktiver_verein_id === vereinId;

        await knex('benutzer_vereine').where({ benutzer_id: userId, verein_id: vereinId }).del();

        // Verwaisten Verein (kein Mitglied mehr) entfernen — wie bisher beim Vereinswechsel.
        let vereinGeloescht = false;
        const verbleibende = await knex('benutzer_vereine').where({ verein_id: vereinId }).count('* as anzahl').first();
        if (parseInt(verbleibende.anzahl, 10) === 0) {
            await knex('vereine').where({ id: vereinId }).del();
            vereinGeloescht = true;
        }

        if (warAktiverVerein) {
            const naechsterVerein = eigeneMitgliedschaften.find(m => m.verein_id !== vereinId);
            await knex('benutzer').where({ id: userId }).update({
                aktiver_verein_id: naechsterVerein ? naechsterVerein.verein_id : null,
                updated_at: knex.fn.now()
            });
        }

        res.json({ success: true, verein_geloescht: vereinGeloescht });
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

// Vereine, in denen der Benutzer freigegebenes Mitglied ist — Genehmigungsrechte gelten für
// jeden dieser Vereine, unabhängig vom gerade aktiven Verein (der ist reine UI-Ansicht).
async function ladeVerwalteteVereinIds(knex, benutzerId) {
    const mitgliedschaften = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, freigegeben: 1 });
    return mitgliedschaften.map(m => m.verein_id);
}

export async function getPendingRequests(knex, req, res) {
    try {
        const verwalteteVereinIds = await ladeVerwalteteVereinIds(knex, req.user.id);
        if (verwalteteVereinIds.length === 0) {
            return res.status(403).json({ success: false, error: 'Kein freigegebenes Vereinsmitglied.' });
        }

        const pending = await knex('benutzer_vereine')
            .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .whereIn('benutzer_vereine.verein_id', verwalteteVereinIds)
            .where('benutzer_vereine.freigegeben', 0)
            .select(
                'benutzer.id as id', 'benutzer.email as email',
                'benutzer.vorname as vorname', 'benutzer.nachname as nachname',
                'vereine.id as verein_id', 'vereine.name as verein_name'
            );

        res.json(pending);
    } catch (error) {
        console.error('[Vereine-Pending-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Beitrittsanfragen.' });
    }
}

async function assertApprover(knex, approverId, targetUserId, vereinId) {
    const verwalteteVereinIds = await ladeVerwalteteVereinIds(knex, approverId);
    if (!verwalteteVereinIds.includes(vereinId)) {
        return { ok: false, status: 403, error: 'Kein freigegebenes Mitglied dieses Vereins.' };
    }

    const zielMitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: targetUserId, verein_id: vereinId })
        .first();
    if (!zielMitgliedschaft) {
        return { ok: false, status: 404, error: 'Beitrittsanfrage nicht gefunden.' };
    }

    return { ok: true };
}

export async function approveMember(knex, req, res) {
    try {
        const { userId } = req.body;
        const vereinId = parseInt(req.body.vereinId);
        if (!userId || !vereinId) {
            return res.status(400).json({ success: false, error: 'userId und vereinId sind erforderlich.' });
        }

        const check = await assertApprover(knex, req.user.id, userId, vereinId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer_vereine').where({ benutzer_id: userId, verein_id: vereinId }).update({
            freigegeben: 1,
            updated_at: knex.fn.now()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[Verein-Approve-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe.' });
    }
}

export async function rejectMember(knex, req, res) {
    try {
        const { userId } = req.body;
        const vereinId = parseInt(req.body.vereinId);
        if (!userId || !vereinId) {
            return res.status(400).json({ success: false, error: 'userId und vereinId sind erforderlich.' });
        }

        const check = await assertApprover(knex, req.user.id, userId, vereinId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer_vereine').where({ benutzer_id: userId, verein_id: vereinId }).del();

        const benutzer = await knex('benutzer').where({ id: userId }).first();
        if (benutzer && benutzer.aktiver_verein_id === vereinId) {
            const verbleibende = await knex('benutzer_vereine').where({ benutzer_id: userId }).first();
            await knex('benutzer').where({ id: userId }).update({
                aktiver_verein_id: verbleibende ? verbleibende.verein_id : null,
                updated_at: knex.fn.now()
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Verein-Reject-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Ablehnung.' });
    }
}

// --- Super-Admin: Erstregistrierungen (Vereine ohne jedes freigegebene Mitglied) ---
// Getrennt von getPendingRequests/approveMember/rejectMember oben: jene sind für bereits
// freigegebene Vereinsmitglieder gedacht, die weitere Funktionäre ihres eigenen Vereins
// freischalten — für die allererste Person eines Vereins gibt es aber noch niemanden, der das
// könnte. Diese Anfragen sieht ausschließlich der Super-Admin (siehe requireSuperAdmin).

export async function getSuperAdminPendingRequests(knex, req, res) {
    try {
        const pending = await knex('benutzer_vereine')
            .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .where('benutzer_vereine.freigegeben', 0)
            .whereNotExists(function () {
                this.select('*').from('benutzer_vereine as bv2')
                    .whereRaw('bv2.verein_id = benutzer_vereine.verein_id')
                    .andWhere('bv2.freigegeben', 1);
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

async function assertErstregistrierung(knex, targetUserId, vereinId) {
    const zielMitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: targetUserId, verein_id: vereinId })
        .first();
    if (!zielMitgliedschaft) {
        return { ok: false, status: 404, error: 'Beitrittsanfrage nicht gefunden.' };
    }
    if (zielMitgliedschaft.freigegeben) {
        return { ok: false, status: 409, error: 'Diese Mitgliedschaft ist bereits freigegeben.' };
    }

    const approvedMember = await knex('benutzer_vereine')
        .where({ verein_id: vereinId, freigegeben: 1 })
        .first();
    if (approvedMember) {
        return { ok: false, status: 409, error: 'Dieser Verein hat bereits freigegebene Mitglieder — die Freigabe obliegt jetzt einem von ihnen.' };
    }

    return { ok: true };
}

export async function superApproveMember(knex, req, res) {
    try {
        const { userId } = req.body;
        const vereinId = parseInt(req.body.vereinId);
        if (!userId || !vereinId) {
            return res.status(400).json({ success: false, error: 'userId und vereinId sind erforderlich.' });
        }

        const check = await assertErstregistrierung(knex, userId, vereinId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer_vereine').where({ benutzer_id: userId, verein_id: vereinId }).update({
            freigegeben: 1,
            updated_at: knex.fn.now()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[Super-Admin-Approve-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe.' });
    }
}

export async function superRejectMember(knex, req, res) {
    try {
        const { userId } = req.body;
        const vereinId = parseInt(req.body.vereinId);
        if (!userId || !vereinId) {
            return res.status(400).json({ success: false, error: 'userId und vereinId sind erforderlich.' });
        }

        const check = await assertErstregistrierung(knex, userId, vereinId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer_vereine').where({ benutzer_id: userId, verein_id: vereinId }).del();

        const benutzer = await knex('benutzer').where({ id: userId }).first();
        if (benutzer && benutzer.aktiver_verein_id === vereinId) {
            const verbleibende = await knex('benutzer_vereine').where({ benutzer_id: userId }).first();
            await knex('benutzer').where({ id: userId }).update({
                aktiver_verein_id: verbleibende ? verbleibende.verein_id : null,
                updated_at: knex.fn.now()
            });
        }

        // Verwaisten Verein (keine Mitglieder/Anfragen mehr) entfernen — wie bei leaveVerein.
        const verbleibendeMitglieder = await knex('benutzer_vereine').where({ verein_id: vereinId }).count('* as anzahl').first();
        if (parseInt(verbleibendeMitglieder.anzahl, 10) === 0) {
            await knex('vereine').where({ id: vereinId }).del();
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[Super-Admin-Reject-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Ablehnung.' });
    }
}
