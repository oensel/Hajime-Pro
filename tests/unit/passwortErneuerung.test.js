import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
process.env.SUPER_ADMIN_2FA = 'false';
process.env.JWT_SECRET = 'test-geheimnis-passwort';

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const { login } = await import('../../src/controllers/authController.js');
const { verifyPassword, brauchtNeuenHash } = await import('../../src/utils/password.js');

test('Login erneuert einen alten, schwachen Passwort-Prüfwert', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const salz = crypto.randomBytes(16).toString('hex');
        const alt = `${salz}:${crypto.pbkdf2Sync('Mein-Passwort-123', salz, 1000, 64, 'sha512').toString('hex')}`;
        await knex('benutzer').insert({ id: 'u1', email: 'u1@test.de', vorname: 'U', nachname: 'Eins', password_hash: alt, email_bestaetigt_am: knex.fn.now() });
        const antworte = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
        const anfrage = (passwort) => ({ body: { email: 'u1@test.de', password: passwort }, headers: {}, socket: { remoteAddress: '203.0.113.5' }, app: { get: () => knex } });

        // falsches Passwort: nichts ändert sich
        let res = antworte();
        await login(knex, anfrage('falsch'), res);
        assert.equal(res.statusCode, 401);
        assert.equal((await knex('benutzer').where({ id: 'u1' }).first()).password_hash, alt);

        // richtiges Passwort: Anmeldung klappt und der Prüfwert ist danach stark
        res = antworte();
        await login(knex, anfrage('Mein-Passwort-123'), res);
        assert.ok(res.body.token);
        let neu;
        for (let i = 0; i < 50 && !neu; i += 1) {
            const h = (await knex('benutzer').where({ id: 'u1' }).first()).password_hash;
            if (h !== alt) neu = h; else await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(neu, 'Prüfwert erneuert');
        assert.match(neu, /^v2\$210000\$/);
        assert.equal(brauchtNeuenHash(neu), false);
        assert.equal(verifyPassword('Mein-Passwort-123', neu), true);

        // der nächste Login funktioniert mit dem neuen Prüfwert und ändert ihn nicht mehr
        res = antworte();
        await login(knex, anfrage('Mein-Passwort-123'), res);
        assert.ok(res.body.token);
        await new Promise((r) => setTimeout(r, 300));
        assert.equal((await knex('benutzer').where({ id: 'u1' }).first()).password_hash, neu);
    } finally {
        await db.stoppe();
    }
});
