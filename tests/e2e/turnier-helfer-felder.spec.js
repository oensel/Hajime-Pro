// End-to-End: Beginn, Ende und Anzahl Waagen am Turnier (Helferverwaltung) in der Turnierverwaltung.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('Beginn, Ende und Waagen werden gespeichert und nach dem Neuladen angezeigt', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { planungs_tools: true, bezeichnung: `Helferfelder ${Date.now()}`, ort: 'Teststadt', datum: '2031-09-14', ausrichter: 'JC Helfer', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    const { turnierId } = await resp.json();

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await expect(page.locator('#waagen_anzahl')).toHaveValue('1');

    await page.locator('#beginn').fill('09:00');
    await page.locator('#ende').fill('16:00');
    await page.locator('[data-schritt="2"]').click();
    await page.locator('#waagen_anzahl').fill('2');
    const speichern = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#submitBtn').click();
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
        data: { planungs_tools: true, bezeichnung: `Helferfelder Fehler ${Date.now()}`, ort: 'Teststadt', datum: '2031-09-15', ausrichter: 'JC Helfer', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await resp.json();

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('#beginn').fill('16:00');
    await page.locator('#ende').fill('09:00');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toContainText('Ende');

    const geladen = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(geladen.beginn_min).toBeNull();
    expect(geladen.ende_min).toBeNull();
});

test('Orga-Schalter: ohne Schalter kein Helferplan und keine Prozente, Beginn/Ende bleiben sichtbar', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Planung ${Date.now()}`, ort: 'Teststadt', datum: '2031-10-12', ausrichter: 'JC Planung', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await resp.json();

    // Hallen-Server: Standard ist aus
    const roh = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(roh.planungs_tools).toBe(false);

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await expect(page.locator('#beginn')).toBeVisible();
    await page.locator('[data-schritt="4"]').click();
    await expect(page.locator('#planungs_tools')).not.toBeChecked();

    await page.locator('#planungs_tools').check();
    await page.locator('[data-schritt="1"]').click();
    await page.locator('#beginn').fill('09:00');
    await page.locator('#ende').fill('16:00');
    const speichern = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#submitBtn').click();
    expect((await speichern).ok()).toBeTruthy();
    expect((await (await request.get(`/api/turniere/${turnierId}`)).json()).planungs_tools).toBe(true);

    // Einschalten (mit Turnierzeit) legt die Standarddienste an, die Turnierliste liefert dann Plätze
    const liste = await (await request.get('/api/turniere')).json();
    const mitTools = liste.find(t => t.id === turnierId);
    expect(mitTools.helfer_bedarf).toBeGreaterThan(0);
    expect(mitTools.orga_gesamt).toBeGreaterThan(0); // Orga-Vorlage wurde angelegt

    // Wieder ausschalten: keine Prozente mehr in der Liste, Daten bleiben
    await page.reload();
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('[data-schritt="4"]').click();
    await expect(page.locator('#planungs_tools')).toBeChecked(); // erst nach dem Laden ausschalten
    await page.locator('#planungs_tools').uncheck();
    const aus = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#submitBtn').click();
    expect((await aus).ok()).toBeTruthy();
    const liste2 = await (await request.get('/api/turniere')).json();
    const ohneTools = liste2.find(t => t.id === turnierId);
    expect([ohneTools.helfer_bedarf, ohneTools.orga_gesamt]).toEqual([0, 0]);
});
