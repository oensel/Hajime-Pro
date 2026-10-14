// Mannschafts-Pool: Gewichtsklassen per Dialog hinzufügen/ändern/löschen und neu verteilen.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.describe('Mannschaften: Gewichtsklassen bearbeiten', () => {
    let turnierId;
    let poolId;

    test('Pool anlegen', async ({ request }) => {
        const t = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E GK-Editor ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC GK', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await t.json()).turnierId;
        expect(turnierId).toBeTruthy();
        const p = await request.post('/api/pools', {
            data: {
                turnier_id: turnierId, bezeichnung: 'U15 m Team', geschlecht: 'männlich', altersklasse: 'U15',
                modus: 'Jeder-gegen-Jeden', kampfzeit_sekunden: 180, typ: 'mannschaft',
                mannschafts_gewichtsklassen: ['-40', '-50']
            }
        });
        poolId = (await p.json()).poolId;
        expect(poolId).toBeTruthy();
    });

    test('Dialog: hinzufügen, ändern, löschen', async ({ page }) => {
        await page.goto(`/mannschaften.html?turnierId=${turnierId}`);
        const chips = page.locator(`.gewichtsklassen-chips[data-pool-id="${poolId}"]`);
        await expect(chips.locator('.gk-edit-btn')).toHaveCount(2);

        await chips.locator('.gk-add-btn').click();
        await expect(page.locator('#gkModal')).toBeVisible();
        await page.locator('#gkWert').fill('+50');
        await page.locator('#gkModalSpeichern').click();
        await expect(chips.locator('.gk-edit-btn')).toHaveCount(3);
        await expect(chips.locator('.gk-edit-btn').last()).toHaveText('+50 kg');

        await chips.locator('.gk-edit-btn[data-gk="-40"]').click();
        await page.locator('#gkWert').fill('-42');
        await page.locator('#gkModalSpeichern').click();
        await expect(chips.locator('.gk-edit-btn[data-gk="-42"]')).toHaveCount(1);

        await chips.locator('.gk-delete-btn[data-gk="-50"]').click();
        await page.locator('#modalConfirmBtn').click();
        await expect(chips.locator('.gk-edit-btn')).toHaveCount(2);
    });

    test('Ungültige Eingabe wird abgelehnt', async ({ request }) => {
        const r = await request.put(`/api/mannschaften/pools/${poolId}/gewichtsklassen`, { data: { gewichtsklassen: ['abc'] } });
        expect(r.status()).toBe(400);
    });
});
