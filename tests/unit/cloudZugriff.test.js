// Cloud-Zugriff des Hallen-Servers: Adresse nur aus CLOUD_URL, Fehler als FachFehler, kein echtes Netz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeCloudZugriff, liesCloudUrl } from '../../src/services/cloudZugriff.js';
import { FachFehler } from '../../src/utils/fachFehler.js';

const antwort = (status, daten) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => daten
});

test('liesCloudUrl: leer, ungültig und Schrägstrich am Ende', () => {
    assert.equal(liesCloudUrl({}), null);
    assert.equal(liesCloudUrl({ CLOUD_URL: '  ' }), null);
    assert.equal(liesCloudUrl({ CLOUD_URL: 'ftp://x' }), null);
    assert.equal(liesCloudUrl({ CLOUD_URL: 'kein url' }), null);
    assert.equal(liesCloudUrl({ CLOUD_URL: 'https://cloud.example.de/' }), 'https://cloud.example.de');
});

test('ohne CLOUD_URL: nicht konfiguriert, nicht erreichbar, Anfragen scheitern mit 503', async () => {
    let aufrufe = 0;
    const cloud = erzeugeCloudZugriff({ env: {}, fetchFn: async () => { aufrufe++; return antwort(200, {}); } });
    assert.equal(cloud.konfiguriert(), false);
    assert.equal(await cloud.pruefeErreichbar(), false);
    await assert.rejects(() => cloud.meldeAn('a', 'b'), (e) => e instanceof FachFehler && e.statusCode === 503);
    assert.equal(aufrufe, 0);
});

test('pruefeErreichbar: true bei 200, false bei Fehler oder Netzproblem', async () => {
    const env = { CLOUD_URL: 'https://cloud.example.de' };
    const aufgerufen = [];
    const ok = erzeugeCloudZugriff({ env, fetchFn: async (url) => { aufgerufen.push(url); return antwort(200, {}); } });
    assert.equal(await ok.pruefeErreichbar(), true);
    assert.equal(aufgerufen[0], 'https://cloud.example.de/api/auth/mode');

    const fehlerhaft = erzeugeCloudZugriff({ env, fetchFn: async () => antwort(500, {}) });
    assert.equal(await fehlerhaft.pruefeErreichbar(), false);

    const netz = erzeugeCloudZugriff({ env, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(await netz.pruefeErreichbar(), false);
});

test('meldeAn: liefert Token, reicht 401 mit der Meldung der Cloud durch', async () => {
    const env = { CLOUD_URL: 'https://cloud.example.de' };
    const gesendet = [];
    const cloud = erzeugeCloudZugriff({
        env,
        fetchFn: async (url, opt) => {
            gesendet.push({ url, opt });
            const body = JSON.parse(opt.body);
            return body.password === 'richtig'
                ? antwort(200, { success: true, token: 'T0KEN', user: { verein_id: 4 } })
                : antwort(401, { success: false, error: 'Ungültige Anmeldedaten.' });
        }
    });
    const r = await cloud.meldeAn('a@b.de', 'richtig');
    assert.equal(r.token, 'T0KEN');
    assert.equal(gesendet[0].url, 'https://cloud.example.de/api/auth/login');
    await assert.rejects(() => cloud.meldeAn('a@b.de', 'falsch'),
        (e) => e instanceof FachFehler && e.statusCode === 401 && e.message === 'Ungültige Anmeldedaten.');
});

test('Netzfehler nach der Anmeldung wird zu 502 mit klarer Meldung', async () => {
    const cloud = erzeugeCloudZugriff({
        env: { CLOUD_URL: 'https://cloud.example.de' },
        fetchFn: async () => { throw new Error('ETIMEDOUT'); }
    });
    await assert.rejects(() => cloud.listeTurniere('T'),
        (e) => e instanceof FachFehler && e.statusCode === 502 && /nicht erreichbar/.test(e.message));
});

test('ladeExport: Token als Bearer, 403 der Cloud bleibt erhalten, ungültige Antwort wird abgelehnt', async () => {
    const env = { CLOUD_URL: 'https://cloud.example.de' };
    let kopf = null;
    const gut = erzeugeCloudZugriff({
        env,
        fetchFn: async (url, opt) => { kopf = opt.headers.Authorization; return antwort(200, { turnier: { bezeichnung: 'X' } }); }
    });
    const daten = await gut.ladeExport('T0KEN', 7);
    assert.equal(daten.turnier.bezeichnung, 'X');
    assert.equal(kopf, 'Bearer T0KEN');

    const gesperrt = erzeugeCloudZugriff({
        env,
        fetchFn: async () => antwort(403, { error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' })
    });
    await assert.rejects(() => gesperrt.ladeExport('T', 7), (e) => e.statusCode === 403 && /Anmeldefrist/.test(e.message));

    const leer = erzeugeCloudZugriff({ env, fetchFn: async () => antwort(200, { foo: 1 }) });
    await assert.rejects(() => leer.ladeExport('T', 7), (e) => e.statusCode === 502);
});
