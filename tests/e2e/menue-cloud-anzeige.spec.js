// End-to-End: das Cloud-Symbol oben rechts (menu.js, #cloudAnzeige) erscheint nur auf dem Cloud-Server, im selben Stil wie
// die Symbole für Hell/Dunkel; am Hallen-Server fehlt es. Das Cloud-Verhalten entsteht durch Ersetzen von /api/config und /api/auth/me.
import { test, expect } from '@playwright/test';

const KONTO = {
    id: 'e2e-cloud', email: 'cloud@example.test', vorname: 'Cora', nachname: 'Cloud',
    verein_id: 1, verein_name: 'JC Test', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: false,
    vereine: [{ verein_id: 1, name: 'JC Test', freigegeben: true, rolle: 'admin' }]
};

test('Hallen-Server: kein Cloud-Symbol in der Kopfleiste', async ({ page }) => {
    await page.goto('/turniere.html');
    await expect(page.locator('#themeToggle')).toBeVisible();
    await expect(page.locator('#cloudAnzeige')).toBeHidden();
});

test('Cloud-Server: Cloud-Symbol im Stil der Hell/Dunkel-Symbole, nur zur Anzeige', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: KONTO } }));
    await page.goto('/turniere.html');
    const anzeige = page.locator('#cloudAnzeige');
    await expect(anzeige).toBeVisible();
    await expect(anzeige).toHaveAttribute('title', 'Cloud-Server');
    await expect(anzeige.locator('.material-icons')).toHaveText('cloud');
    const stil = (loc) => loc.evaluate((e) => {
        const s = getComputedStyle(e);
        return { breite: s.width, hoehe: s.height, rand: s.borderTopWidth, radius: s.borderTopLeftRadius };
    });
    expect(await stil(anzeige)).toEqual(await stil(page.locator('#themeToggle')));
    // Nur eine Anzeige: ein Klick ändert weder die Seite noch öffnet er etwas.
    await anzeige.click();
    await expect(page).toHaveURL(/\/turniere\.html$/);
});
