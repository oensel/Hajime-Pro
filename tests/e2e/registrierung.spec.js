// End-to-End: Registrierung eines neuen Benutzers über login.html (Tab "Konto erstellen"), der
// anschließende Login mit denselben Zugangsdaten, sowie der Vereinsbeitritt inkl. Genehmigungs-
// Warteschlangen (siehe vereinController.js).
//
// Im Offline-Modus ist KEINE Autorisierung nötig: requireAuth (siehe src/middleware/auth.js)
// prüft im Offline-Modus gar keinen Authorization-Header, sondern setzt req.user vorab immer
// fest auf den einen "offline_user" — jede Anfrage an /api/vereine/* funktioniert also ganz ohne
// Token. Das bedeutet aber auch: es gibt in dieser Suite immer nur EINE handelnde Identität, man
// kann also nicht "als zwei verschiedene echte Personen" einloggen, um z.B. zu prüfen, dass ein
// Vereinsmitglied den Beitritt eines ANDEREN Nutzers sieht. Für solche Zwei-Rollen-Szenarien wird
// die "andere Seite" (Antragsteller bzw. Super-Admin-Rolle) direkt in der Test-PostgreSQL-Datenbank
// vorbereitet (siehe mitTestDb unten) — die eigentliche Aktion läuft dann ganz normal per HTTP.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';


// Öffnet eine eigene, kurzlebige Verbindung zur selben Test-PostgreSQL-Datenbank, die auch der laufende
// Testserver verwendet (siehe tests/helpers/pg-dienst.mjs) — für Fixtures, die über die HTTP-API allein nicht
// erreichbar sind (siehe Datei-Kommentar oben).
async function mitTestDb(fn) {
    const db = knexLib({
        client: 'pg',
        connection: testDbVerbindung,
        pool: { min: 0, max: 2 }
    });
    try {
        return await fn(db);
    } finally {
        await db.destroy();
    }
}

// Eindeutig pro Testlauf, damit die Suite wiederholt gegen dieselbe (nicht pro Datei
// zurückgesetzte) Test-DB laufen kann, ohne mit vorherigen Läufen zu kollidieren.
const TEST_EMAIL = `registrierung-e2e-${Date.now()}@example.test`;
const TEST_PASSWORD = 'test1234';

async function oeffneRegisterTab(page) {
    await page.goto('/login.html');
    await page.locator('#tabRegister').click();
    await expect(page.locator('#registerForm')).toBeVisible();
}

test('Registrierung mit neuen Zugangsdaten legt das Konto an und leitet zur Vereinsauswahl weiter', async ({ page }) => {
    await oeffneRegisterTab(page);

    await page.locator('#registerVorname').fill('Erika');
    await page.locator('#registerNachname').fill('Mustermann');
    await page.locator('#registerEmail').fill(TEST_EMAIL);
    await page.locator('#registerPassword').fill(TEST_PASSWORD);
    await page.locator('#registerForm button[type="submit"]').click();

    // Ein frisch registriertes Konto hat noch keinen Verein (verein_id: null, siehe
    // authController.js#register) — handleAuthSuccess in login.html leitet deshalb IMMER auf die
    // Vereinsauswahl weiter, nie direkt auf turniere.html.
    await expect(page).toHaveURL(/\/verein_auswahl\.html$/);

    const token = await page.evaluate(() => localStorage.getItem('dokume_token'));
    expect(token, 'JWT-Token muss nach erfolgreicher Registrierung im localStorage liegen').toBeTruthy();

    const user = await page.evaluate(() => JSON.parse(localStorage.getItem('dokume_user')));
    expect(user).toMatchObject({
        vorname: 'Erika',
        nachname: 'Mustermann',
        email: TEST_EMAIL,
        verein_id: null,
        verein_freigegeben: false
    });
});

