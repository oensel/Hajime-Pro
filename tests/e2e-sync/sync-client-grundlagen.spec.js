// Client-Knoten (SYNC_ROLLE=client): lokale PouchDB, Live-Replikation zum Hallen-Server in beide
// Richtungen, Status mit Verbindungszustand.
import { test, expect } from '@playwright/test';
import {
    syncStatus, legeTurnierAn, clientStatus, syncLeerlauf, ladeClientDokument, schreibeClientDokument, ladeDokument,
    clientTrennen, clientVerbinden
} from './helpers.js';

test.describe.serial('Client-Knoten: Replikation mit dem Hallen-Server', () => {
    let dbName;

    test('Client übernimmt die Turnier-Instanz des Servers und meldet sich verbunden', async ({ request }) => {
        await legeTurnierAn(request, 'Sync Client Grundlagen');
        const server = await syncStatus(request);
        dbName = server.db_name;
        await syncLeerlauf(request);
        const client = await clientStatus(request);
        expect(client.rolle).toBe('client');
        expect(client.instanz_id).toBe(server.instanz_id);
        expect(client.verbunden).toBe(true);
        expect(client.ausstehend).toBe(0);
    });

    test('Server-Dokumente kommen beim Client an', async ({ request }) => {
        const konfig = await ladeClientDokument(request, dbName, 'konfig:steuerung');
        expect(konfig.bezeichnung).toBe('Sync Client Grundlagen');
    });

    test('lokale Änderungen offline zählen als ausstehend und erreichen nach dem Verbinden den Server', async ({ request }) => {
        await clientTrennen(request);
        await schreibeClientDokument(request, dbName, {
            _id: 'test:offline-notiz', dokumenttyp: 'test', text: 'offline geschrieben',
            geschrieben_von_knoten: (await clientStatus(request)).client_id, bearbeitet_von: 'browser'
        });
        const offline = await clientStatus(request);
        expect(offline.verbunden).toBe(false);
        expect(offline.ausstehend).toBe(1);
        expect(await ladeDokument(request, dbName, 'test:offline-notiz')).toBeNull();

        await clientVerbinden(request);
        await syncLeerlauf(request);
        expect((await ladeDokument(request, dbName, 'test:offline-notiz')).text).toBe('offline geschrieben');
        expect((await clientStatus(request)).ausstehend).toBe(0);
    });

    // Bewusst Nodes fetch statt des Playwright-Request-Kontexts: der sendet laut Konfiguration
    // (extraHTTPHeaders) immer das Secret mit.
    test('Replikation ohne oder mit falschem SYNC_SECRET wird vom Server abgelehnt', async () => {
        expect((await fetch(`http://localhost:3200/db/${dbName}`)).status).toBe(401);
        expect((await fetch(`http://localhost:3200/db/${dbName}`, { headers: { 'x-hajime-sync-secret': 'falsch' } })).status).toBe(401);
        expect((await fetch(`http://localhost:3200/db/${dbName}`, { headers: { 'x-hajime-sync-secret': 'test-geheimnis' } })).status).toBe(200);
    });
});
