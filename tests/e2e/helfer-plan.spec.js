// End-to-End: Helferplan-Seite (helfer-plan.html) mit Zeitstrahl. Hallen-Server ohne Anmeldung.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// Turnier 09:00–16:00 -> Zeitstrahl 08:00–17:00 (540 Minuten)
const BEREICH = { von: 480, bis: 1020 };
let turnierId;

async function ladePlan(request) {
    const resp = await request.get(`/api/helfer-plan/${turnierId}`);
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return resp.json();
}

const taetigkeit = (plan, name) => plan.taetigkeiten.find(t => t.bezeichnung === name);
const zeile = (page, name) => page.locator('.hp-zeile').filter({ has: page.locator('.hp-name', { hasText: name }) });

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: {
            bezeichnung: `Helferplan ${Date.now()}`, ort: 'Halle', datum: '2031-10-04', ausrichter: 'JC Helfer',
            anzahl_kampfflaechen: 2, beginn_min: 540, ende_min: 960
        }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
});

test('zeigt die Zeilen der Matten und der Waage mit Slots', async ({ page }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    await expect(zeile(page, 'Kampfgericht Matte 1')).toBeVisible();
    await expect(zeile(page, 'Kampfgericht Matte 2')).toBeVisible();
    await expect(zeile(page, 'Waage 1')).toBeVisible();
    await expect(zeile(page, 'Waage 1')).not.toContainText('aus Turnier');
    // Der Titel einer Tätigkeit bricht nicht um: die Höhe des Namens entspricht einer Textzeile
    const name = zeile(page, 'Kampfgericht Matte 1').locator('.hp-name');
    const { hoehe, zeilenhoehe, ueberlauf } = await name.evaluate((el) => {
        const stil = getComputedStyle(el);
        return { hoehe: el.getBoundingClientRect().height, zeilenhoehe: parseFloat(stil.lineHeight) || parseFloat(stil.fontSize) * 1.5, ueberlauf: el.scrollWidth > el.clientWidth };
    });
    expect(hoehe).toBeLessThanOrEqual(zeilenhoehe + 2);
    expect(ueberlauf).toBe(false);
    await expect(zeile(page, 'Waage 1').locator('.hp-slot').first()).toContainText('09:00–11:00 · 0/2');
    await expect(page.locator('#nav-helfer')).toHaveClass(/active/);
});

test('„+ Tätigkeit hinzufügen“: leere Bezeichnung zeigt Fehler, Waffelstand mit 3 Helfern legt Zeile an', async ({ page, request }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    await page.locator('#hpTaetigkeitNeu').click();
    await expect(page.locator('#hpTaetigkeitModal')).toBeVisible();
    await page.locator('#hpTaetigkeitOk').click();
    await expect(page.locator('#hpTaetigkeitFehler')).toHaveText('Bezeichnung eingeben');

    // Esc schließt das Popup
    await page.locator('#hpTaetigkeitBezeichnung').press('Escape');
    await expect(page.locator('#hpTaetigkeitModal')).toBeHidden();

    await page.locator('#hpTaetigkeitNeu').click();
    await page.locator('#hpTaetigkeitBezeichnung').fill('Waffelstand');
    await page.locator('#hpTaetigkeitBedarf').fill('3');
    await page.locator('#hpTaetigkeitBezeichnung').press('Enter');
    await expect(page.locator('#hpTaetigkeitModal')).toBeHidden();

    const waffeln = zeile(page, 'Waffelstand');
    await expect(waffeln).toBeVisible();
    await expect(waffeln).toContainText('min. 3 Helfer');
    await expect(waffeln.locator('.hp-slot')).toHaveCount(4);
    await expect(waffeln.locator('.hp-slot').first()).toContainText('0/3');

    const plan = await ladePlan(request);
    expect(taetigkeit(plan, 'Waffelstand').slots.map(s => [s.von_min, s.bis_min]))
        .toEqual([[540, 660], [660, 780], [780, 900], [900, 960]]);
});

test('Doppelklick auf freie Fläche legt einen Slot an', async ({ page, request }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    const spur = zeile(page, 'Waffelstand').locator('.hp-spur');
    await expect(spur.locator('.hp-slot')).toHaveCount(4);
    const box = await spur.boundingBox();
    // 16:30 liegt hinter dem letzten Slot (bis 16:00): neuer Slot 16:00–17:00
    const x = box.x + box.width * (990 - BEREICH.von) / (BEREICH.bis - BEREICH.von);
    await page.mouse.dblclick(x, box.y + box.height / 2);
    await expect(spur.locator('.hp-slot')).toHaveCount(5);

    const slots = taetigkeit(await ladePlan(request), 'Waffelstand').slots;
    expect(slots.some(s => s.von_min === 960 && s.bis_min === 1020)).toBeTruthy();
});

