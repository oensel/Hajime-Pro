// Waage-Fenster (App, kompakte Ansicht für bestehende Teilnehmer): bei abgelaufener Lizenz, einer Lizenz, die
// am Wettkampftag nicht mehr gilt, und bei fehlenden Lizenzdaten erscheint ein Hinweis (kein alert()) samt
// editierbarem Datumsfeld; bei gültiger Lizenz bleibt die Ansicht bei Name und Gewicht. Die App-Ansicht wird
// hier über die Klassen modus-app/modus-tablet und handy.css nachgestellt (wie mobil/web/js/mobil/boot.js).
import { test, expect } from '@playwright/test';

const WETTKAMPFTAG = '2027-03-20';

async function legeTeilnehmerAn(request, turnierId, vorname, lizenz, judopass = `JP-${vorname}-${turnierId}`) {
    const daten = {
        turnier_id: turnierId, vorname, nachname: 'Lizenztest', verein: 'JC Test', judopass_id: judopass,
        geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 60, altersklasse: 'U18', gewichtsklasse: '-73kg'
    };
    if (lizenz) daten.lizenz_ablauf = lizenz;
    const resp = await request.post('/api/teilnehmer', { data: daten });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).teilnehmerId;
}

test.describe.serial('Waage: Lizenz-Hinweis und Datumsfeld', () => {
    let turnierId;
    let ids;
    let seite;
    const dialoge = [];

    test.beforeAll(async ({ browser, request }) => {
        const turnierResp = await request.post('/api/turniere', {
            data: { bezeichnung: 'Lizenz-Hinweis', ort: 'Teststadt', datum: WETTKAMPFTAG, ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
        });
        expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
        turnierId = (await turnierResp.json()).turnierId;

        ids = {
            abgelaufen: await legeTeilnehmerAn(request, turnierId, 'Abgelaufen', '2020-01-01'),
            vorWettkampftag: await legeTeilnehmerAn(request, turnierId, 'Knapp', '2026-12-31'),
            fehlt: await legeTeilnehmerAn(request, turnierId, 'Fehlt', null),
            gueltig: await legeTeilnehmerAn(request, turnierId, 'Gueltig', '2027-12-31'),
            ohnePass: await legeTeilnehmerAn(request, turnierId, 'OhnePass', '2027-12-31', '')
        };

        const context = await browser.newContext();
        seite = await context.newPage();
        seite.on('dialog', async (dialog) => { dialoge.push(dialog.message()); await dialog.dismiss(); });
        // App-Ansicht nachstellen: Klassen am <html> (vor dem Skriptstart) und handy.css
        await seite.route('**/teilnehmer.html*', async (route) => {
            const antwort = await route.fetch();
            const html = (await antwort.text())
                .replace('<html lang="de">', '<html lang="de" class="modus-app modus-tablet">')
                .replace('</head>', '<link rel="stylesheet" href="/css/handy.css"></head>');
            await route.fulfill({ response: antwort, body: html });
        });
        await seite.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    });

    test.afterAll(async () => {
        await seite.context().close();
    });

    const oeffne = async (id) => {
        await seite.evaluate((tid) => window.oeffneWaageModal(tid), id);
        await expect(seite.locator('#waageModal')).toBeVisible();
        await expect(seite.locator('#waageNameText')).not.toHaveText('');
    };
    const schliesse = async () => {
        await seite.locator('#waageModalClose').click();
        await expect(seite.locator('#waageModal')).toBeHidden();
    };

    test('abgelaufene Lizenz: Warnung und editierbares Datum, "Gewogen" gesperrt; neues Datum hebt die Sperre auf', async () => {
        await oeffne(ids.abgelaufen);
        await expect(seite.locator('#lizenzHinweis')).toBeVisible();
        await expect(seite.locator('#lizenzHinweis')).toContainText('abgelaufen');
        await expect(seite.locator('#lizenz_ablauf')).toBeVisible();
        await expect(seite.locator('#lizenz_ablauf')).toBeEnabled();
        await expect(seite.locator('#lizenz_ablauf')).toHaveClass(/lizenz-expired/);
        await expect(seite.locator('#submitBtn')).toBeDisabled();

        await seite.locator('#lizenz_ablauf').fill('2027-12-31');
        await expect(seite.locator('#lizenzHinweis')).toBeHidden();
        // Das Datumsfeld bleibt beim Eintippen sichtbar
        await expect(seite.locator('#lizenz_ablauf')).toBeVisible();
        await expect(seite.locator('#lizenz_ablauf')).toHaveClass(/lizenz-valid/);
        await expect(seite.locator('#submitBtn')).toBeEnabled();
        await schliesse();
    });

    test('Lizenz endet vor dem Wettkampftag: gilt als nicht gültig, Hinweis nennt den Wettkampftag', async () => {
        await oeffne(ids.vorWettkampftag);
        await expect(seite.locator('#lizenzHinweis')).toContainText('Wettkampftag (20.03.2027)');
        await expect(seite.locator('#lizenz_ablauf')).toHaveClass(/lizenz-expired/);
        await expect(seite.locator('#submitBtn')).toBeDisabled();
        await schliesse();
    });

    test('keine Lizenzdaten (ohne Scan): Hinweis und leeres Datumsfeld', async () => {
        await oeffne(ids.fehlt);
        await expect(seite.locator('#lizenzHinweis')).toContainText('Keine Lizenzdaten');
        await expect(seite.locator('#lizenz_ablauf')).toBeVisible();
        await expect(seite.locator('#lizenz_ablauf')).toHaveValue('');
        await expect(seite.locator('#lizenz_ablauf')).toHaveClass(/lizenz-fehlt/);
        await expect(seite.locator('#submitBtn')).toBeDisabled();
        await schliesse();
    });

    test('gültige Lizenz: kein Hinweis, Datumsfeld bleibt im kompakten Fenster verborgen; kein alert()', async () => {
        await oeffne(ids.gueltig);
        await expect(seite.locator('#lizenzHinweis')).toBeHidden();
        await expect(seite.locator('#lizenz_ablauf')).toBeHidden();
        await expect(seite.locator('#submitBtn')).toBeEnabled();
        await schliesse();
        expect(dialoge).toEqual([]);
    });

    test('"Gewogen" ohne Judopass-ID: möglich, die ID wird bei gültiger Lizenz erzeugt', async ({ request }) => {
        await oeffne(ids.ohnePass);
        await expect(seite.locator('#judopass_id')).toHaveValue('');
        await expect(seite.locator('#submitBtn')).toBeEnabled();
        await seite.locator('#submitBtn').click();
        await expect(seite.locator('#waageModal')).toBeHidden();

        await expect.poll(async () => (await (await request.get(`/api/teilnehmer/${ids.ohnePass}`)).json()).judopass_id).toMatch(/^AUTO-\d+$/);
        const gespeichert = await (await request.get(`/api/teilnehmer/${ids.ohnePass}`)).json();
        expect(gespeichert.gewogen).toBeTruthy();
    });
});

test('Hallen-Server: die Teilnehmerliste lädt Änderungen im Hintergrund nach (Sync-Rolle "server")', async ({ browser, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Liste-Nachladen', ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    const turnierId = (await turnierResp.json()).turnierId;
    const context = await browser.newContext();
    const seite = await context.newPage();
    // Der Testserver läuft ohne Sync; die Sync-Rolle wird hier vorgegeben
    await seite.route('**/api/sync/status', route => route.fulfill({ json: { rolle: 'server' } }));
    await seite.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await expect(seite.locator('#teilnehmerTableBody tr', { hasText: 'Nachgeladen' })).toHaveCount(0);

    // ein Client-Gerät hat einen Teilnehmer geliefert (hier direkt per API)
    await legeTeilnehmerAn(request, turnierId, 'Nachgeladen', '2027-12-31');
    await expect(seite.locator('#teilnehmerTableBody tr', { hasText: 'Nachgeladen' })).toHaveCount(1, { timeout: 10_000 });
    await context.close();
});
