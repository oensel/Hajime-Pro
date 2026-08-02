export async function listVereine(knex, req, res) {
    try {
        const vereine = await knex('vereine').select('id', 'name').orderBy('name', 'asc');
        res.json(vereine);
    } catch (error) {
        console.error('[Vereine-List-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Vereine.' });
    }
}

export async function joinVerein(knex, req, res) {
    try {
        const userId = req.user.id;
        const { vereinId, newVereinName } = req.body;

        if (!vereinId && !newVereinName) {
            return res.status(400).json({ success: false, error: 'Verein-ID oder Name eines neuen Vereins ist erforderlich.' });
        }

        const currentUser = await knex('benutzer').where({ id: userId }).first();
        const alterVereinId = currentUser ? currentUser.verein_id : null;

        let targetVereinId;
        let freigegeben;

        if (newVereinName && newVereinName.trim()) {
            const name = newVereinName.trim();
            const existing = await knex('vereine').where({ name }).first();
            if (existing) {
                return res.status(409).json({ success: false, error: 'Ein Verein mit diesem Namen existiert bereits.' });
            }
            const [inserted] = await knex('vereine').insert({ name }).returning('id');
            targetVereinId = typeof inserted === 'object' ? inserted.id : inserted;
            freigegeben = 1;
        } else {
            targetVereinId = parseInt(vereinId);
            const verein = await knex('vereine').where({ id: targetVereinId }).first();
            if (!verein) {
                return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
            }
            const approvedMember = await knex('benutzer')
                .where({ verein_id: targetVereinId, verein_freigegeben: 1 })
                .first();
            freigegeben = approvedMember ? 0 : 1;
        }

        await knex('benutzer').where({ id: userId }).update({
            verein_id: targetVereinId,
            verein_freigegeben: freigegeben,
            updated_at: knex.fn.now()
        });

        // Wird beim Vereinswechsel der alte Verein dadurch mitgliederlos, wird er entfernt.
        let alterVereinGeloescht = false;
        if (alterVereinId && alterVereinId !== targetVereinId) {
            const verbleibende = await knex('benutzer').where({ verein_id: alterVereinId }).count('* as anzahl').first();
            if (parseInt(verbleibende.anzahl, 10) === 0) {
                await knex('vereine').where({ id: alterVereinId }).del();
                alterVereinGeloescht = true;
            }
        }

        res.json({
            success: true,
            verein_id: targetVereinId,
            verein_freigegeben: !!freigegeben,
            alter_verein_geloescht: alterVereinGeloescht
        });
    } catch (error) {
        console.error('[Verein-Join-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Vereinsbeitritt.' });
    }
}

export async function getPendingRequests(knex, req, res) {
    try {
        const currentUser = await knex('benutzer').where({ id: req.user.id }).first();
        if (!currentUser || !currentUser.verein_id || !currentUser.verein_freigegeben) {
            return res.status(403).json({ success: false, error: 'Kein freigegebenes Vereinsmitglied.' });
        }

        const pending = await knex('benutzer')
            .where({ verein_id: currentUser.verein_id, verein_freigegeben: 0 })
            .select('id', 'email', 'vorname', 'nachname');

        res.json(pending);
    } catch (error) {
        console.error('[Vereine-Pending-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Beitrittsanfragen.' });
    }
}

async function assertApprover(knex, approverId, targetUserId) {
    const approver = await knex('benutzer').where({ id: approverId }).first();
    const target = await knex('benutzer').where({ id: targetUserId }).first();

    if (!approver || !approver.verein_id || !approver.verein_freigegeben) {
        return { ok: false, status: 403, error: 'Kein freigegebenes Vereinsmitglied.' };
    }
    if (!target) {
        return { ok: false, status: 404, error: 'Benutzer nicht gefunden.' };
    }
    if (target.verein_id !== approver.verein_id) {
        return { ok: false, status: 403, error: 'Dieser Benutzer gehört nicht zu Ihrem Verein.' };
    }
    return { ok: true };
}

export async function approveMember(knex, req, res) {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId ist erforderlich.' });
        }

        const check = await assertApprover(knex, req.user.id, userId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer').where({ id: userId }).update({
            verein_freigegeben: 1,
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
        if (!userId) {
            return res.status(400).json({ success: false, error: 'userId ist erforderlich.' });
        }

        const check = await assertApprover(knex, req.user.id, userId);
        if (!check.ok) {
            return res.status(check.status).json({ success: false, error: check.error });
        }

        await knex('benutzer').where({ id: userId }).update({
            verein_id: null,
            verein_freigegeben: 0,
            updated_at: knex.fn.now()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[Verein-Reject-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Ablehnung.' });
    }
}
