import { test, expect } from '@playwright/test';
import { CLIENT_BASE_URL, SYNC_BASE_URL, SYNC_TEST_SECRET } from './test-env.js';
import { richteDk8TurnierEin, syncLeerlauf, clientVerbindungSetzen } from './helpers.js';

test.describe.serial('Client wechselt Server-Adresse und Geheimnis zur Laufzeit', () => {
    test('falsches Geheimnis -> abgelehnt, richtiges -> wieder verbunden', async ({ request }) => {
        await richteDk8TurnierEin(request, 'Verbindungswechsel');
        await syncLeerlauf(request);
        await clientVerbindungSetzen(request, { secret: 'falsch' });
        await expect.poll(async () => (await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json()).fehler, { timeout: 15000 })
            .toContain('abgelehnt');
        await clientVerbindungSetzen(request, { secret: SYNC_TEST_SECRET });
        await expect.poll(async () => (await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json()).verbunden, { timeout: 15000 })
            .toBe(true);
    });

    test('andere Server-URL (127.0.0.1 statt localhost) repliziert ohne Datenverlust weiter', async ({ request }) => {
        const neueUrl = SYNC_BASE_URL.replace('localhost', '127.0.0.1');
        await clientVerbindungSetzen(request, { serverUrl: neueUrl });
        await syncLeerlauf(request);
        const status = await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json();
        expect(status.verbunden).toBe(true);
        expect(status.ausstehend).toBe(0);
        await clientVerbindungSetzen(request, { serverUrl: SYNC_BASE_URL });
    });
});
