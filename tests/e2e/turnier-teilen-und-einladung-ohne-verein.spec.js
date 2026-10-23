// End-to-End: Einladung ohne Verein, "Teilen" am Turnier in turniere.html und die Turnier-Ansicht hinter dem Direktlink.
// Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und Cloud-APIs werden per page.route ersetzt (wie helfer-einladen-ui.spec.js).
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };

const konto = ({ rolle = 'admin', freigegeben = true, vereinId = 7 } = {}) => ({
    id: 'e2e-teilen', email: 'admin@example.test', vorname: 'Ada', nachname: 'Admin',
    verein_id: vereinId, verein_name: vereinId ? 'JC Teilen' : null, verein_freigegeben: freigegeben, verein_rolle: freigegeben ? rolle : null,
    verein_wartet_auf_super_admin: false, ist_super_admin: false,
    vereine: vereinId ? [{ verein_id: vereinId, name: 'JC Teilen', freigegeben, rolle: freigegeben ? rolle : null }] : []
});

const TURNIER = {
    id: 41, bezeichnung: 'Stadtpokal', plz: '12345', ort: 'Musterstadt', datum: '2030-05-01', ausrichter: 'JC Teilen', verein_id: 7,
    status: 'veroeffentlicht', status_effektiv: 'veroeffentlicht', anzahl_kampfflaechen: 2, altersklassen: ['männlich_U15'],
    mannschafts_altersklassen: [], teilnehmer_anzahl: 3, hat_ausschreibung: false, anmeldeschluss: '2030-04-20'
};

async function alsCloudKonto(page, user, turnier = TURNIER) {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user } }));
    await page.route('**/api/vereine/pending', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/vereine/mitglieder**', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/turniere?**', (route) => route.fulfill({ json: [turnier] }));
    await page.route('**/api/turniere', (route) => route.fulfill({ json: [turnier] }));
    await page.route(`**/api/turniere/${turnier.id}`, (route) => route.fulfill({ json: turnier }));
}

test('Einladung ohne Verein: leeres Vereinsfeld sendet ohne vereinId', async ({ page }) => {
    let gesendet = null;
    await alsCloudKonto(page, konto());
    await page.route('**/api/vereine/einladungen**', (route) => {
        if (route.request().method() !== 'POST') return route.fulfill({ json: { success: true, einladungen: [] } });
        gesendet = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, ergebnisse: [{ email: 'neu@extern.de', status: 'gesendet' }, { email: 'da@extern.de', status: 'bereits_konto' }], ungueltig: [] } });
    });
    await page.goto('/admin-einladungen.html');
    await page.locator('#einladungVerein').fill('');
    await expect(page.locator('#einladungOffen')).toContainText('Ohne Verein');
    await page.locator('#einladungAdressen').fill('neu@extern.de, da@extern.de');
    await page.getByRole('button', { name: 'Einladungen senden' }).click();
    await expect(page.locator('#einladungErgebnis')).toContainText('da@extern.de: hat schon ein Konto, keine Mail');
    expect(gesendet).toEqual({ emails: 'neu@extern.de, da@extern.de' });

    // Ein Name, der nicht in der Liste steht, sperrt das Senden
    await page.locator('#einladungVerein').fill('Gibt es nicht');
    await expect(page.getByRole('button', { name: 'Einladungen senden' })).toBeDisabled();
});

test('turniere.html: Teilen-Knopf am Turnier öffnet den Dialog und sendet die Adressen', async ({ page }) => {
    let gesendet = null;
    await alsCloudKonto(page, konto());
    await page.route('**/api/turniere/41/teilen', (route) => {
        gesendet = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, ergebnisse: [{ email: 'frau@extern.de', status: 'gesendet' }], ungueltig: ['kaputt'] } });
    });
    await page.goto('/turniere.html');
    await page.locator('button[data-aktion="teilen"]').click();
    await page.locator('#teilenAdressen').fill('frau@extern.de\nkaputt');
    await page.locator('#teilenSendenBtn').click();
    await expect(page.locator('#teilenErgebnis')).toContainText('frau@extern.de: Mail gesendet');
    await expect(page.locator('#teilenErgebnis')).toContainText('kaputt: keine gültige E-Mail-Adresse');
    expect(gesendet).toEqual({ emails: 'frau@extern.de\nkaputt', vereinIds: [] });
});

test('Teilen-Dialog: Vereine wählen und entfernen, ids gehen mit', async ({ page }) => {
    let gesendet = null;
    await alsCloudKonto(page, konto());
    await page.route('**/api/vereine', (route) => route.fulfill({ json: [{ id: 3, name: 'JC Drei' }, { id: 4, name: 'JC Vier' }] }));
    await page.route('**/api/turniere/41/teilen', (route) => {
        gesendet = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, ergebnisse: [], ungueltig: [], vereinsAdmins: { gesendet: 2, fehler: 0 }, vereineOhneAdmin: ['JC Vier'] } });
    });
    await page.goto('/turniere.html');
    await page.locator('button[data-aktion="teilen"]').click();
    await expect(page.locator('#teilenVereineListe option')).toHaveCount(2, { timeout: 5000 }).catch(() => {});
    await page.locator('#teilenVerein').fill('JC Drei');
    await page.locator('#teilenVerein').fill('JC Vier');
    await expect(page.locator('#teilenVereine button')).toHaveCount(2);
    await page.locator('#teilenVereine button', { hasText: 'JC Vier' }).click();
    await expect(page.locator('#teilenVereine button')).toHaveCount(1);
    await page.locator('#teilenVerein').fill('JC Vier');
    await page.locator('#teilenSendenBtn').click();
    await expect(page.locator('#teilenErgebnis')).toContainText('Vereins-Admins: 2 Mail(s) gesendet');
    await expect(page.locator('#teilenErgebnis')).toContainText('JC Vier: kein Admin mit bestätigter Adresse gefunden');
    expect(gesendet).toEqual({ emails: '', vereinIds: [3, 4] });
});

