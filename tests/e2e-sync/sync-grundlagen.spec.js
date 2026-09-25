// Grundlagen der Sync-Schicht auf dem Hallen-Server: /api/sync/status, Anlage der Dokument-DB je
// Turnier-Instanz und das Ersetzen des (einzigen) Turniers beim Anlegen eines neuen.
import { test, expect } from '@playwright/test';
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

    test('zweites Turnier ersetzt das erste komplett (SQL und Dokument-DB)', async ({ request }) => {
        const alt = await syncStatus(request);
        await legeTurnierAn(request, 'Sync Grundlagen 2');
        const neu = await syncStatus(request);
        expect(neu.instanz_id).not.toBe(alt.instanz_id);
        expect((await request.get(`/db/${alt.db_name}`)).status()).toBe(404);
        const turniere = await (await request.get('/api/turniere')).json();
        expect(turniere.map(t => t.bezeichnung)).toEqual(['Sync Grundlagen 2']);
    });
});
