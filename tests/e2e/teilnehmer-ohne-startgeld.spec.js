// End-to-End: Verlangt das Turnier kein Startgeld, gibt es auf teilnehmer.html keine Startgeld-Spalte
// und keine Bezahlt-Kachel, und ein fehlendes "bezahlt" verhindert den Status "bereit" nicht.
// Mit Startgeld bleiben Spalte und Regel unverändert.
import { test, expect } from '@playwright/test';

test.describe.serial('Startgeld-Spalte nur bei Turnieren mit Startgeld', () => {
    let turnierFrei;
    let turnierMitStartgeld;
    let freiTeilnehmerId;

    async function legeTurnierAn(request, daten = {}) {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Startgeld ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC Startgeld', anzahl_kampfflaechen: 1, ...daten }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).turnierId;
    }

    async function legeTeilnehmerAn(request, turnierId, vorname) {
        const resp = await request.post('/api/teilnehmer', {
            data: { turnier_id: turnierId, vorname, nachname: 'Judoka', geschlecht: 'männlich', verein: 'JC Startgeld', geburtsjahr: 2015, gewicht: 30, altersklasse: 'U11' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    }

    test('Turnier ohne Startgeld: Spalte und Kachel sind ausgeblendet', async ({ page, request }) => {
        turnierFrei = await legeTurnierAn(request);
        freiTeilnehmerId = await legeTeilnehmerAn(request, turnierFrei, 'Frei');

        await page.goto(`/teilnehmer.html?id=${turnierFrei}`);
        await expect(page.locator('#teilnehmerTableBody tr')).toHaveCount(1);
        await expect(page.locator('#startgeldSpalteHeader')).toBeHidden();
        await expect(page.locator('#statBezahltKachel')).toBeHidden();
        await expect(page.locator('#teilnehmerTableBody [data-toggle="bezahlt"]')).toBeHidden();
    });

    test('Turnier ohne Startgeld: gewogen + Lizenz genügen für "bereit"', async ({ page, request }) => {
        const resp = await request.put(`/api/teilnehmer/${freiTeilnehmerId}/status`, {
            data: { gewogen: true, lizenz_ablauf: '2099-12-31' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        await page.goto(`/teilnehmer.html?id=${turnierFrei}`);
        await expect(page.locator('#teilnehmerTableBody tr')).toHaveCount(1);
        await expect(page.locator('#teilnehmerTableBody [data-status-select]').first()).toHaveValue('kampfbereit');
    });

    test('Turnier mit Startgeld: Spalte sichtbar, ohne Bezahlung nicht "bereit"', async ({ page, request }) => {
        turnierMitStartgeld = await legeTurnierAn(request, {
            startgeld: 8, iban: 'DE89370400440532013000', kontoinhaber: 'E2E Judoverein', verwendungszweck: 'Startgeld E2E'
        });
        const id = await legeTeilnehmerAn(request, turnierMitStartgeld, 'Zahler');
        const resp = await request.put(`/api/teilnehmer/${id}/status`, { data: { gewogen: true, lizenz_ablauf: '2099-12-31' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        await page.goto(`/teilnehmer.html?id=${turnierMitStartgeld}`);
        await expect(page.locator('#teilnehmerTableBody tr')).toHaveCount(1);
        await expect(page.locator('#startgeldSpalteHeader')).toBeVisible();
        await expect(page.locator('#statBezahltKachel')).toBeVisible();
        await expect(page.locator('#teilnehmerTableBody [data-status-select]').first()).not.toHaveValue('kampfbereit');
    });
});
