// End-to-End: Zeitplan-Simulation (zeitplan.html) rechnet Poolenden je Matte und verändert nichts am Turnier.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn, loseAus, verteileAufMatten, holePools } from './helpers/turnier-aufbau.js';

async function baueAuf(request) {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitplan Simulation' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 4, gewichtStart: 66 });
    await loseAus(request, turnierId, ['U18']);
    await verteileAufMatten(request, turnierId);
    return turnierId;
}

const anzahlKaempfe = async (request, turnierId) => {
    const pools = await holePools(request, turnierId);
    const liste = Array.isArray(pools) ? pools : pools.pools;
    return liste.reduce((s, p) => s + Number(p.gesamt_kaempfe ?? 0), 0);
};

test('Simulation zeigt je Pool ein Ende, längere Kampfzeit verschiebt es, das Turnier bleibt unverändert', async ({ page, request }) => {
    const turnierId = await baueAuf(request);
    const vorher = await anzahlKaempfe(request, turnierId);

    await page.goto(`/zeitplan.html?turnierId=${turnierId}`);
    const kampfzeit = page.locator('input[data-altersklasse="U18"]');
    await expect(kampfzeit).toBeVisible({ timeout: 15_000 });
    await expect(kampfzeit).not.toHaveValue('');

    await page.locator('#zeitplanBeginn').fill('09:00');
    await kampfzeit.fill('120');
    await page.locator('#zeitplanSimulieren').click();
    const poolEnde = page.locator('.zeitplan-pool .zeitplan-ende').first();
    await expect(poolEnde).toHaveText(/^ca\. \d{2}:\d{2}$/);
    const kurz = await poolEnde.textContent();

    await kampfzeit.fill('240');
    await page.locator('#zeitplanSimulieren').click();
    await expect(poolEnde).not.toHaveText(kurz);
    const lang = await poolEnde.textContent();
    expect(lang > kurz).toBeTruthy();
    await expect(page.locator('.zeitplan-matten-ende').first()).toHaveText(/^ca\. \d{2}:\d{2}$/);

    expect(await anzahlKaempfe(request, turnierId)).toBe(vorher);
});

test('Ohne Pools auf Matten erscheint ein Hinweis statt einer Tabelle', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitplan leer' });
    await page.goto(`/zeitplan.html?turnierId=${turnierId}`);
    await expect(page.locator('#zeitplanMeldung')).toContainText('noch keine Pools auf Matten', { timeout: 15_000 });
    await expect(page.locator('#zeitplanSimulieren')).toBeDisabled();
});

test('Der Start einer neuen Alters-/Geschlechtsklasse ist mit Uhrzeit hervorgehoben', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitplan Klassenstart' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 3, gewichtStart: 66 });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'weiblich', gewichtsklasse: '-63kg', anzahl: 3, gewichtStart: 56, namenszusatz: 'W' });
    await loseAus(request, turnierId, ['U18']);
    await verteileAufMatten(request, turnierId);

    await page.goto(`/zeitplan.html?turnierId=${turnierId}`);
    await expect(page.locator('input[data-altersklasse="U18"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('#zeitplanSimulieren').click();
    const starts = page.locator('.zeitplan-start');
    await expect(starts.first()).toHaveText(/^Start ca\. \d{2}:\d{2}$/);
    // ein Start je Alters-/Geschlechtsklasse, die auf einer Matte beginnt (mindestens eine, höchstens zwei)
    const anzahl = await starts.count();
    expect(anzahl).toBeGreaterThanOrEqual(1);
    expect(anzahl).toBeLessThanOrEqual(2);
    await expect(page.locator('.zeitplan-klassenstart').first()).toBeVisible();
});


test('Der Zeitplan hängt als Button an den Matten, nicht mehr im Menü', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitplan Button' });
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-zeitplan')).toHaveCount(0);
    await page.locator('#zeitplanBtn').click();
    await expect(page).toHaveURL(u => u.pathname === '/zeitplan.html' && u.searchParams.get('turnierId') === String(turnierId));
    await expect(page.getByRole('heading', { name: 'Zeitplan-Simulation' })).toBeVisible();
    await expect(page.locator('#nav-matten')).toHaveClass(/active/);
});