test('Ziehen des rechten Rands verkürzt den Slot', async ({ page, request }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    const spur = zeile(page, 'Kampfgericht Matte 1').locator('.hp-spur');
    const slot = spur.locator('.hp-slot').first();
    await expect(slot).toContainText('09:00–11:00');
    const spurBox = await spur.boundingBox();
    const griff = await slot.locator('.hp-griff.rechts').boundingBox();
    const startX = griff.x + griff.width / 2;
    const y = griff.y + griff.height / 2;
    const proStunde = spurBox.width * 60 / (BEREICH.bis - BEREICH.von);

    const gespeichert = page.waitForResponse(r => r.url().includes('/api/helfer-plan/slots/') && r.request().method() === 'PUT');
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - proStunde / 2, y, { steps: 4 });
    await page.mouse.move(startX - proStunde, y, { steps: 4 });
    await page.mouse.up();
    expect((await gespeichert).ok()).toBeTruthy();
    await expect(spur.locator('.hp-slot').first()).toContainText('09:00–10:00');

    const slots = taetigkeit(await ladePlan(request), 'Kampfgericht Matte 1').slots;
    expect([slots[0].von_min, slots[0].bis_min]).toEqual([540, 600]);
});

test('Helfer per Freitext zuteilen und wieder entfernen', async ({ page, request }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    const slot = zeile(page, 'Waage 1').locator('.hp-slot').first();
    await slot.locator('.hp-slot-text').click();
    const detail = page.locator('#hpDetail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Waage 1');
    await expect(detail).toContainText('Eingetragen: 0 von 2');

    await page.locator('#hpFreitext').fill('Erika Mustermann');
    await page.locator('#hpZuteilen').click();
    await expect(detail.locator('.hp-detail-liste')).toContainText('Erika Mustermann');
    await expect(detail).toContainText('Eingetragen: 1 von 2');
    await expect(zeile(page, 'Waage 1').locator('.hp-slot').first()).toContainText('1/2');
    await expect(zeile(page, 'Waage 1').locator('.hp-slot').first()).toHaveClass(/hp-teil/);

    let slots = taetigkeit(await ladePlan(request), 'Waage 1').slots;
    expect(slots[0].einsaetze.map(e => e.name)).toEqual(['Erika Mustermann']);

    await detail.getByRole('button', { name: 'Erika Mustermann entfernen' }).click();
    await expect(detail).toContainText('Eingetragen: 0 von 2');
    await expect(detail.locator('.hp-detail-liste')).not.toContainText('Erika Mustermann');
    slots = taetigkeit(await ladePlan(request), 'Waage 1').slots;
    expect(slots[0].einsaetze).toEqual([]);
});

test('Knopf „Helferausweise drucken“: ohne Einsätze Fehlermeldung, mit Einsatz öffnet sich ein Tab mit blob-PDF', async ({ page, request, context }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    await expect(zeile(page, 'Waage 1')).toBeVisible();

    await page.locator('#hpAusweise').click();
    await expect(page.locator('#snackbarText')).toContainText('Helfer');

    const slotId = taetigkeit(await ladePlan(request), 'Waage 1').slots[0].id;
    const ein = await request.post(`/api/helfer-plan/slots/${slotId}/einsaetze`, { data: { name: 'Ausweis Tester' } });
    expect(ein.ok(), await ein.text()).toBeTruthy();

    const neuerTab = context.waitForEvent('page');
    await page.locator('#hpAusweise').click();
    const tab = await neuerTab;
    // Headless-Chromium hat keinen PDF-Betrachter: dann wird die blob:-Adresse als Download behandelt
    const download = await Promise.race([
        tab.waitForEvent('download', { timeout: 10000 }).then(d => d.url()),
        expect.poll(() => tab.url(), { timeout: 10000 }).toMatch(/^blob:/).then(() => 'blob:')
    ]);
    expect(download).toMatch(/^blob:/);

    const loesch = await ladePlan(request);
    const id = taetigkeit(loesch, 'Waage 1').slots[0].einsaetze[0].id;
    expect((await request.delete(`/api/helfer-plan/einsaetze/${id}`)).ok()).toBeTruthy();
});

test('ohne Beginn/Ende erscheint ein Hinweis mit Link zur Turnierverwaltung', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Helferplan ohne Zeit ${Date.now()}`, ort: 'Halle', datum: '2031-10-05', ausrichter: 'JC Helfer', anzahl_kampfflaechen: 1 }
    });
    const ohneZeit = (await resp.json()).turnierId;
    await page.goto(`/helfer-plan.html?turnierId=${ohneZeit}`);
    const link = page.locator('#hpMeldung a');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/turnier.html?id=${ohneZeit}`);
    await expect(page.locator('#hpScroll')).toBeHidden();
});

test('bei 375 px Breite bricht die Seite nicht horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    await expect(zeile(page, 'Waage 1')).toBeVisible();
    const scrollKarte = await page.locator('.helfer-plan-card').evaluate(k => k.scrollWidth <= k.clientWidth + 1);
    expect(scrollKarte).toBeTruthy();
});