test('Registrierung mit bereits verwendeter E-Mail-Adresse schlägt fehl', async ({ page }) => {
    await oeffneRegisterTab(page);

    // Dieselbe E-Mail wie im vorherigen Test — die Test-DB wird nur einmal pro gesamtem Testlauf
    // zurückgesetzt (siehe global-setup.js), der Konflikt ist also serverseitig garantiert echt.
    await page.locator('#registerVorname').fill('Zweiter');
    await page.locator('#registerNachname').fill('Versuch');
    await page.locator('#registerEmail').fill(TEST_EMAIL);
    await page.locator('#registerPassword').fill(TEST_PASSWORD);
    await page.locator('#registerForm button[type="submit"]').click();

    await expect(page.locator('#errorMessage')).toHaveText('Diese E-Mail-Adresse ist bereits registriert.');
    // Kein Redirect bei Fehlschlag -> weiterhin auf login.html
    await expect(page).toHaveURL(/\/login\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('dokume_token'))).toBeNull();
});

test('Login mit den gerade registrierten Zugangsdaten führt zur Vereinsauswahl', async ({ page }) => {
    await page.goto('/login.html');
    // Tab "Anmelden" ist der Standard-Tab, kein Klick nötig.
    await expect(page.locator('#loginForm')).toBeVisible();

    await page.locator('#loginEmail').fill(TEST_EMAIL);
    await page.locator('#loginPassword').fill(TEST_PASSWORD);
    await page.locator('#loginForm button[type="submit"]').click();

    await expect(page).toHaveURL(/\/verein_auswahl\.html$/);

    const user = await page.evaluate(() => JSON.parse(localStorage.getItem('dokume_user')));
    expect(user).toMatchObject({ email: TEST_EMAIL, verein_id: null });
});

test('Login mit falschem Passwort zeigt eine Fehlermeldung', async ({ page }) => {
    await page.goto('/login.html');

    await page.locator('#loginEmail').fill(TEST_EMAIL);
    await page.locator('#loginPassword').fill('ein-falsches-passwort');
    await page.locator('#loginForm button[type="submit"]').click();

    await expect(page.locator('#errorMessage')).toHaveText('Ungültige Anmeldedaten.');
    await expect(page).toHaveURL(/\/login\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('dokume_token'))).toBeNull();
});

test('Registrierung ohne Pflichtfelder wird auch serverseitig abgelehnt', async ({ request }) => {
    // Ergänzt die client-seitige HTML5-"required"-Prüfung (die ein leeres Absenden im Browser gar
    // nicht erst zulässt) um einen direkten Check der Server-Validierung in authController.js.
    const response = await request.post('/api/auth/register', {
        data: { email: `unvollstaendig-${Date.now()}@example.test`, password: TEST_PASSWORD }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
        success: false,
        error: 'E-Mail, Passwort, Vorname und Nachname sind erforderlich.'
    });
});

test('Beitritt zu einem Verein mit bereits freigegebenem Mitglied landet in dessen Warteschlange und lässt sich ohne jeden Auth-Header freigeben', async ({ request }) => {
    const bewerberId = `e2e-peer-bewerber-${Date.now()}`;

    // Antragsteller-Seite direkt in der DB anlegen (siehe Datei-Kommentar) — "Offline Club" ist
    // der Verein, in dem offline_user selbst schon freigegebenes Mitglied ist (siehe requireAuth-
    // Bootstrap), also der geeignete Fixture-Verein für den Peer-Genehmigungs-Pfad.
    const offlineClubId = await mitTestDb(async (db) => {
        const club = await db('vereine').where({ name: 'Offline Club' }).first();
        await db('benutzer').insert({ id: bewerberId, email: `${bewerberId}@example.test`, vorname: 'Peer', nachname: 'Bewerber' });
        await db('benutzer_vereine').insert({ benutzer_id: bewerberId, verein_id: club.id, freigegeben: 0 });
        return club.id;
    });

    // Kein Authorization-Header nötig (siehe Datei-Kommentar) — die Anfrage läuft als offline_user,
    // der bereits freigegebenes Mitglied von "Offline Club" ist und damit Genehmigungsrechte hat.
    const pendingResp = await request.get('/api/vereine/pending');
    expect(pendingResp.ok()).toBeTruthy();
    const pending = await pendingResp.json();
    expect(pending).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bewerberId, verein_id: offlineClubId, verein_name: 'Offline Club' })
    ]));

    const approveResp = await request.post('/api/vereine/approve', {
        data: { userId: bewerberId, vereinId: offlineClubId }
    });
    expect(approveResp.ok()).toBeTruthy();

    const istFreigegeben = await mitTestDb(async (db) => {
        const row = await db('benutzer_vereine').where({ benutzer_id: bewerberId, verein_id: offlineClubId }).first();
        return !!row.freigegeben;
    });
    expect(istFreigegeben).toBe(true);
});

