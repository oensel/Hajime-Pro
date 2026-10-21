// Super-Admin-Verwaltung (Helferverwaltung, Spec 3.1; Seite „Benutzer“): Liste aller Konten (Super-Admins zuerst) mit ihren Mitgliedschaften und
// Umschalter für die globale Rolle Super-Admin (benutzer.ist_super_admin). Zugriff nur für Super-Admins
// (requireSuperAdmin in nutzerRoutes.js). Es bleibt immer mindestens ein Super-Admin.

/** GET /api/nutzer — alle Konten (ohne Passwort-Hash) mit Mitgliedschaften. */
export async function listeNutzer(knex, req, res) {
    try {
        const konten = await knex('benutzer')
            .select('id', 'vorname', 'nachname', 'email', 'ist_super_admin', 'email_bestaetigt_am')
            .orderBy([{ column: 'ist_super_admin', order: 'desc' }, { column: 'nachname' }, { column: 'vorname' }, { column: 'email' }]);
        const mitgliedschaften = await knex('benutzer_vereine')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .select(
                'benutzer_vereine.benutzer_id as benutzer_id', 'vereine.id as verein_id', 'vereine.name as verein_name',
                'benutzer_vereine.rolle as rolle', 'benutzer_vereine.freigegeben as freigegeben'
            )
            .orderBy('vereine.name');

        const jeKonto = new Map();
        for (const m of mitgliedschaften) {
            if (!jeKonto.has(m.benutzer_id)) jeKonto.set(m.benutzer_id, []);
            jeKonto.get(m.benutzer_id).push({
                verein_id: m.verein_id,
                verein_name: m.verein_name,
                rolle: m.freigegeben ? m.rolle : null,
                freigegeben: !!m.freigegeben
            });
        }

        res.json(konten.map(k => ({
            id: k.id,
            vorname: k.vorname,
            nachname: k.nachname,
            email: k.email,
            ist_super_admin: !!k.ist_super_admin,
            email_bestaetigt: !!k.email_bestaetigt_am,
            mitgliedschaften: jeKonto.get(k.id) || []
        })));
    } catch (error) {
        console.error('[Nutzer-Liste-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Konten.' });
    }
}

/** POST /api/nutzer/:id/super-admin { wert: boolean } — ernennen oder entziehen. */
export async function setzeSuperAdmin(knex, req, res) {
    try {
        const zielId = req.params.id;
        const wert = req.body ? req.body.wert : undefined;
        if (typeof wert !== 'boolean') {
            return res.status(400).json({ success: false, error: 'wert muss true oder false sein.' });
        }

        const ergebnis = await knex.transaction(async (trx) => {
            // Alle Super-Admin-Zeilen sperren, damit zwei gleichzeitige Entzüge nicht beide den „vorletzten“ sehen.
            const superAdmins = await trx('benutzer').where({ ist_super_admin: true }).forUpdate().select('id');
            const ziel = await trx('benutzer').where({ id: zielId }).first('id', 'ist_super_admin');
            if (!ziel) return { status: 404, error: 'Konto nicht gefunden.' };
            if (!!ziel.ist_super_admin === wert) return { status: 200 };

            if (!wert && superAdmins.length <= 1) {
                return {
                    status: 409,
                    error: 'Der letzte Super-Admin kann nicht entzogen werden. Bitte zuerst einen weiteren Super-Admin ernennen.'
                };
            }
            await trx('benutzer').where({ id: zielId }).update({ ist_super_admin: wert, updated_at: trx.fn.now() });
            return { status: 200 };
        });

        if (ergebnis.status !== 200) {
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        res.json({ success: true, ist_super_admin: wert });
    } catch (error) {
        console.error('[Nutzer-Super-Admin-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Ändern der Super-Admin-Rolle.' });
    }
}
