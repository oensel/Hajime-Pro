// End-to-End: Turnier in der Cloud live schalten (cloud-live.html). Der Testserver hängt Cloud-Live ein (CLOUD_LIVE_AKTIV);
// die Geräteseite (/turnierlive/<schluessel>) wird mit echten HTTP-Aufrufen geprüft.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';
import { legeTurnierAn } from './helpers/turnier-aufbau.js';

// Heutiger Tag in Berliner Zeit (JJJJ-MM-TT): das Startfenster beginnt am Vortag.
const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function veroeffentlichtesTurnier(request, name) {
    const turnierId = await legeTurnierAn(request, { name, datum: heute() });
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id: turnierId }).update({ status: 'veroeffentlicht' });
    } finally {
        await db.destroy();
    }
    return turnierId;
}

test('Live schalten zeigt Code und QR, ein Gerät koppelt und wird gelistet, Beenden gibt den Platz frei', async ({ page, request }) => {
    const turnierId = await veroeffentlichtesTurnier(request, 'Cloud-Live-UI');
    await page.goto(`/cloud-live.html?turnierId=${turnierId}`);

    await expect(page.locator('#clAus')).toBeVisible();
    await expect(page.locator('#clPlaetze')).toContainText('Live-Plätzen');
    await page.locator('#clStartenBtn').click();

    await expect(page.locator('#clLive')).toBeVisible();
    await expect(page.locator('#clCode')).toHaveText(/^\d{3} \d{3}$/);
    await expect(page.locator('#clQr svg')).toBeVisible();
    const url = await page.locator('#clUrl').textContent();
    expect(url).toMatch(/\/turnierlive\/[A-Za-z0-9_-]{22}$/);
    const code = (await page.locator('#clCode').textContent()).replace(/\s/g, '');
    const pfad = new URL(url).pathname;

    // Gerät: Status ohne Anmeldung, Koppeln mit dem Code liefert das Geheimnis, falscher Code nicht
    const status = await request.get(`${pfad}/api/sync/status`);
    expect(status.status()).toBe(200);
    expect((await status.json()).modus).toBe('master');
    const falsch = code === '000000' ? '000001' : '000000';
    expect((await request.post(`${pfad}/api/client/koppeln`, { data: { code: falsch, clientId: 'e2e' } })).status()).toBe(401);
    const koppeln = await request.post(`${pfad}/api/client/koppeln`, { data: { code, clientId: 'e2e-geraet' } });
    expect(koppeln.status()).toBe(200);
    const { secret } = await koppeln.json();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    // Das Gerät meldet sich per Heartbeat-Dokument; die Seite listet es samt nicht übertragener Änderungen
    const dbName = (await status.json()).db_name;
    const kopf = { 'x-hajime-sync-secret': secret, 'Content-Type': 'application/json' };
    const put = await request.put(`${pfad}/db/${dbName}/client:e2e-geraet`, {
        headers: kopf,
        data: { dokumenttyp: 'client', client_id: 'e2e-geraet', geraet: 'E2E-Notebook', matte_id: 1, letzter_kontakt: new Date().toISOString(), ausstehend: 2, bearbeitet_von: 'client-heartbeat' }
    });
    expect(put.status(), await put.text()).toBe(201);
    await page.reload();
    await expect(page.locator('#clGeraete tbody tr')).toHaveCount(1);
    await expect(page.locator('#clGeraete tbody tr')).toContainText('E2E-Notebook');

    // Code erneuern: neuer Code, altes Geheimnis ist danach ungültig
    page.once('dialog', (d) => d.accept());
    await page.locator('#clErneuernBtn').click();
    await expect(page.locator('#clCode')).not.toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect((await request.get(`${pfad}/db/${dbName}`, { headers: { 'x-hajime-sync-secret': secret } })).status()).toBe(401);

    // Beenden: erst die Warnung wegen ungesendeter Änderungen, dann trotzdem
    const dialoge = [];
    page.on('dialog', async (d) => { dialoge.push(d.message()); await d.accept(); });
    await page.locator('#clBeendenBtn').click();
    await expect(page.locator('#clAus')).toBeVisible();
    expect(dialoge.some((m) => /nicht übertragene Änderungen/.test(m))).toBe(true);
    expect((await request.get(`${pfad}/api/sync/status`)).status()).toBe(410);
});

test('Ein Turnier im Entwurf lässt sich nicht live schalten', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Cloud-Live-Entwurf', datum: heute() });
    await page.goto(`/cloud-live.html?turnierId=${turnierId}`);
    await page.locator('#clStartenBtn').click();
    await expect(page.locator('#clFehler')).toContainText('Entwurf');
    await expect(page.locator('#clLive')).toBeHidden();
});
