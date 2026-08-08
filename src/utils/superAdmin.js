import crypto from 'crypto';
import { hashPassword } from './password.js';

// Fest hinterlegte Identität des Super-Admins (Bootstrapping-Rolle für die Erstfreigabe neuer
// Vereine, siehe "Erstnutzer-Freigabe-Flow" — ein Verein braucht ohne dieses Konto niemanden,
// der die allererste Person freischalten kann). Bewusst kein env-Override: der Super-Admin ist
// eine feste Betriebsentscheidung, kein Deployment-Parameter.
export const SUPER_ADMIN_EMAIL = 'judo@bastian-haas.com';
const SUPER_ADMIN_VORNAME = 'Bastian';
const SUPER_ADMIN_NACHNAME = 'Haas';
const SUPER_ADMIN_VEREIN_NAME = 'JC Senden';

/**
 * Stellt sicher, dass der Super-Admin-Account in der DB existiert und als solcher markiert ist.
 * Idempotent — bei jedem Serverstart (online) aufgerufen. Legt beim allerersten Anlegen ein
 * zufälliges Passwort an (per SUPER_ADMIN_INITIAL_PASSWORD überschreibbar) und gibt es einmalig
 * auf der Konsole aus; ein bereits bestehendes Passwort wird nie angetastet.
 * @param {Object} knex - Knex instance
 */
export async function ensureSuperAdmin(knex) {
    try {
        let benutzer = await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first();

        let verein = await knex('vereine').where({ name: SUPER_ADMIN_VEREIN_NAME }).first();
        if (!verein) {
            const [inserted] = await knex('vereine').insert({ name: SUPER_ADMIN_VEREIN_NAME }).returning('id');
            verein = { id: typeof inserted === 'object' ? inserted.id : inserted };
        }

        if (!benutzer) {
            const initialPassword = process.env.SUPER_ADMIN_INITIAL_PASSWORD || crypto.randomBytes(9).toString('base64url');
            const id = crypto.randomUUID();

            await knex('benutzer').insert({
                id,
                email: SUPER_ADMIN_EMAIL,
                vorname: SUPER_ADMIN_VORNAME,
                nachname: SUPER_ADMIN_NACHNAME,
                password_hash: hashPassword(initialPassword),
                ist_super_admin: true,
                aktiver_verein_id: verein.id,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });

            console.log('========================================================');
            console.log(`[Super-Admin] Konto für ${SUPER_ADMIN_EMAIL} wurde angelegt.`);
            if (!process.env.SUPER_ADMIN_INITIAL_PASSWORD) {
                console.log(`[Super-Admin] Initiales Passwort: ${initialPassword} — bitte nach dem ersten Login ändern.`);
            }
            console.log('========================================================');

            benutzer = { id };
        } else if (!benutzer.ist_super_admin) {
            await knex('benutzer').where({ id: benutzer.id }).update({ ist_super_admin: true, updated_at: knex.fn.now() });
        }

        const mitgliedschaft = await knex('benutzer_vereine')
            .where({ benutzer_id: benutzer.id, verein_id: verein.id })
            .first();

        if (!mitgliedschaft) {
            await knex('benutzer_vereine').insert({ benutzer_id: benutzer.id, verein_id: verein.id, freigegeben: 1 });
        } else if (!mitgliedschaft.freigegeben) {
            await knex('benutzer_vereine').where({ id: mitgliedschaft.id }).update({ freigegeben: 1, updated_at: knex.fn.now() });
        }
    } catch (error) {
        console.error('[Super-Admin-Bootstrap-Fehler]:', error.message);
    }
}
