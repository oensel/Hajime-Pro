import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Ratenbegrenzung der öffentlichen Auth-Endpunkte je Absender (register und email-bestaetigung-erneut 10, login 30
// Anfragen je 10 Minuten). Aktiv in der Cloud, sonst nur mit AUTH_RATENLIMIT_AKTIV=true.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.PUBLIC_BASE_URL = 'https://hajime.example';
process.env.SMTP_HOST = '';

const { getAuthRoutes } = await import('../../src/routes/authRoutes.js');
const { authRatenlimitAktiv } = await import('../../src/middleware/authRatenbegrenzung.js');

// Ohne Datenbank: leere Anfragen enden in der Validierung (400) bzw. der immer gleichen Antwort (200).
async function mitServer(fn) {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', getAuthRoutes(null));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const basis = `http://127.0.0.1:${server.address().port}/api/auth`;
    try {
        await fn((pfad) => fetch(`${basis}${pfad}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        }));
    } finally {
        await new Promise((r) => server.close(r));
    }
}

test('Auth-Ratenbegrenzung: 11. Registrierung → 429, Login erst nach 30', async () => {
    const vorher = process.env.AUTH_RATENLIMIT_AKTIV;
    delete process.env.AUTH_RATENLIMIT_AKTIV;
    try {
        await mitServer(async (post) => {
            for (const pfad of ['/register', '/email-bestaetigung-erneut']) {
                for (let i = 1; i <= 10; i++) {
                    assert.notEqual((await post(pfad)).status, 429, `${pfad} Anfrage ${i}`);
                }
                const elfte = await post(pfad);
                assert.equal(elfte.status, 429, pfad);
                assert.deepEqual(await elfte.json(), { success: false, error: 'Zu viele Anfragen. Bitte versuche es später erneut.' });
            }
            for (let i = 1; i <= 30; i++) {
                assert.notEqual((await post('/login')).status, 429, `login Anfrage ${i}`);
            }
            assert.equal((await post('/login')).status, 429);
        });
    } finally {
        if (vorher === undefined) delete process.env.AUTH_RATENLIMIT_AKTIV; else process.env.AUTH_RATENLIMIT_AKTIV = vorher;
    }
});

test('Auth-Ratenbegrenzung: per AUTH_RATENLIMIT_AKTIV=false abschaltbar', async () => {
    process.env.AUTH_RATENLIMIT_AKTIV = 'false';
    try {
        await mitServer(async (post) => {
            for (let i = 1; i <= 15; i++) assert.notEqual((await post('/register')).status, 429);
        });
    } finally {
        delete process.env.AUTH_RATENLIMIT_AKTIV;
    }
});

test('Auth-Ratenbegrenzung: Standard nur in der Cloud aktiv', () => {
    assert.equal(authRatenlimitAktiv({ BETRIEBSMODUS: 'cloud' }), true);
    assert.equal(authRatenlimitAktiv({ BETRIEBSMODUS: 'server' }), false);
    assert.equal(authRatenlimitAktiv({ IS_OFFLINE: 'true' }), false);
    assert.equal(authRatenlimitAktiv({ IS_OFFLINE: 'true', AUTH_RATENLIMIT_AKTIV: 'true' }), true);
    assert.equal(authRatenlimitAktiv({ BETRIEBSMODUS: 'cloud', AUTH_RATENLIMIT_AKTIV: 'false' }), false);
});
