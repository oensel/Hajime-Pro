// End-to-End: Direktlinks aus Mails und Anmeldung am Handy (375 x 812) — kein Seitwärts-Scrollen, Hauptaktion erreichbar.
// Cloud-Konto und APIs werden per page.route ersetzt (wie erstregistrierungen-menue.spec.js).
import { test, expect } from '@playwright/test';
import { keinSeitwaertsScrollen } from './helpers/mobil.js';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

const superAdmin = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: null, verein_name: null, verein_freigegeben: false, verein_rolle: null,
    verein_wartet_auf_super_admin: false, ist_super_admin: true, super_admin_aktiv: true, vereine: []
};

async function alsSuperAdmin(page) {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: superAdmin } }));
    await page.route('**/api/vereine/pending', (route) => route.fulfill({ json: [] }));
}

for (const seite of ['/login.html', '/bestaetigen.html?token=x', '/freigabe.html?token=x', '/passwort-zuruecksetzen.html?token=x', '/mandat-bestaetigen.html?token=x', '/einladung.html?token=x']) {
    test(`${seite.split('?')[0]}: passt auf 375 px`, async ({ page }) => {
        await page.goto(seite);
        await expect(page.locator('body')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await keinSeitwaertsScrollen(page);
    });
}

test('Erstregistrierungen: Freigeben und Ablehnen sind am Handy erreichbar', async ({ page }) => {
    await alsSuperAdmin(page);
    await page.route('**/api/vereine/super/pending', (route) => route.fulfill({ json: [
        { id: 'u1', vorname: 'Eva', nachname: 'Neu', email: 'eva.mit.einer.langen.adresse@example.test', verein_id: 5, verein_name: 'Judoclub Neu-Langenhausen e. V.' }
    ] }));
    await page.goto('/admin-erstregistrierungen.html');
    const zeile = page.locator('.erstregistrierung-row[data-user-id="u1"]');
    await expect(zeile.getByRole('button', { name: 'Freigeben' })).toBeInViewport();
    await expect(zeile.getByRole('button', { name: 'Ablehnen' })).toBeInViewport();
    await keinSeitwaertsScrollen(page);
});

test('Nachrichten: Direktlink zeigt die Nachricht, Zurück-Knopf führt zur Liste', async ({ page }) => {
    await alsSuperAdmin(page);
    const thread = { id: 7, betreff: 'Neue Registrierung', absender: 'Eva Neu', absenderEmail: 'eva@example.test', anSuperAdmins: true, anfrageVerein: null, teilnehmer: [], nachrichten: [{ von: 'Eva Neu', eigene: false, text: 'Bitte freischalten.', erstelltAm: '2033-01-01T10:00:00Z' }] };
    const eintrag = { id: 7, betreff: 'Neue Registrierung', absender: 'Eva Neu', letzteVon: 'Eva Neu', ungelesen: true, vorschau: 'Bitte freischalten.', aktualisiertAm: '2033-01-01T10:00:00Z' };
    await page.route('**/api/nachrichten**', (route) => {
        const pfad = new URL(route.request().url()).pathname;
        if (pfad.endsWith('/empfaenger')) return route.fulfill({ json: { success: true, darfAnKonten: false, eigeneVereine: [], vereine: [] } });
        if (pfad.endsWith('/7')) return route.fulfill({ json: { success: true, thread } });
        return route.fulfill({ json: { success: true, threads: [eintrag] } });
    });
    await page.goto('/nachrichten.html?id=7');
    await expect(page.locator('#ansichtBetreff')).toHaveText('Neue Registrierung');
    await expect(page.locator('.nachrichten-liste')).toBeHidden();
    await expect(page.locator('#antwortText')).toBeVisible();
    await keinSeitwaertsScrollen(page);
    await page.locator('#zurueckKnopf').click();
    await expect(page.locator('.nachrichten-liste li')).toHaveCount(1);
    await expect(page.locator('#ansicht')).toBeHidden();
});
