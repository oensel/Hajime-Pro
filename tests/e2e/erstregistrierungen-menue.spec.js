// End-to-End: „Einladungen“ und „Erstregistrierungen“ (mit hochgestellter Anzahl offener Anträge) als eigene
// Menüpunkte unter „Benutzer“. Cloud-Konto und APIs werden per page.route ersetzt (wie menue-rollen.spec.js).
import { test, expect } from '@playwright/test';

const superAdmin = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: null, verein_name: null, verein_freigegeben: false, verein_rolle: null,
    verein_wartet_auf_super_admin: false, ist_super_admin: true, super_admin_aktiv: true, vereine: []
};

async function alsSuperAdmin(page, pending) {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: superAdmin } }));
    await page.route('**/api/vereine/super/pending', (route) => route.fulfill({ json: pending }));
    await page.route('**/api/vereine/pending', (route) => route.fulfill({ json: [] }));
}

test('Menü: Einladungen und Erstregistrierungen mit hochgestellter Anzahl', async ({ page }) => {
    await alsSuperAdmin(page, [
        { id: 'u1', vorname: 'Eva', nachname: 'Neu', email: 'eva@example.test', verein_id: 5, verein_name: 'JC Neu' },
        { id: 'u2', vorname: 'Ben', nachname: 'Zwei', email: 'ben@example.test', verein_id: 6, verein_name: 'JC Zwei' }
    ]);
    await page.goto('/admin-nutzer.html');
    await expect(page.locator('#nav-einladungen')).toBeVisible();
    await expect(page.locator('#nav-einladungen')).toHaveAttribute('href', '/admin-einladungen.html');
    await expect(page.locator('#nav-erstregistrierungen')).toBeVisible();
    await expect(page.locator('#nav-erstregistrierungen sup')).toHaveText('2');
});

test('Erstregistrierungen: Liste, Freigeben mit Rolle', async ({ page }) => {
    const entschieden = [];
    await alsSuperAdmin(page, [{ id: 'u1', vorname: 'Eva', nachname: 'Neu', email: 'eva@example.test', verein_id: 5, verein_name: 'JC Neu' }]);
    await page.route('**/api/vereine/super/approve', (route) => { entschieden.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true } }); });
    await page.goto('/admin-erstregistrierungen.html');
    const zeile = page.locator('.erstregistrierung-row[data-user-id="u1"]');
    await expect(zeile).toContainText('eva@example.test · JC Neu');
    await expect(zeile.locator('select')).toHaveValue('admin');
    await zeile.getByRole('button', { name: 'Freigeben' }).click();
    await expect.poll(() => entschieden.length).toBe(1);
    expect(entschieden[0]).toEqual({ userId: 'u1', vereinId: 5, rolle: 'admin' });
});