test('Beitritt zu einem brandneuen Verein wartet auf den Super-Admin statt auf ein Vereinsmitglied', async ({ request }) => {
    const neuerVereinName = `E2E-Erstregistrierung-${Date.now()}`;

    const joinResp = await request.post('/api/vereine/join', { data: { newVereinName: neuerVereinName } });
    expect(joinResp.ok()).toBeTruthy();
    const joinBody = await joinResp.json();
    expect(joinBody.verein_freigegeben).toBe(false);

    // Kein bestehendes freigegebenes Mitglied kann diese Erstregistrierung sehen — auch nicht
    // offline_user selbst, obwohl er der Antragsteller ist (siehe ladeVerwalteteVereinIds:
    // maßgeblich ist die EIGENE Freigabe im Ziel-Verein, die hier noch fehlt).
    const pendingResp = await request.get('/api/vereine/pending');
    const pending = await pendingResp.json();
    expect(pending.find(p => p.verein_name === neuerVereinName)).toBeUndefined();

    // "Keine Autorisierung nötig" gilt für requireAuth (Identität), NICHT für requireSuperAdmin
    // (Rolle) — die Erstregistrierungs-Warteschlange bleibt für gewöhnliche Nutzer verschlossen.
    const superPendingResp = await request.get('/api/vereine/super/pending');
    expect(superPendingResp.status()).toBe(403);
});

test('Super-Admin sieht eine Erstregistrierung in der Warteschlange und kann sie freigeben', async ({ request }) => {
    const neuerVereinName = `E2E-Super-Admin-Freigabe-${Date.now()}`;

    const joinResp = await request.post('/api/vereine/join', { data: { newVereinName: neuerVereinName } });
    const { verein_id: vereinId } = await joinResp.json();

    // offline_user ist im Offline-Modus die einzige Identität (siehe Datei-Kommentar) — um den
    // Super-Admin-Pfad zu testen, wird die Rolle direkt in der Test-DB gesetzt statt über einen
    // (im Offline-Modus ohnehin wirkungslosen) Login als ein anderer Benutzer.
    await mitTestDb((db) => db('benutzer').where({ id: 'offline_user' }).update({ ist_super_admin: true }));

    try {
        const pendingResp = await request.get('/api/vereine/super/pending');
        expect(pendingResp.ok()).toBeTruthy();
        const pending = await pendingResp.json();
        expect(pending).toEqual(expect.arrayContaining([
            expect.objectContaining({ verein_id: vereinId, verein_name: neuerVereinName })
        ]));

        const approveResp = await request.post('/api/vereine/super/approve', {
            data: { userId: 'offline_user', vereinId }
        });
        expect(approveResp.ok()).toBeTruthy();
    } finally {
        // Zurücksetzen, damit spätere Tests wieder mit einem normalen offline_user laufen — die
        // gesamte Suite teilt sich dieselbe Test-DB und denselben Server-Prozess (workers: 1).
        await mitTestDb((db) => db('benutzer').where({ id: 'offline_user' }).update({ ist_super_admin: false }));
    }
});
