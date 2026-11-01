// Leere Teilnehmerliste: ohne Meldungen "Keine Teilnehmer gemeldet.", bei einer Suche ohne Treffer ein eigener Hinweis.
import { test, expect } from '@playwright/test';

test('Leere Teilnehmerliste unterscheidet "nichts gemeldet" und "Suche ohne Treffer"', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Leere Liste', ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await turnierResp.json();
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await expect(page.locator('#teilnehmerTableBody')).toContainText('Keine Teilnehmer gemeldet.');

    const r = await request.post('/api/teilnehmer', {
        data: { turnier_id: turnierId, vorname: 'Anna', nachname: 'Leer', verein: 'JC Test', geburtsjahr: 2009, geschlecht: 'weiblich', gewicht: 50, altersklasse: 'U18', gewichtsklasse: '-52' }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    await page.reload();
    await expect(page.locator('#teilnehmerTableBody tr', { hasText: 'Leer' })).toHaveCount(1);
    await page.locator('#teilnehmerSearchInput').fill('Zzz');
    await expect(page.locator('#teilnehmerTableBody')).toContainText('Keine Treffer für diese Suche.');
});
