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
import crypto from 'crypto';
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

// "Offline Club" legt erst der requireAuth-Bootstrap beim ersten angemeldeten Aufruf an (die Vereinsliste ist
// öffentlich und löst ihn nicht aus).
async function stelleOfflineClubSicher(request) {
    expect((await request.get('/api/auth/me')).ok()).toBeTruthy();
}

async function oeffneRegisterTab(page) {
    await page.goto('/login.html');
    await page.locator('#tabRegister').click();
    await expect(page.locator('#registerForm')).toBeVisible();
}

// Der Bestätigungslink steht nur in der Mail (ohne SMTP nur im Server-Log); in der DB liegt allein der
// SHA-256 des Tokens. Der Test ersetzt deshalb den Hash des offenen Bestätigungs-Tokens durch den eines
// bekannten Tokens — Verein und Quelle der Registrierung bleiben an der echten Token-Zeile.
async function setzeBekanntenBestaetigungsToken(email) {
    const token = crypto.randomBytes(24).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const geaendert = await mitTestDb(async (db) => {
        const konto = await db('benutzer').where({ email }).first();
        return db('token_einmal')
            .where({ benutzer_id: konto.id, zweck: 'email' })
            .whereNull('benutzt_am')
            .update({ token_hash: hash });
    });
    expect(geaendert, 'genau ein offener Bestätigungs-Token').toBe(1);
    return token;
}

test('Registrierung legt ein unbestätigtes Konto an und zeigt den Hinweis auf die Bestätigungsmail', async ({ page }) => {
    await oeffneRegisterTab(page);

    await page.locator('#registerVorname').fill('Erika');
    await page.locator('#registerNachname').fill('Mustermann');
    await page.locator('#registerEmail').fill(TEST_EMAIL.toUpperCase());
    await page.locator('#registerPassword').fill(TEST_PASSWORD);
    await page.locator('#registerForm button[type="submit"]').click();

    // Kein Token, keine Weiterleitung: das Konto ist erst nach der E-Mail-Bestätigung nutzbar.
    await expect(page.locator('#infoMessage')).toHaveText('Wir haben dir eine E-Mail geschickt. Bitte bestätige deine Adresse über den Link.');
    await expect(page.locator('#bestaetigungErneut')).toBeVisible();
    await expect(page).toHaveURL(/\/login\.html$/);
    expect(await page.evaluate(() => localStorage.getItem('dokume_token'))).toBeNull();

    const konto = await mitTestDb((db) => db('benutzer').where({ email: TEST_EMAIL }).first());
    expect(konto, 'E-Mail wird kleingeschrieben gespeichert').toBeTruthy();
    expect(konto.email_bestaetigt_am).toBeNull();
    expect(await mitTestDb((db) => db('benutzer_vereine').where({ benutzer_id: konto.id }).first())).toBeUndefined();

    // Bestätigungsmail erneut anfordern: gleiche Antwort wie für unbekannte Adressen.
    await page.locator('#bestaetigungErneut').click();
    await expect(page.locator('#infoMessage')).toContainText('Falls zu dieser Adresse ein unbestätigtes Konto gehört');
});

