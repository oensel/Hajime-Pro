import crypto from 'crypto';
import { createRequire } from 'module';
import { hashPassword } from '../src/utils/password.js';

const require = createRequire(import.meta.url);
const { liesBetriebsmodus } = require('../src/config/betriebsmodus.cjs');

export const config = { transaction: false };

// Inbetriebnahme der Cloud: festes Super-Admin-Konto. Das Bundesland der Vereine (Nordrhein-Westfalen als Standard)
// setzt 20261024100000_turnier_sichtbarkeit.js.
// Läuft nur mit CLOUD_INBETRIEBNAHME=true im Cloud-Modus; sonst wird sie übersprungen (und gilt trotzdem als
// ausgeführt: dann legt ensureSuperAdmin beim Serverstart das Konto mit zufälligem Passwort bzw.
// SUPER_ADMIN_INITIAL_PASSWORD an). Hallen-Server und Tests legen so kein Konto mit bekanntem Passwort an.
// Das Passwort kommt aus SUPER_ADMIN_INITIAL_PASSWORD (nicht im Repository). Idempotent: ein schon vorhandenes Konto behält sein Passwort.
// Der Wert muss zu SUPER_ADMIN_EMAIL in src/utils/superAdmin.js passen, sonst legt der Serverstart ein zweites Konto an.
const SUPER_ADMIN_EMAIL = 'hajime-pro@bastian-haas.com';
const ALTE_SUPER_ADMIN_EMAIL = 'admin@example.org';
const VEREIN_ADMINISTRATION = 'Administration';

export async function up(knex) {
    if (process.env.CLOUD_INBETRIEBNAHME !== 'true' || !liesBetriebsmodus().istCloud) return;
    const passwort = process.env.SUPER_ADMIN_INITIAL_PASSWORD;
    if (!passwort) {
        console.warn('[Inbetriebnahme] SUPER_ADMIN_INITIAL_PASSWORD fehlt: Super-Admin wird nicht angelegt (ensureSuperAdmin legt ihn beim Serverstart an).');
        return;
    }

    let verein = await knex('vereine').where({ name: VEREIN_ADMINISTRATION }).first();
    if (!verein) {
        const [eingefuegt] = await knex('vereine').insert({ name: VEREIN_ADMINISTRATION }).returning('id');
        verein = { id: typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt };
    }

    let konto = await knex('benutzer').whereRaw('lower(email) = ?', [SUPER_ADMIN_EMAIL]).first();
    if (!konto) {
        const altesKonto = await knex('benutzer').whereRaw('lower(email) = ?', [ALTE_SUPER_ADMIN_EMAIL]).first();
        if (altesKonto) {
            // Das bisherige Super-Admin-Konto bekommt die neue Adresse und das neue Passwort (Mitgliedschaften bleiben).
            await knex('benutzer').where({ id: altesKonto.id }).update({
                email: SUPER_ADMIN_EMAIL,
                password_hash: hashPassword(passwort),
                muss_passwort_aendern: false,
                gesperrt: false,
                updated_at: knex.fn.now()
            });
            konto = altesKonto;
        } else {
            const id = crypto.randomUUID();
            await knex('benutzer').insert({
                id,
                email: SUPER_ADMIN_EMAIL,
                vorname: 'Super',
                nachname: 'Admin',
                password_hash: hashPassword(passwort),
                email_bestaetigt_am: knex.fn.now(),
                aktiver_verein_id: verein.id,
                created_at: knex.fn.now(),
                updated_at: knex.fn.now()
            });
            konto = { id };
        }
    }

    await knex('benutzer').where({ id: konto.id }).update({
        ist_super_admin: true,
        super_admin_modus: true,
        email_bestaetigt_am: knex.raw('COALESCE(email_bestaetigt_am, now())'),
        updated_at: knex.fn.now()
    });

    const mitgliedschaft = await knex('benutzer_vereine').where({ benutzer_id: konto.id, verein_id: verein.id }).first();
    if (!mitgliedschaft) {
        await knex('benutzer_vereine').insert({ benutzer_id: konto.id, verein_id: verein.id, freigegeben: 1, rolle: 'admin' });
    } else if (!mitgliedschaft.freigegeben || mitgliedschaft.rolle !== 'admin') {
        await knex('benutzer_vereine').where({ id: mitgliedschaft.id }).update({ freigegeben: 1, rolle: 'admin', updated_at: knex.fn.now() });
    }
}

// Daten-Migration: das Konto bleibt beim Zurücknehmen erhalten.
export async function down() {}
