// End-to-End: Beginn, Ende und Anzahl Waagen am Turnier (Helferverwaltung) in der Turnierverwaltung.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Beginn, Ende und Waagen werden gespeichert und nach dem Neuladen angezeigt', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Helferfelder ${Date.now()}`, ort: 'Teststadt', datum: '2031-09-14', ausrichter: 'JC Helfer', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    const { turnierId } = await resp.json();

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await expect(page.locator('#waagen_anzahl')).toHaveValue('1');

    await page.locator('#beginn').fill('09:00');
    await page.locator('#ende').fill('16:00');
    await page.locator('#waagen_anzahl').fill('2');
    const speichern = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#turnierForm button[type="submit"]').click();
    expect((await speichern).ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator('#beginn')).toHaveValue('09:00');
    await expect(page.locator('#ende')).toHaveValue('16:00');
    await expect(page.locator('#waagen_anzahl')).toHaveValue('2');

    const gespeichert = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect([gespeichert.beginn_min, gespeichert.ende_min, gespeichert.waagen_anzahl]).toEqual([540, 960, 2]);
});

test('Ende vor Beginn zeigt eine Fehlermeldung und speichert nichts', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Helferfelder Fehler ${Date.now()}`, ort: 'Teststadt', datum: '2031-09-15', ausrichter: 'JC Helfer', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await resp.json();

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('#beginn').fill('16:00');
    await page.locator('#ende').fill('09:00');
    await page.locator('#turnierForm button[type="submit"]').click();
    await expect(page.locator('#snackbarText')).toContainText('Ende');

    const geladen = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(geladen.beginn_min).toBeNull();
    expect(geladen.ende_min).toBeNull();
});
