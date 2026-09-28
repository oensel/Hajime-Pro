// Server-Cluster (Spec CouchDB-Umbau, Abschnitte 9 und 12): automatische Übernahme, Rückstufung,
// Zeuge, Rückfall auf asynchron und geplante Übergabe. Die Tests bauen aufeinander auf (seriell);
// der Leitstand simuliert keepalived und die VIP (baseURL = VIP).
import { test, expect } from '@playwright/test';
import {
    KNOTEN, CLIENT_URL, leitstand, vipHalter, warteAufMaster, warteAufSynchron, knotenStatus,
    warteLeerlauf, legeTurnierAn, legeTeilnehmerAn, teilnehmerNamen, clientStatus
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

let turnierId;
let dbName;

test('Grundzustand: server1 Master, synchrone Replikation, Secondary liest mit und lehnt Schreiben ab', async ({ request }) => {
    await warteAufMaster(request, 'server1');
    await warteAufSynchron(request, 'server1');

    turnierId = await legeTurnierAn(request, 'Cluster-Turnier');
    await legeTeilnehmerAn(request, turnierId, 'Anna', 'Adler');
    await warteLeerlauf(request);

    // Relational: sofort (synchron bestätigt) im Standby lesbar.
    await expect.poll(() => teilnehmerNamen(request, KNOTEN.server2.url, turnierId), { timeout: 3000 }).toEqual(['Adler']);
    // Dokumente: server2 hat dieselbe Instanz und zieht die Dokumente des Masters.
    dbName = (await (await request.get('/api/sync/status')).json()).db_name;
    expect(dbName).toBeTruthy();
    await expect.poll(async () => (await knotenStatus(request, 'server2')).dokumente.db_name, { timeout: 10_000 }).toBe(dbName);
    await expect.poll(async () => {
        const r = await request.get(`${KNOTEN.server2.url}/db/${dbName}/_all_docs`);
        return r.ok() ? (await r.json()).rows.some(z => z.id.startsWith('teilnehmer:')) : false;
    }, { timeout: 10_000 }).toBe(true);

    const abgelehnt = await request.post(`${KNOTEN.server2.url}/api/teilnehmer`, {
        data: { turnier_id: turnierId, vorname: 'X', nachname: 'Verboten', verein: 'JC', geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 60 }
    });
    expect(abgelehnt.status()).toBe(409);
    expect((await abgelehnt.json()).error).toContain('Secondary');

    // Client-Gerät repliziert über die VIP.
    await expect.poll(async () => (await clientStatus(request)).instanz_id, { timeout: 15_000 })
        .toBe((await (await request.get('/api/sync/status')).json()).instanz_id);
});

test('Ausfall des Masters: server2 übernimmt automatisch, nichts Bestätigtes geht verloren, Client-Änderung kommt an', async ({ request }) => {
    await legeTeilnehmerAn(request, turnierId, 'Berta', 'Busch');
    await warteLeerlauf(request);
    await expect.poll(async () => (await clientStatus(request)).ausstehend, { timeout: 10_000 }).toBe(0);

    // Client wiegt offline, während der Master ausfällt.
    const trennen = await request.post(`${CLIENT_URL}/api/sync/test/trennen`);
    expect(trennen.ok()).toBeTruthy();
    const { client_id: clientId } = await clientStatus(request);
    const alle = await (await request.get(`${CLIENT_URL}/db/${dbName}/_all_docs?include_docs=true`)).json();
    const berta = alle.rows.map(r => r.doc).find(d => d.dokumenttyp === 'teilnehmer' && d.nachname === 'Busch');
    expect(berta).toBeTruthy();
    const geschrieben = await request.put(`${CLIENT_URL}/db/${dbName}/${encodeURIComponent(berta._id)}`, {
        data: { ...berta, gewicht: 61.5, gewogen: true, gewogen_am: new Date().toISOString(), bearbeitet_von: 'browser', geschrieben_von_knoten: clientId }
    });
    expect(geschrieben.ok(), await geschrieben.text()).toBeTruthy();

    const beginn = Date.now();
    await leitstand(request, '/knoten/server1/stoppen', 'POST');
    await warteAufMaster(request, 'server2', 15_000);
    console.log(`Übernahme nach ${Date.now() - beginn} ms`);
    const s2 = await knotenStatus(request, 'server2');
    expect(s2.epoche).toBe(2);
    expect(s2.verlauf[0]).toMatchObject({ ereignis: 'master_geworden', grund: 'automatisch' });

    // Alles Bestätigte ist da, der neue Master nimmt Schreibzugriffe an.
    expect(await teilnehmerNamen(request, '', turnierId)).toEqual(['Adler', 'Busch']);
    await legeTeilnehmerAn(request, turnierId, 'Clara', 'Conrad');

    // Die Offline-Wiegung des Clients kommt über die VIP beim neuen Master an (Brücke -> SQL).
    const verbinden = await request.post(`${CLIENT_URL}/api/sync/test/verbinden`);
    expect(verbinden.ok()).toBeTruthy();
    await expect.poll(async () => {
        const liste = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const t = liste.find(x => x.nachname === 'Busch');
        return t ? parseFloat(t.gewicht) : null;
    }, { timeout: 20_000 }).toBe(61.5);
});

test('Alter Master startet neu: erkennt die höhere Epoche, stuft sich zurück und wird synchroner Standby', async ({ request }) => {
    await leitstand(request, '/knoten/server1/starten', 'POST');
    await warteAufSynchron(request, 'server2', 60_000);
    expect(await vipHalter(request)).toBe('server2');
    const s1 = await knotenStatus(request, 'server1');
    expect(s1).toMatchObject({ rolle: 'secondary', epoche: 2, master: 'server2', rueckstufung_erforderlich: false });
    expect(s1.verlauf.map(v => v.ereignis)).toContain('rueckgestuft');
    await expect.poll(() => teilnehmerNamen(request, KNOTEN.server1.url, turnierId), { timeout: 5000 }).toEqual(['Adler', 'Busch', 'Conrad']);
});

test('Master verliert den Zeugen: gibt die VIP ab, server1 übernimmt, server2 stuft sich zurück', async ({ request }) => {
    await leitstand(request, '/zeuge/server2/trennen', 'POST');
    await warteAufMaster(request, 'server1', 20_000);
    expect((await knotenStatus(request, 'server1')).epoche).toBe(3);
    await leitstand(request, '/zeuge/server2/verbinden', 'POST');
    await warteAufSynchron(request, 'server1', 60_000);
    expect(await vipHalter(request)).toBe('server1');
    await legeTeilnehmerAn(request, turnierId, 'Diana', 'Diehl');
    await expect.poll(() => teilnehmerNamen(request, KNOTEN.server2.url, turnierId), { timeout: 5000 })
        .toEqual(['Adler', 'Busch', 'Conrad', 'Diehl']);
});

test('Secondary fällt aus: Master arbeitet asynchron weiter ("ohne Absicherung"), danach wieder synchron', async ({ request }) => {
    await leitstand(request, '/knoten/server2/stoppen', 'POST');
    await expect.poll(async () => (await knotenStatus(request, 'server1')).pg.absicherung, { timeout: 20_000 }).toBe('asynchron');
    await legeTeilnehmerAn(request, turnierId, 'Elena', 'Ebert');
    expect(await vipHalter(request)).toBe('server1');

    await leitstand(request, '/knoten/server2/starten', 'POST');
    await warteAufSynchron(request, 'server1', 60_000);
    await expect.poll(() => teilnehmerNamen(request, KNOTEN.server2.url, turnierId), { timeout: 5000 })
        .toEqual(['Adler', 'Busch', 'Conrad', 'Diehl', 'Ebert']);
});

test('Cluster-Seite: beide Server mit Rolle und Absicherung, Secondary mit Hinweis "nur lesend"', async ({ page }) => {
    await page.goto(`/cluster.html?turnierId=${turnierId}`);
    await expect(page.locator('.knoten-karte[data-knoten="server1"] [data-feld="rolle"]')).toHaveText('Master');
    await expect(page.locator('.knoten-karte[data-knoten="server2"] [data-feld="rolle"]')).toHaveText('Secondary');
    await expect(page.locator('.knoten-karte[data-knoten="server1"] [data-feld="absicherung"]')).toHaveText('synchron');
    // Der Client schreibt seinen Heartbeat alle 30 s (HEARTBEAT_INTERVALL_MS) — nach Neustarts und
    // Übergaben kann der aktuelle Master ihn erst mit dem nächsten Heartbeat haben.
    await expect(page.locator('#clusterClients')).toContainText('Matte', { timeout: 40_000 });
    await expect(page.locator('#clusterVerlauf')).toContainText('Zurückgestuft');
    await expect(page.locator('#secondaryBanner')).toHaveCount(0);

    await page.goto(`${KNOTEN.server2.url}/cluster.html?turnierId=${turnierId}`);
    await expect(page.locator('#secondaryBanner')).toContainText('nur lesend');
    await expect(page.locator('#btnUebergabe')).toBeHidden();
});

test('Geplante Übergabe per Knopf: Rollen getauscht, keine Daten verloren', async ({ page, request }) => {
    await page.goto(`/cluster.html?turnierId=${turnierId}`);
    page.once('dialog', d => d.accept());
    await page.locator('#btnUebergabe').click();
    await warteAufMaster(request, 'server2', 30_000);
    const s2 = await knotenStatus(request, 'server2');
    expect(s2.verlauf[0]).toMatchObject({ ereignis: 'master_geworden', grund: 'uebergabe' });
    await warteAufSynchron(request, 'server2', 60_000);
    expect(await teilnehmerNamen(request, '', turnierId)).toEqual(['Adler', 'Busch', 'Conrad', 'Diehl', 'Ebert']);
    await legeTeilnehmerAn(request, turnierId, 'Frida', 'Fuchs');
    await expect.poll(() => teilnehmerNamen(request, KNOTEN.server1.url, turnierId), { timeout: 5000 })
        .toEqual(['Adler', 'Busch', 'Conrad', 'Diehl', 'Ebert', 'Fuchs']);
});
