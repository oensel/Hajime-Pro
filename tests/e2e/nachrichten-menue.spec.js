// End-to-End: Nachrichten im Menü – Super-Admins haben einen eigenen Menüpunkt hinter einem Trenner, alle anderen sehen den
// roten Kreis am Profil-Icon und öffnen ihre Nachrichten darüber. Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und
// Zähler werden per page.route ersetzt.
import { test, expect } from '@playwright/test';

const konto = (extra) => ({
    id: 'e2e-konto', email: 'konto@example.test', vorname: 'Kim', nachname: 'Konto',
    verein_id: 1, verein_name: 'JC Test', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: false, super_admin_aktiv: false,
    vereine: [{ verein_id: 1, name: 'JC Test', freigegeben: true, rolle: 'admin' }], ...extra
});

async function mocke(page, user, anzahl) {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user } }));
    await page.route('**/api/nachrichten/ungelesen', (route) => route.fulfill({ json: { success: true, anzahl } }));
}

test('Super-Admin: Menüpunkt Nachrichten mit Zähler, Trenner vor den Super-Admin-Punkten', async ({ page }) => {
    await mocke(page, konto({ ist_super_admin: true, super_admin_aktiv: true }), 3);
    await page.goto('/profil.html');
    await expect(page.locator('#sidebarNavPrimary #nav-nachrichten')).toBeVisible();
    await expect(page.locator('#nav-nachrichten-zaehler')).toHaveText('3');
    await expect(page.locator('#profilBadge')).toHaveText('3');
    const reihenfolge = await page.locator('#sidebarNavPrimary > *:visible').evaluateAll((els) => els.map((e) => e.id));
    expect(reihenfolge.indexOf('nav-super-trenner')).toBeGreaterThan(reihenfolge.indexOf('nav-urkunden'));
    expect(reihenfolge.indexOf('nav-nachrichten')).toBe(reihenfolge.indexOf('nav-super-trenner') + 1);
});

test('Admin: roter Kreis am Profil-Icon, Nachrichten im Profil-Menü, kein eigener Menüpunkt', async ({ page }) => {
    await mocke(page, konto(), 2);
    await page.goto('/profil.html');
    await expect(page.locator('#profilBadge')).toHaveText('2');
    await expect(page.locator('#nav-nachrichten')).toBeHidden();
    await expect(page.locator('#nav-super-trenner')).toBeHidden();
    await page.locator('#profileBtn').click();
    await expect(page.locator('#profilMenue')).toBeVisible();
    await expect(page.locator('#profilMenueZaehler')).toHaveText('2');
    await page.locator('#profilMenueNachrichten').click();
    await expect(page).toHaveURL(/nachrichten\.html/);
});

test('Ohne Nachrichten-Route (Hallen-Server) bleibt das Profil-Icon ein einfacher Link', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: konto() } }));
    await page.route('**/api/nachrichten/ungelesen', (route) => route.fulfill({ status: 404, json: {} }));
    await page.goto('/turniere.html');
    await expect(page.locator('#profilBadge')).toBeHidden();
    await page.locator('#profileBtn').click();
    await expect(page).toHaveURL(/profil\.html/);
});
