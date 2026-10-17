import { test, mock } from 'node:test';
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
        await fn(
            (pfad) => fetch(`${basis}${pfad}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
            }),
            (pfad, body, ip) => fetch(`${basis}${pfad}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify(body)
            })
        );
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

test('ratenSchluessel: IPv6 je /64, IPv4 und IPv4-mapped unverändert', async () => {
    const { ratenSchluessel } = await import('../../src/middleware/authRatenbegrenzung.js');
    assert.equal(ratenSchluessel('203.0.113.7'), '203.0.113.7');
    assert.equal(ratenSchluessel('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(ratenSchluessel('::FFFF:cb00:7107'), '203.0.113.7');
    const a = ratenSchluessel('2001:db8:1:2:aaaa::1');
    assert.equal(a, ratenSchluessel('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
    assert.equal(a, ratenSchluessel('2001:db8:1:2::abcd%eth0'));
    assert.notEqual(a, ratenSchluessel('2001:db8:1:3::1'));
    assert.equal(ratenSchluessel('::1'), ratenSchluessel('::2'));
    assert.equal(ratenSchluessel('unbekannt'), 'unbekannt');
});

test('Auth-Ratenbegrenzung: volle Tabelle verdrängt, neue Clients werden nicht gesperrt', async () => {
    const { erzeugeAuthRatenbegrenzung } = await import('../../src/middleware/authRatenbegrenzung.js');
    const mw = erzeugeAuthRatenbegrenzung({ max: 1, aktiv: true, maxEintraege: 2, env: {} });
    const anfrage = (ip) => new Promise((resolve) => {
        const res = { status: (c) => ({ json: () => resolve(c) }) };
        mw({ socket: { remoteAddress: ip }, headers: {}, body: {} }, res, () => resolve(200));
    });
    assert.equal(await anfrage('198.51.100.1'), 200);
    assert.equal(await anfrage('198.51.100.2'), 200);
    assert.equal(await anfrage('198.51.100.2'), 429);
    assert.equal(await anfrage('198.51.100.3'), 200, 'Tabelle voll: neuer Client trotzdem bedient');
    assert.equal(await anfrage('198.51.100.4'), 200);
});

test('emailRatenSchluessel: Hash statt Rohtext, zu lange Adressen ohne Schlüssel', async () => {
    const { emailRatenSchluessel } = await import('../../src/middleware/authRatenbegrenzung.js');
    const k = emailRatenSchluessel('login', ' Opfer@Example.de ', '2001:db8:1:2::1');
    assert.match(k, /^[0-9a-f]{64}$/);
    assert.equal(k, emailRatenSchluessel('login', 'opfer@example.de', '2001:db8:1:2::ffff'), 'gleiches /64');
    assert.notEqual(k, emailRatenSchluessel('login', 'opfer@example.de', '2001:db8:1:3::1'));
    assert.notEqual(emailRatenSchluessel('a', 'x@y.de'), emailRatenSchluessel('b', 'x@y.de'), 'je Endpunkt getrennt');
    const lang = `${'a'.repeat(250)}@x.de`;
    assert.equal(emailRatenSchluessel('login', lang, '198.51.100.1'), null);
    assert.equal(emailRatenSchluessel('login', '', '198.51.100.1'), null);
    assert.equal(emailRatenSchluessel('login', 'a'.repeat(242) + '@example.de', '198.51.100.1').length, 64, '254 Zeichen gehen noch');
});

test('Auth-Ratenbegrenzung: Login je Adresse und Absender, Bestätigungsmail je Adresse', async () => {
    const vorher = process.env.LIVE_PROXY_VERTRAUEN;
    process.env.LIVE_PROXY_VERTRAUEN = 'true';
    delete process.env.AUTH_RATENLIMIT_AKTIV;
    const fehler = mock.method(console, 'error', () => {});
    try {
        await mitServer(async (_post, postMit) => {
            // Login: 10 Versuche derselben Adresse vom selben Absender, der 11. → 429
            for (let i = 1; i <= 10; i++) {
                const r = await postMit('/login', { email: i % 2 ? 'Opfer@Example.de' : ' opfer@example.de' }, '198.51.100.7');
                assert.notEqual(r.status, 429, `Login ${i}`);
            }
            const elfte = await postMit('/login', { email: 'OPFER@example.de' }, '198.51.100.7');
            assert.equal(elfte.status, 429);
            assert.deepEqual(await elfte.json(), { success: false, error: 'Zu viele Anfragen. Bitte versuche es später erneut.' });
            // ein anderer Absender (z.B. der Kontoinhaber) ist davon nicht betroffen
            assert.notEqual((await postMit('/login', { email: 'opfer@example.de' }, '203.0.113.50')).status, 429,
                'Kontoinhaber von anderer Adresse nicht ausgesperrt');
            // überlange Adresse: kein Schlüssel aus dem Rohtext, nur die IP-Grenze zählt
            for (let i = 1; i <= 12; i++) {
                assert.notEqual((await postMit('/login', { email: `${'b'.repeat(300)}@x.de` }, '198.51.100.8')).status, 429);
            }

            // Bestätigungsmail: 3 je Adresse (gleich, ob es sie gibt), die 4. → 429, auch von anderen Absendern
            for (const adresse of ['opfer@example.de', 'gibt-es-nicht@example.de']) {
                for (let i = 1; i <= 3; i++) {
                    const r = await postMit('/email-bestaetigung-erneut', { email: adresse }, `198.51.100.${20 + i}`);
                    assert.equal(r.status, 200, `${adresse} ${i}`);
                }
                const vierte = await postMit('/email-bestaetigung-erneut', { email: adresse.toUpperCase() }, '198.51.100.30');
                assert.equal(vierte.status, 429, adresse);
            }
            assert.equal((await postMit('/email-bestaetigung-erneut', { email: 'andere@example.de' }, '198.51.100.30')).status, 200);
        });
    } finally {
        fehler.mock.restore();
        if (vorher === undefined) delete process.env.LIVE_PROXY_VERTRAUEN; else process.env.LIVE_PROXY_VERTRAUEN = vorher;
    }
});
