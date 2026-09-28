// Eingeschränktes Frontend eines Client-Geräts: nur Waage, Scoreboard, Mattenleitung (+ Anzeige,
// Startseite); Lesezugriffe beantwortet die Client-API aus den lokalen Dokumenten.
import { test, expect } from '@playwright/test';
import { richteDk8TurnierEin, syncLeerlauf, CLIENT_BASE_URL } from './helpers.js';

test.describe.serial('Client-Frontend', () => {
    let matId, turnierId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId } = await richteDk8TurnierEin(request, 'Sync Client Frontend'));
        await syncLeerlauf(request);
    });

    test('Verwaltungsseiten gibt es nur am Server, Client-Seiten schon', async ({ request }) => {
        for (const seite of ['pools.html', 'turnier.html', 'matten.html', 'turniere.html']) {
            const resp = await request.get(`${CLIENT_BASE_URL}/${seite}`);
            expect(resp.status(), seite).toBe(404);
            expect(await resp.text()).toContain('nur am Hallen-Server');
        }
        for (const seite of ['client.html', 'steuerung.html', 'kampf.html', 'teilnehmer.html', '']) {
            expect((await request.get(`${CLIENT_BASE_URL}/${seite}`)).status(), seite).toBe(200);
        }
    });

    test('Client-API liefert dieselbe Mattenansicht wie der Server und sperrt Verwaltungsaufrufe', async ({ request }) => {
        const kern = (l) => l.map(k => [k.id, k.status, k.kaempfer1_nachname, k.kaempfer2_nachname, k.matten_reihenfolge]);
        const server = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const client = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
        expect(kern(client)).toEqual(kern(server));
        const teilnehmer = await (await request.get(`${CLIENT_BASE_URL}/api/teilnehmer?turnierId=${turnierId}`)).json();
        expect(teilnehmer).toHaveLength(8);
        const turnier = await (await request.get(`${CLIENT_BASE_URL}/api/turniere/${turnierId}`)).json();
        expect(turnier.bezeichnung).toBe('Sync Client Frontend');
        expect((await request.post(`${CLIENT_BASE_URL}/api/pools`, { data: {} })).status()).toBe(403);
    });

    test('Startseite: Matte wählen, Menü zeigt nur Gerät/Waage/Mattenleitung/Scoreboard', async ({ page }) => {
        await page.goto(`${CLIENT_BASE_URL}/client.html`);
        await expect(page.locator('#clientTurnier')).toContainText('Sync Client Frontend');
        await page.locator('#clientMatteSelect').selectOption(String(matId));
        // Hatte das Gerät (aus einem früheren Test) schon eine Matte, fragt der Wechsel nach.
        await page.locator('#customConfirmModal').waitFor({ state: 'visible', timeout: 2000 })
            .then(() => page.locator('#modalConfirmBtn').click())
            .catch(() => {});
        await expect.poll(async () => (await (await page.request.get(`${CLIENT_BASE_URL}/api/sync/client/matte`)).json()).matte_id).toBe(matId);
        await expect(page.locator('#nav-geraet')).toBeVisible();
        await expect(page.locator('#nav-scoreboard')).toBeVisible();
        await expect(page.locator('#nav-pools')).toBeHidden();
        await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'verbunden');
    });
});
