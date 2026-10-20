// End-to-End: Mitbringliste in der Helfer-App (helfer.html#turnier=<id>). Hallen-Server-Betrieb mit HELFER_APP_AKTIV=true
// (test-env.js): der Einzelbenutzer offline_user darf überall mitbringen. Ohne vorhandene Mitbringliste bleibt der Block aus.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const LAUF = Date.now();
let ohneOrga;
let mitOrga;

async function neuesTurnier(request, name) {
    const resp = await request.post('/api/turniere', {
        data: { planungs_tools: true, bezeichnung: name, ort: 'Halle', datum: '2032-09-18', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1, beginn_min: 540, ende_min: 780 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    const id = (await resp.json()).turnierId;
    const pub = await request.post(`/api/turniere/${id}/veroeffentlichen`);
    expect(pub.ok(), await pub.text()).toBeTruthy();
    return id;
}

test.beforeAll(async ({ request }) => {
    ohneOrga = await neuesTurnier(request, `Mitbring ohne Orga ${LAUF}`);
    mitOrga = await neuesTurnier(request, `Mitbring mit Orga ${LAUF}`);
    // Neue Turniere bekommen die Standardvorlage samt Catering/Mitbringliste; beim ersten Turnier fehlt sie absichtlich.
    const orga = await (await request.get(`/api/orga?turnierId=${ohneOrga}`)).json();
    const catering = orga.phasen.flatMap((p) => p.aufgaben).find((a) => a.mitbringliste);
    expect(catering).toBeTruthy();
    expect((await request.delete(`/api/orga/aufgaben/${catering.id}`)).ok()).toBeTruthy();
});

test('Ohne Mitbringliste im Turnier gibt es keinen Block (Lesen legt nichts an)', async ({ page, request }) => {
    await page.goto(`/helfer.html#turnier=${ohneOrga}`);
    await expect(page.locator('.hf-titel')).toContainText(`Mitbring ohne Orga ${LAUF}`);
    await expect(page.locator('#hfMitbringliste')).toBeHidden();
    const orga = await (await request.get(`/api/orga?turnierId=${ohneOrga}&nurLesen=1`)).json();
    expect(orga.phasen.flatMap((p) => p.aufgaben).some((a) => a.mitbringliste)).toBe(false);
});

test('Eintragen, Menge, eigener Eintrag löschbar, Sonderzeichen als Text', async ({ page }) => {
    await page.goto(`/helfer.html#turnier=${mitOrga}`);
    const block = page.locator('#hfMitbringliste');
    await expect(block).toBeVisible();
    await expect(block.getByRole('heading', { name: 'Mitbringliste' })).toBeVisible();
    await expect(block).toContainText('Noch nichts eingetragen');

    await block.getByLabel('Ich bringe mit').fill('Marmorkuchen');
    await block.getByLabel('Menge (optional)').fill('2');
    await block.getByRole('button', { name: 'Eintragen' }).click();
    const kuchen = block.locator('.hf-mitbring-eintrag').filter({ hasText: 'Marmorkuchen' });
    await expect(kuchen).toBeVisible();
    await expect(kuchen).toContainText('(2×)');
    await expect(kuchen.getByRole('button', { name: /löschen/ })).toBeVisible();
    await expect(block.getByLabel('Ich bringe mit')).toHaveValue('');

    // leerer Titel: Hinweis, kein Eintrag
    await block.getByRole('button', { name: 'Eintragen' }).click();
    await expect(block.locator('#hfMitbringFehler')).toContainText('Bitte eintragen');

    // HTML wird nicht interpretiert
    await block.getByLabel('Ich bringe mit').fill('<img src=x onerror="window.__xss=1">Salat');
    await block.getByRole('button', { name: 'Eintragen' }).click();
    const salat = block.locator('.hf-mitbring-eintrag').filter({ hasText: 'Salat' });
    await expect(salat).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(block.locator('img')).toHaveCount(0);

    // bleibt nach dem Neuladen, Löschen entfernt den eigenen Eintrag
    await page.reload();
    await expect(page.locator('#hfMitbringliste .hf-mitbring-eintrag')).toHaveCount(2);
    await page.locator('#hfMitbringliste .hf-mitbring-eintrag').filter({ hasText: 'Marmorkuchen' }).getByRole('button', { name: /löschen/ }).click();
    await expect(page.locator('#hfMitbringliste .hf-mitbring-eintrag')).toHaveCount(1);
    await expect(page.locator('#hfMitbringliste')).not.toContainText('Marmorkuchen');
});
