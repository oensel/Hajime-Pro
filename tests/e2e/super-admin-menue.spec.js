// End-to-End: Super-Admin – Menüpunkte Benutzer, Vereine und Server-Update stehen im oberen Bereich der Seitenleiste,
// „Anstehende Turniere“ zeigt die Turniere aller Vereine. Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und
// Turnierliste werden per page.route ersetzt.
import { test, expect } from '@playwright/test';

const SUPER = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: 1, verein_name: 'Administration', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: true,
    vereine: [{ verein_id: 1, name: 'Administration', freigegeben: true, rolle: 'admin' }]
};

const turnier = (id, vereinId, bezeichnung, ausrichter, status) => ({
    id, verein_id: vereinId, bezeichnung, ausrichter, ort: 'Ort', plz: null, bundesland: null,
    datum: '2099-06-0' + id, status, status_effektiv: status, aktiv: false, anzahl_kampfflaechen: 2,
    altersklassen: { männlich_U15: 'djb' }, mannschafts_altersklassen: [], teilnehmer_anzahl: 5, anmeldeschluss: null,
    hat_ausschreibung: false, entfernung_km: null, helfer_bedarf: 0, helfer_belegt: 0, orga_gesamt: 0, orga_erledigt: 0
});

test('Super-Admin: Benutzer, Vereine und Server-Update stehen oben in der Seitenleiste', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
    await page.goto('/profil.html');
    for (const id of ['nav-nutzer', 'nav-vereine', 'nav-server-update']) {
        await expect(page.locator(`#sidebarNavPrimary #${id}`)).toBeVisible();
        await expect(page.locator(`#sidebarNavUnten #${id}`)).toHaveCount(0);
    }
    // unten bleibt nur der Rest (Helfer-App fehlt für Super-Admins)
    await expect(page.locator('#sidebarNavUnten #nav-helfer-app')).toBeHidden();
});

test('Super-Admin: Anstehende Turniere zeigt die Turniere aller Vereine, alle bearbeitbar', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
    await page.route('**/api/turniere?**', (route) => route.fulfill({
        json: [
            turnier(1, 1, 'Eigenes Turnier', 'Administration', 'veroeffentlicht'),
            turnier(2, 7, 'Turnier Alpha', 'JC Alpha', 'veroeffentlicht'),
            turnier(3, 8, 'Entwurf Beta', 'SV Beta', 'entwurf')
        ]
    }));
    await page.goto('/turniere.html');

    await expect(page.locator('.tournament-card')).toHaveCount(3);
    await expect(page.locator('.section-title', { hasText: 'Eigene Turniere' })).toBeVisible();
    await expect(page.locator('.section-title', { hasText: 'Turniere aller Vereine' })).toBeVisible();
    const alpha = page.locator('.tournament-card', { hasText: 'Turnier Alpha' });
    await expect(alpha).toContainText('Ausrichter: JC Alpha');
    await expect(alpha.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
    const beta = page.locator('.tournament-card', { hasText: 'Entwurf Beta' });
    await expect(beta).toContainText('Ausrichter: SV Beta');
    await expect(beta.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
});
