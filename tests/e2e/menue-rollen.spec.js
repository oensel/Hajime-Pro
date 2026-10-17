// End-to-End: Menü nach Rolle (menu.js + src/shared/menueRechte.js, Helferverwaltung Spec 3.3).
// Die Suite läuft im Einzelbenutzerbetrieb; das Cloud-Verhalten wird geprüft, indem /api/config und
// /api/auth/me per page.route ersetzt werden (alle übrigen Aufrufe gehen an den echten Testserver).
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };

function konto({ rolle, istSuperAdmin = false, vereine } = {}) {
    const liste = vereine || [{ verein_id: 1, name: 'JC Test', freigegeben: rolle != null, rolle }];
    return {
        id: 'e2e-menue', email: 'menue@example.test', vorname: 'Mia', nachname: 'Menü',
        verein_id: liste[0] ? liste[0].verein_id : null,
        verein_name: liste[0] ? liste[0].name : null,
        verein_freigegeben: !!(liste[0] && liste[0].freigegeben),
        verein_rolle: liste[0] && liste[0].freigegeben ? liste[0].rolle : null,
        verein_wartet_auf_super_admin: false,
        ist_super_admin: istSuperAdmin,
        vereine: liste
    };
}

async function alsCloudKonto(page, user, { aktivWechsel } = {}) {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user } }));
    if (aktivWechsel) await page.route('**/api/vereine/aktiv', aktivWechsel);
}

test('Cloud: reiner Helfer wird von der Verwaltung zur Helfer-App geleitet', async ({ page }) => {
    await alsCloudKonto(page, konto({ rolle: 'helfer' }));
    await page.goto('/turniere.html');
    await expect(page).toHaveURL(/\/helfer\.html$/);
});

test('Cloud: Konto ohne Freigabe landet in der Helfer-App, auf profil.html nur mit Menüpunkt Helfer-App', async ({ page }) => {
    await alsCloudKonto(page, konto({ rolle: null }));
    await page.goto('/helfer-plan.html');
    await expect(page).toHaveURL(/\/helfer\.html$/);

    await page.goto('/profil.html');
    await expect(page.locator('#sidebarNavPrimary')).toBeVisible();
    await expect(page.locator('#nav-helfer-app')).toBeVisible();
    for (const id of ['nav-turniere', 'nav-turnier', 'nav-helfer', 'nav-dashboard', 'nav-nutzer']) {
        await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await expect(page).toHaveURL(/\/profil\.html$/);
});

test('Cloud: Benutzer sieht Verwaltung und Helfer-App, aber nicht „Nutzer“', async ({ page }) => {
    await alsCloudKonto(page, konto({ rolle: 'benutzer' }));
    await page.goto('/turniere.html');
    await expect(page.locator('#nav-turniere')).toBeVisible();
    await expect(page.locator('#nav-helfer-app')).toBeVisible();
    await expect(page.locator('#nav-helfer-app')).toHaveAttribute('href', '/helfer.html');
    await expect(page.locator('#nav-nutzer')).toBeHidden();
    await expect(page).toHaveURL(/\/turniere\.html$/);
});

test('Cloud: Super-Admin sieht „Nutzer“', async ({ page }) => {
    await alsCloudKonto(page, konto({ rolle: null, istSuperAdmin: true }));
    await page.goto('/profil.html');
    await expect(page.locator('#nav-nutzer')).toBeVisible();
    await expect(page.locator('#nav-nutzer')).toHaveAttribute('href', '/admin-nutzer.html');
    await expect(page.locator('#nav-helfer-app')).toBeVisible();
});

test('Cloud: aktiver Helfer-Verein wechselt in einen verwaltbaren Verein', async ({ page }) => {
    let gewechselt = null;
    const vereine = [
        { verein_id: 7, name: 'JC Helfer', freigegeben: true, rolle: 'helfer' },
        { verein_id: 8, name: 'JC Verwaltung', freigegeben: true, rolle: 'admin' }
    ];
    await alsCloudKonto(page, konto({ vereine }), {
        aktivWechsel: (route) => {
            gewechselt = route.request().postDataJSON();
            return route.fulfill({ status: 400, json: { success: false, error: 'Test: kein echter Wechsel' } });
        }
    });
    await page.goto('/turniere.html');
    // Der (hier abgelehnte) Wechsel wurde versucht; ohne Erfolg geht es zur Helfer-App.
    await expect(page).toHaveURL(/\/helfer\.html$/);
    expect(gewechselt).toEqual({ vereinId: 8 });
});

test('Cloud: Vereinswechsler bietet reine Helfer-Vereine nicht als aktiven Verein an', async ({ page }) => {
    const vereine = [
        { verein_id: 8, name: 'JC Verwaltung', freigegeben: true, rolle: 'benutzer' },
        { verein_id: 7, name: 'JC <b>Helfer</b>', freigegeben: true, rolle: 'helfer' },
        { verein_id: 9, name: 'JC Zweit', freigegeben: true, rolle: 'admin' }
    ];
    await alsCloudKonto(page, konto({ vereine }));
    await page.goto('/turniere.html');
    await page.locator('#vereinSwitcherBtn').click();
    const helferEintrag = page.locator('.verein-switcher-item[data-verein-id="7"]');
    await expect(helferEintrag).toBeDisabled();
    // Namen werden als Text eingesetzt, nicht als HTML
    await expect(helferEintrag.locator('span').first()).toHaveText('JC <b>Helfer</b>');
    await expect(helferEintrag).toContainText('Helfer');
    await expect(page.locator('.verein-switcher-item[data-verein-id="9"]')).toBeEnabled();
});

test('Einzelbenutzerbetrieb: Menü unverändert, ohne Helfer-App und Nutzer', async ({ page }) => {
    await page.goto('/turniere.html');
    await expect(page.locator('#nav-turniere')).toBeVisible();
    await expect(page.locator('#nav-helfer-app')).toBeHidden();
    await expect(page.locator('#nav-nutzer')).toBeHidden();
    await expect(page).toHaveURL(/\/turniere\.html$/);
});
