// Grundlagen der Sync-Schicht auf dem Hallen-Server: /api/sync/status, Anlage der Dokument-DB je
// Turnier-Instanz und das Ersetzen des (einzigen) Turniers beim Anlegen eines neuen.
import { test, expect, request as pwRequest } from '@playwright/test';
import { syncStatus, legeTurnierAn } from './helpers.js';

test.describe.serial('Sync-Grundlagen: Dokument-DB und Turnier-Instanz', () => {
    // Kein "anfangs ohne Turnier": die Spec-Dateien teilen sich einen Server, die Reihenfolge der
    // Dateien ist nicht garantiert.
    test('Status meldet Server-Rolle', async ({ request }) => {
        const status = await syncStatus(request);
        expect(status.rolle).toBe('server');
    });

    test('Turnier anlegen erzeugt Instanz und Dokument-DB', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, 'Sync Grundlagen 1');
        const status = await syncStatus(request);
        expect(status.turnier_id).toBe(turnierId);
        expect(status.instanz_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(status.db_name).toBe(`turnier_${status.instanz_id}`);
        expect((await request.get(`/db/${status.db_name}`)).ok()).toBeTruthy();
        expect((await request.get('/db/irgendeine_andere_db')).status()).toBe(404);
    });

    test('Browser der eigenen Seite (ohne Sec-Fetch, über http) braucht das SYNC_SECRET nicht', async ({ request, baseURL }) => {
        const status = await syncStatus(request);
        const ohneSecret = await pwRequest.newContext({ baseURL, extraHTTPHeaders: {} });
        const url = `/db/${status.db_name}/_all_docs`;
        // Ohne Secret und ohne Herkunft: abgelehnt.
        expect((await ohneSecret.get(url)).status()).toBe(401);
        // Referer/Origin der eigenen Seite (Host = Host-Header): wie ein Browser über http erlaubt.
        expect((await ohneSecret.get(url, { headers: { referer: `${baseURL}/kampf.html` } })).ok()).toBeTruthy();
        // Fremde Herkunft bleibt abgelehnt.
        expect((await ohneSecret.get(url, { headers: { referer: 'http://fremd.example/x.html' } })).status()).toBe(401);
        await ohneSecret.dispose();
    });

    test('Aktivieren eines zweiten Turniers wechselt die Dokument-DB; das erste bleibt in der Datenbank', async ({ request }) => {
        const alt = await syncStatus(request);
        await legeTurnierAn(request, 'Sync Grundlagen 2');
        const neu = await syncStatus(request);
        expect(neu.instanz_id).not.toBe(alt.instanz_id);
        // die Dokument-DB des bisherigen Turniers ist weg, seine Daten liegen weiter in der relationalen DB
        expect((await request.get(`/db/${alt.db_name}`)).status()).toBe(404);
        const turniere = await (await request.get('/api/turniere')).json();
        expect(turniere.map(t => t.id)).toContain(alt.turnier_id);
        expect(turniere.filter(t => t.aktiv).map(t => t.bezeichnung)).toEqual(['Sync Grundlagen 2']);
    });

    test('Neuanlage über turnier.html legt einen Entwurf an, ohne das aktive Turnier zu wechseln', async ({ page, request }) => {
        const vorher = await syncStatus(request);

        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill('Sync Grundlagen 3');
        await page.locator('#datum').fill('2027-05-15');
        await page.locator('#ort').fill('Senden');
        await page.locator('#plz').fill('48308');
        await page.locator('#ausrichter').fill('JC Senden');
        await page.locator('#anzahl_kampfflaechen').fill('1');
        await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
        await page.locator('#submitBtn').click();

        // kein Rückfrage-Dialog mehr: das Turnier wartet als Entwurf auf seinen Wettkampftag
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        expect((await syncStatus(request)).instanz_id).toBe(vorher.instanz_id);
        const turniere = await (await request.get('/api/turniere')).json();
        const neu = turniere.find(t => t.bezeichnung === 'Sync Grundlagen 3');
        expect(neu.aktiv).toBe(false);
        expect(neu.status).toBe('entwurf');
        // ein weiteres Turnier am selben Tag ist nicht erlaubt
        const doppelt = await request.post('/api/turniere', {
            data: { bezeichnung: 'Sync Grundlagen 4', ort: 'Senden', datum: '2027-05-15', ausrichter: 'JC Senden', anzahl_kampfflaechen: 1 }
        });
        expect(doppelt.status()).toBe(409);
    });
});