test('Login vor der E-Mail-Bestätigung wird mit Hinweis abgewiesen', async ({ page, request }) => {
    const resp = await request.post('/api/auth/login', { data: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    expect(resp.status()).toBe(403);
    expect(await resp.json()).toMatchObject({ success: false, code: 'email_unbestaetigt' });

    await page.goto('/login.html');
    await page.locator('#loginEmail').fill(TEST_EMAIL);
    await page.locator('#loginPassword').fill(TEST_PASSWORD);
    await page.locator('#loginForm button[type="submit"]').click();
    await expect(page.locator('#infoMessage')).toHaveText('Bitte bestätige zuerst deine E-Mail-Adresse.');
    await expect(page.locator('#bestaetigungErneut')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dokume_token'))).toBeNull();
});

test('Registrierung: Verein per Autovervollständigung wählen, Freitext wird nicht übernommen', async ({ page }) => {
    const email = `registrierung-auswahl-${Date.now()}@example.test`;
    await stelleOfflineClubSicher(page.request);
    await oeffneRegisterTab(page);
    await page.locator('#registerVorname').fill('Vera');
    await page.locator('#registerNachname').fill('Auswahl');
    await page.locator('#registerEmail').fill(email);
    await page.locator('#registerPassword').fill(TEST_PASSWORD);

    // Ein Zeichen: noch keine Vorschläge
    const feld = page.locator('#registerVerein');
    await feld.fill('O');
    await expect(page.locator('#registerVereinListe')).toBeHidden();

    // Freitext ohne Auswahl: Registrieren mit Verein ist nicht möglich
    await feld.fill('Offline Cl');
    await expect(page.locator('#registerVereinListe [role="option"]', { hasText: 'Offline Club' })).toBeVisible();
    await page.locator('#registerVorname').click();
    await page.locator('#registerForm button[type="submit"]').click();
    await expect(page.locator('#errorMessage')).toHaveText('Bitte wähle einen Verein aus der Liste oder lass das Feld leer.');
    expect(await mitTestDb((db) => db('benutzer').where({ email }).first())).toBeUndefined();

    // Auswahl per Pfeiltaste und Enter
    await feld.fill('ffline');
    const option = page.locator('#registerVereinListe [role="option"]', { hasText: 'Offline Club' });
    await expect(option).toBeVisible();
    const index = await page.locator('#registerVereinListe [role="option"]').evaluateAll(
        (els) => els.findIndex(el => el.textContent === 'Offline Club'));
    for (let i = 0; i <= index; i++) await feld.press('ArrowDown');
    await feld.press('Enter');
    await expect(feld).toHaveValue('Offline Club');
    await expect(page.locator('#registerVereinListe')).toBeHidden();

    let gesendet = null;
    page.on('request', (req) => {
        if (req.url().endsWith('/api/auth/register')) gesendet = req.postDataJSON();
    });
    await page.locator('#registerForm button[type="submit"]').click();
    await expect(page.locator('#infoMessage')).toHaveText('Wir haben dir eine E-Mail geschickt. Bitte bestätige deine Adresse über den Link.');
    await expect(page.locator('#bestaetigungErneut')).toBeVisible();

    const vereinId = await mitTestDb(async (db) => (await db('vereine').where({ name: 'Offline Club' }).first()).id);
    expect(gesendet).toMatchObject({ vereinId, quelle: 'verwaltung', email });
    // Der Verein hängt am Bestätigungs-Token, die Mitgliedschaft entsteht erst nach der Bestätigung.
    const token = await mitTestDb(async (db) => {
        const konto = await db('benutzer').where({ email }).first();
        return db('token_einmal').where({ benutzer_id: konto.id, zweck: 'email' }).first();
    });
    expect(token).toMatchObject({ verein_id: vereinId, angefragt_ueber: 'verwaltung' });
});

test('Registrierung: Verein per Klick wählen und wieder leeren registriert ohne Verein', async ({ page }) => {
    const email = `registrierung-ohne-${Date.now()}@example.test`;
    await stelleOfflineClubSicher(page.request);
    await oeffneRegisterTab(page);
    await page.locator('#registerVorname').fill('Otto');
    await page.locator('#registerNachname').fill('Ohne');
    await page.locator('#registerEmail').fill(email);
    await page.locator('#registerPassword').fill(TEST_PASSWORD);

    const feld = page.locator('#registerVerein');
    await feld.fill('offline');
    await page.locator('#registerVereinListe [role="option"]', { hasText: 'Offline Club' }).click();
    await expect(feld).toHaveValue('Offline Club');
    await feld.fill('');

    await page.locator('#registerForm button[type="submit"]').click();
    await expect(page.locator('#infoMessage')).toHaveText('Wir haben dir eine E-Mail geschickt. Bitte bestätige deine Adresse über den Link.');
    const token = await mitTestDb(async (db) => {
        const konto = await db('benutzer').where({ email }).first();
        return db('token_einmal').where({ benutzer_id: konto.id, zweck: 'email' }).first();
    });
    expect(token.verein_id).toBeNull();
});

test('Bestätigungsseite bestätigt erst per Knopf, ein zweiter Klick auf denselben Link schlägt fehl', async ({ page }) => {
    const token = await setzeBekanntenBestaetigungsToken(TEST_EMAIL);

    await page.goto(`/bestaetigen.html?token=${token}`);
    // Ein bloßer Aufruf (z.B. durch einen Mail-Scanner) ändert nichts.
    await expect(page.locator('#bestaetigenKnopf')).toBeVisible();
    expect((await mitTestDb((db) => db('benutzer').where({ email: TEST_EMAIL }).first())).email_bestaetigt_am).toBeNull();

    await page.locator('#bestaetigenKnopf').click();
    // Ohne Vereinswahl (Altfluss) ist das Konto danach nutzbar; der Beitritt folgt über die Vereinsauswahl.
    await expect(page.locator('#bestaetigtMeldung')).toHaveText('Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.');
    expect((await mitTestDb((db) => db('benutzer').where({ email: TEST_EMAIL }).first())).email_bestaetigt_am).not.toBeNull();

    await page.goto(`/bestaetigen.html?token=${token}`);
    await page.locator('#bestaetigenKnopf').click();
    await expect(page.locator('#errorMessage')).toContainText('ungültig, abgelaufen oder wurde bereits verwendet');
});

test('Registrierung mit bereits verwendeter E-Mail-Adresse schlägt fehl', async ({ page }) => {
    await oeffneRegisterTab(page);

    // Dieselbe (inzwischen bestätigte) E-Mail wie oben, hier in anderer Schreibweise — die Test-DB wird
    // nur einmal pro gesamtem Testlauf zurückgesetzt, der Konflikt ist also serverseitig garantiert echt.
    await page.locator('#registerVorname').fill('Zweiter');
    await page.locator('#registerNachname').fill('Versuch');
    await page.locator('#registerEmail').fill(TEST_EMAIL.replace('registrierung', 'Registrierung'));
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
    expect(user).toMatchObject({ vorname: 'Erika', nachname: 'Mustermann', email: TEST_EMAIL, verein_id: null, verein_freigegeben: false });
});

test('Registrierung mit Verein legt die Beitrittsanfrage erst nach der Bestätigung an', async ({ request }) => {
    const email = `registrierung-verein-${Date.now()}@example.test`;
    await stelleOfflineClubSicher(request);
    const vereinId = await mitTestDb(async (db) => (await db('vereine').where({ name: 'Offline Club' }).first()).id);

    const unbekannt = await request.post('/api/auth/register', {
        data: { email, password: TEST_PASSWORD, vorname: 'Vera', nachname: 'Verein', vereinId: 99999999 }
    });
    expect(unbekannt.status()).toBe(400);

    const kurz = await request.post('/api/auth/register', {
        data: { email, password: '1234567', vorname: 'Vera', nachname: 'Verein', vereinId }
    });
    expect(kurz.status()).toBe(400);

    const reg = await request.post('/api/auth/register', {
        data: { email, password: TEST_PASSWORD, vorname: 'Vera', nachname: 'Verein', vereinId, quelle: 'helfer-app' }
    });
    expect(reg.status()).toBe(201);
    const regBody = await reg.json();
    expect(regBody).toMatchObject({ success: true, bestaetigungAusstehend: true });
    expect(regBody.token).toBeUndefined();

    const konto = await mitTestDb((db) => db('benutzer').where({ email }).first());
    expect(await mitTestDb((db) => db('benutzer_vereine').where({ benutzer_id: konto.id }).first())).toBeUndefined();

    const token = await setzeBekanntenBestaetigungsToken(email);
    const best = await request.post('/api/auth/email-bestaetigen', { data: { token } });
    expect(best.ok()).toBeTruthy();
    expect(await best.json()).toMatchObject({ success: true, vereinId, message: 'Deine Registrierung muss noch freigeschaltet werden.' });

    const mitgliedschaft = await mitTestDb((db) => db('benutzer_vereine').where({ benutzer_id: konto.id, verein_id: vereinId }).first());
    expect(mitgliedschaft).toMatchObject({ freigegeben: 0, rolle: null, angefragt_ueber: 'helfer-app' });
    const freischaltung = await mitTestDb((db) => db('token_einmal').where({ benutzer_id: konto.id, zweck: 'freischaltung' }).first());
    expect(freischaltung).toMatchObject({ verein_id: vereinId, benutzt_am: null });

    // Erneut anfordern verrät nicht, ob die Adresse existiert.
    for (const adresse of [email, `gibt-es-nicht-${Date.now()}@example.test`]) {
        const erneut = await request.post('/api/auth/email-bestaetigung-erneut', { data: { email: adresse } });
        expect(erneut.status()).toBe(200);
    }
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
    // der freigegebener Admin von "Offline Club" ist und damit Genehmigungsrechte hat.
    const pendingResp = await request.get('/api/vereine/pending');
    expect(pendingResp.ok()).toBeTruthy();
    const pending = await pendingResp.json();
    expect(pending).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: bewerberId, verein_id: offlineClubId, verein_name: 'Offline Club' })
    ]));

    // Ohne Rolle wird nicht freigegeben (Helferverwaltung: Freigabe nur mit Rollenwahl).
    const ohneRolle = await request.post('/api/vereine/approve', {
        data: { userId: bewerberId, vereinId: offlineClubId }
    });
    expect(ohneRolle.status()).toBe(400);

    const approveResp = await request.post('/api/vereine/approve', {
        data: { userId: bewerberId, vereinId: offlineClubId, rolle: 'benutzer' }
    });
    expect(approveResp.ok()).toBeTruthy();

    const mitgliedschaft = await mitTestDb((db) =>
        db('benutzer_vereine').where({ benutzer_id: bewerberId, verein_id: offlineClubId }).first());
    expect(!!mitgliedschaft.freigegeben).toBe(true);
    expect(mitgliedschaft.rolle).toBe('benutzer');
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
        // Ohne Rollenangabe wird die erste Person eines Vereins ohne Admin dessen Admin.
        const rolle = await mitTestDb(async (db) =>
            (await db('benutzer_vereine').where({ benutzer_id: 'offline_user', verein_id: vereinId }).first()).rolle);
        expect(rolle).toBe('admin');
    } finally {
        // Zurücksetzen, damit spätere Tests wieder mit einem normalen offline_user laufen — die
        // gesamte Suite teilt sich dieselbe Test-DB und denselben Server-Prozess (workers: 1).
        await mitTestDb((db) => db('benutzer').where({ id: 'offline_user' }).update({ ist_super_admin: false }));
    }
});

test('Auth-Endpunkte lehnen übergroße Anfragen ab (413)', async ({ request }) => {
    const gross = await request.post('/api/auth/login', { data: { email: 'x@example.test', password: 'p'.repeat(20 * 1024) } });
    expect(gross.status()).toBe(413);
    const normal = await request.post('/api/auth/login', { data: { email: 'x@example.test', password: 'falsch12345' } });
    expect(normal.status()).toBe(401);
});