test('turniere.html: Admin sieht Einladungen oben, nicht doppelt in der Liste', async ({ page }) => {
    const fremd = { ...TURNIER, id: 77, bezeichnung: 'Fremdpokal', verein_id: 99, ausrichter: 'JC Fremd' };
    await alsCloudKonto(page, konto());
    await page.route('**/api/turniere?**', (route) => route.fulfill({ json: [TURNIER, fremd] }));
    await page.route('**/api/turniere', (route) => route.fulfill({ json: [TURNIER, fremd] }));
    await page.route('**/api/turniere/einladungen', (route) => route.fulfill({ json: [{ ...fremd, eingeladene_vereine: ['JC Teilen'] }] }));
    await page.goto('/turniere.html');
    await expect(page.locator('#einladungenTitel')).toContainText('Einladungen (1)');
    await expect(page.locator('#einladungenGrid .tournament-card')).toHaveCount(1);
    await expect(page.locator('#einladungenGrid')).toContainText('Fremdpokal');
    await expect(page.locator('#einladungenGrid')).toContainText('Eingeladen: JC Teilen');
    await expect(page.locator('.tournament-card', { hasText: 'Fremdpokal' })).toHaveCount(1);
});

test('turniere.html: ohne Einladungen gibt es den Bereich nicht', async ({ page }) => {
    await alsCloudKonto(page, konto());
    await page.route('**/api/turniere/einladungen', (route) => route.fulfill({ json: [] }));
    await page.goto('/turniere.html');
    await expect(page.locator('.tournament-card')).toHaveCount(1);
    await expect(page.locator('#einladungenTitel')).toHaveCount(0);
});

test('turniere.html: Entwürfe haben keinen Teilen-Knopf', async ({ page }) => {
    await alsCloudKonto(page, konto(), { ...TURNIER, status: 'entwurf', status_effektiv: 'entwurf' });
    await page.goto('/turniere.html');
    await expect(page.locator('.tournament-card')).toHaveCount(1);
    await expect(page.locator('button[data-aktion="teilen"]')).toHaveCount(0);
});

test('Turnier-Ansicht: freigeschaltetes Mitglied kann Teilnehmer anmelden', async ({ page }) => {
    await alsCloudKonto(page, konto({ rolle: 'benutzer' }));
    await page.goto('/turnier-ansicht.html?id=41');
    await expect(page.locator('#ansichtKarte h1')).toHaveText('Stadtpokal');
    await expect(page.locator('#ansichtInhalt')).toContainText('Musterstadt');
    await expect(page.getByRole('link', { name: 'Teilnehmer anmelden' })).toHaveAttribute('href', '/teilnehmer.html?turnierId=41');
});

test('Turnier-Ansicht: nicht freigeschaltetes Konto sieht nur die Daten', async ({ page }) => {
    await alsCloudKonto(page, konto({ freigegeben: false }));
    await page.goto('/turnier-ansicht.html?id=41');
    await expect(page.locator('#ansichtKarte h1')).toHaveText('Stadtpokal');
    await expect(page.locator('.ansicht-hinweis')).toContainText('noch nicht freigeschaltet');
    await expect(page.getByRole('link', { name: 'Teilnehmer anmelden' })).toHaveCount(0);
});

test('Turnier-Ansicht: Konto ohne Verein sieht die Daten und den Weg zur Vereinswahl', async ({ page }) => {
    await alsCloudKonto(page, konto({ vereinId: null, freigegeben: false }));
    await page.goto('/turnier-ansicht.html?id=41');
    await expect(page.locator('#ansichtKarte h1')).toHaveText('Stadtpokal');
    await expect(page.getByRole('link', { name: 'Verein wählen' })).toBeVisible();
});

test('Anmeldeseite: ?weiter= wird nach dem Login befolgt, fremde Ziele nicht', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/login', (route) => route.fulfill({ json: { success: true, token: 't', user: konto() } }));
    await page.route('**/api/turniere/41', (route) => route.fulfill({ json: TURNIER }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: konto() } }));
    await page.route('**/api/turniere**', (route) => route.fulfill({ json: [TURNIER] }));
    await page.goto('/login.html?weiter=' + encodeURIComponent('/turnier-ansicht.html?id=41'));
    await page.locator('#loginEmail').fill('admin@example.test');
    await page.locator('#loginPassword').fill('passwort-123');
    await page.getByRole('button', { name: 'Einloggen' }).click();
    await page.waitForURL('**/turnier-ansicht.html?id=41');

    await page.evaluate(() => { localStorage.clear(); });
    await page.goto('/login.html?weiter=' + encodeURIComponent('https://boese.example/x.html'));
    expect(await page.evaluate(() => localStorage.getItem('hajime_weiter'))).toBeNull();
});

test('Anmeldeseite: ?registrieren=1&email= öffnet die Registrierung mit vorbelegter Adresse', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.goto('/login.html?registrieren=1&email=neu%40extern.de');
    await expect(page.locator('#registerForm')).toBeVisible();
    await expect(page.locator('#registerEmail')).toHaveValue('neu@extern.de');
});
