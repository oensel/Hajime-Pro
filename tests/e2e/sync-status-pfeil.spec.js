// Handy-/App-Ansicht: am Sync-Status-Icon erscheint ein kleiner Pfeil nach oben (wie bei Git für noch nicht
// gepushte Commits), wenn das Gerät offline ist und noch Änderungen zum Server übertragen werden müssen.
// Die App-Ansicht wird wie in waage-lizenz-hinweis.spec.js nachgestellt (Klassen am <html>, handy.css,
// handy.js); der Sync-Status kommt aus einer abgefangenen /api/sync/status-Antwort.
import { test, expect } from '@playwright/test';

async function oeffneMitStatus(browser, status) {
    const context = await browser.newContext();
    const seite = await context.newPage();
    await seite.route('**/api/sync/status', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ rolle: 'client', instanz_id: 'test-instanz', verbindung_wird_geprueft: false, ...status })
    }));
    await seite.route('**/teilnehmer.html*', async (route) => {
        const antwort = await route.fetch();
        const html = (await antwort.text())
            .replace('<html lang="de">', '<html lang="de" class="modus-app modus-tablet">')
            .replace('</head>', '<link rel="stylesheet" href="/css/handy.css"><script src="/js/handy.js" defer></script></head>');
        await route.fulfill({ response: antwort, body: html });
    });
    await seite.goto('/teilnehmer.html?turnierId=1');
    await expect(seite.locator('#handyStatusIcon')).toBeVisible();
    return { seite, context };
}

test.describe('Pfeil am Sync-Status-Icon', () => {
    test('offline mit ausstehenden Änderungen: Pfeil sichtbar', async ({ browser }) => {
        const { seite, context } = await oeffneMitStatus(browser, { verbunden: false, ausstehend: 3 });
        await expect(seite.locator('#handyStatusIcon')).toHaveText('cloud_off');
        await expect(seite.locator('#handyStatusPfeil')).toBeVisible();
        await expect(seite.locator('#handyStatusBtn')).toHaveAttribute('title', /3 Änderungen ausstehend/);
        await context.close();
    });

    test('offline ohne ausstehende Änderungen: kein Pfeil', async ({ browser }) => {
        const { seite, context } = await oeffneMitStatus(browser, { verbunden: false, ausstehend: 0 });
        await expect(seite.locator('#handyStatusIcon')).toHaveText('cloud_off');
        await expect(seite.locator('#handyStatusPfeil')).toBeHidden();
        await context.close();
    });

    test('verbunden (auch mit Übertragung): kein Pfeil', async ({ browser }) => {
        const { seite, context } = await oeffneMitStatus(browser, { verbunden: true, ausstehend: 2 });
        await expect(seite.locator('#handyStatusIcon')).toHaveText('cloud_done');
        await expect(seite.locator('#handyStatusPfeil')).toBeHidden();
        await context.close();
    });
});
