// End-to-End: ein echter Client-Knoten (BETRIEBSMODUS=client, wie Notebook/Desktop-Client) koppelt sich per Code an ein Turnier, das die
// Cloud live führt, und repliziert nur dessen Dokument-DB. Zwei Turniere laufen parallel und bleiben getrennt. Der Testserver ist die
// Cloud (CLOUD_LIVE_AKTIV, siehe test-env.js).
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import knexLib from 'knex';
import { testDbVerbindung, BASE_URL } from './test-env.js';
import { legeTurnierAn, legeKlasseAn } from './helpers/turnier-aufbau.js';

const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const freierPort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function liveTurnier(request, name) {
    const turnierId = await legeTurnierAn(request, { name, datum: heute() });
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try { await db('turniere').where({ id: turnierId }).update({ status: 'veroeffentlicht' }); } finally { await db.destroy(); }
    const teilnehmerIds = await legeKlasseAn(request, turnierId, { altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', anzahl: 2, gewogen: false });
    const antwort = await request.post(`/api/cloud-live/${turnierId}/starten`, { data: {} });
    expect(antwort.ok(), await antwort.text()).toBeTruthy();
    const status = await antwort.json();
    const pfad = new URL(status.url).pathname;
    const koppeln = await request.post(`${pfad}/api/client/koppeln`, { data: { code: status.code, clientId: 'e2e-client' } });
    expect(koppeln.ok(), await koppeln.text()).toBeTruthy();
    return { turnierId, teilnehmerIds, pfad, secret: (await koppeln.json()).secret };
}

// Startet einen Client-Knoten, der sich an das Cloud-Turnier hängt (wie die Desktop-App nach dem Koppeln).
async function starteClient(turnier) {
    const port = await freierPort();
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cl-client-'));
    const kind = spawn(process.execPath, ['src/app.js'], {
        env: {
            ...process.env,
            BETRIEBSMODUS: 'client', SYNC_ROLLE: 'client', IS_OFFLINE: '', NODE_ENV: 'test',
            PORT: String(port), LISTEN_HOST: '127.0.0.1',
            SYNC_SERVER_URL: `${BASE_URL}${turnier.pfad}`, SYNC_SECRET: turnier.secret, SYNC_DATENVERZEICHNIS: verzeichnis,
            MDNS_AKTIV: 'false', PORT80_WEITERLEITUNG: 'false', STEUERUNG_PASSWORD: '', SMTP_HOST: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let ausgabe = '';
    kind.stdout.on('data', (d) => { ausgabe += d; });
    kind.stderr.on('data', (d) => { ausgabe += d; });
    const basis = `http://127.0.0.1:${port}`;
    const beende = async () => {
        kind.kill();
        await new Promise((r) => setTimeout(r, 500));
        try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows hält Dateien kurz fest */ }
    };
    return { basis, beende, ausgabe: () => ausgabe };
}

// Der Knoten startet erst (ECONNREFUSED) und kann sich später wieder trennen: Fehler gelten als "noch kein Status".
const clientStatus = async (request, basis) => {
    try { return await (await request.get(`${basis}/api/sync/status`)).json(); } catch { return {}; }
};

test('Client-Gerät repliziert nur das Cloud-Turnier, Wiegungen kommen in der Cloud an, Beenden trennt es', async ({ request }) => {
    test.setTimeout(180_000);
    const a = await liveTurnier(request, 'Cloud-Geraet-A');
    const b = await liveTurnier(request, 'Cloud-Geraet-B');
    const client = await starteClient(a);
    try {
        // Gerät verbindet sich und übernimmt die Instanz von Turnier A
        const cloudA = await (await request.get(`${a.pfad}/api/sync/status`)).json();
        await expect.poll(async () => (await clientStatus(request, client.basis)).instanz_id, { timeout: 60_000 }).toBe(cloudA.instanz_id);
        await expect.poll(async () => (await clientStatus(request, client.basis)).verbunden, { timeout: 30_000 }).toBe(true);

        // Die lokale Datenbank des Geräts enthält die Teilnehmer von A, aber keinen von B
        const dbName = (await clientStatus(request, client.basis)).db_name;
        const lokal = async () => (await (await request.get(`${client.basis}/db/${dbName}/_all_docs?include_docs=true`)).json()).rows.map((r) => r.doc);
        await expect.poll(async () => (await lokal()).filter((d) => d.dokumenttyp === 'teilnehmer').length, { timeout: 30_000 }).toBe(2);
        const lokaleTeilnehmer = (await lokal()).filter((d) => d.dokumenttyp === 'teilnehmer');
        expect(lokaleTeilnehmer.map((d) => d.sql_id).sort()).toEqual([...a.teilnehmerIds].sort());

        // Wiegung am Gerät: wird zur Cloud repliziert und von der Brücke in die Datenbank übernommen
        const ziel = lokaleTeilnehmer.find((d) => d.sql_id === a.teilnehmerIds[0]);
        const antwort = await request.put(`${client.basis}/db/${dbName}/${encodeURIComponent(ziel._id)}`, {
            data: { ...ziel, gewicht: 42.5, gewogen: true, bearbeitet_von: 'waage-e2e' }
        });
        expect(antwort.ok(), await antwort.text()).toBeTruthy();
        await expect.poll(async () => {
            const liste = await (await request.get(`/api/teilnehmer?turnierId=${a.turnierId}`)).json();
            const t = liste.find((x) => x.id === a.teilnehmerIds[0]);
            return t ? parseFloat(t.gewicht) : null;
        }, { timeout: 60_000 }).toBe(42.5);

        // Turnier B ist unberührt
        const listeB = await (await request.get(`/api/teilnehmer?turnierId=${b.turnierId}`)).json();
        expect(listeB.every((t) => parseFloat(t.gewicht) !== 42.5)).toBe(true);

        // Das Gerät sieht Turnier B nicht: sein Geheimnis passt nur zu A
        const fremd = await request.get(`${b.pfad}/db/turnier_${(await (await request.get(`${b.pfad}/api/sync/status`)).json()).instanz_id}`, { headers: { 'x-hajime-sync-secret': a.secret } });
        expect(fremd.status()).toBe(401);

        // Beenden: Rückschreiben ist abgeschlossen, das Gerät verliert die Verbindung
        const beenden = await request.post(`/api/cloud-live/${a.turnierId}/beenden`, { data: { erzwingen: true } });
        expect(beenden.ok(), await beenden.text()).toBeTruthy();
        expect((await request.get(`${a.pfad}/api/sync/status`)).status()).toBe(410);
        await expect.poll(async () => (await clientStatus(request, client.basis)).verbunden, { timeout: 60_000 }).toBe(false);
    } finally {
        if (test.info().status !== 'passed') console.log(`[Client-Knoten]
${client.ausgabe().slice(-3000)}`);
        await client.beende();
        await request.post(`/api/cloud-live/${b.turnierId}/beenden`, { data: { erzwingen: true } });
    }
});
