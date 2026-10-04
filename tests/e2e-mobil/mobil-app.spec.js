// Android-App (Browser-Laufzeit aus mobil/web) gegen einen echten Hallen-Server: Kopplung, Laden der
// Turnierdaten, Waage ohne Verbindung (Wiegen + Nachmeldung) mit Übertragung nach dem Wiederverbinden,
// Mattenwahl und Kämpfe der Matte aus den lokalen Daten. Die App läuft auf einer eigenen Herkunft
// (http://localhost:3401) — wie die Capacitor-WebView ruft sie den Server (3400) cross-origin auf.
// "Offline" heißt hier: Anfragen an den Hallen-Server werden abgebrochen, die lokal geladene App
// bleibt erreichbar.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { richteDk8TurnierEin, warteLeerlauf } from '../e2e-sync/helpers.js';
import { APP_URL, SERVER_URL, TEST_DOWNLOADS } from './test-env.js';

const { version } = createRequire(import.meta.url)('../../package.json');
const SERVER_MUSTER = `${SERVER_URL}/**`;

async function kopplungscode(request) {
    return (await (await request.get('/api/client/kopplungscode')).json()).code;
}

// Jeder Test hat einen frischen Browser-Kontext (leerer Speicher wie ein neu installiertes Gerät):
// das Gerät wird per Adresse + Code gekoppelt und wartet, bis die Turnierdaten lokal liegen.
async function koppleGeraet(page, request) {
    const code = await kopplungscode(request);
    await page.goto(`${APP_URL}/verbinden.html`);
    await page.locator('#serverEingabe').fill('localhost:3400');
    await page.locator('#codeEingabe').fill(code);
    await page.locator('#koppelnBtn').click();
    await expect(page).toHaveURL(`${APP_URL}/client.html`, { timeout: 60_000 });
    await expect(page.locator('#clientTurnier')).toContainText('Mobil App Cup');
}

async function appStatus(page) {
    return page.evaluate(() => fetch('/api/sync/status').then(r => r.json()));
}

async function warteBisSynchron(page) {
    await expect.poll(async () => {
        const s = await appStatus(page);
        return s.verbunden && s.ausstehend === 0 && !!s.instanz_id;
    }, { timeout: 30_000 }).toBe(true);
}

test.describe.serial('Android-App', () => {
    let turnier;

    test('ohne Kopplung führt jede App-Seite zur Kopplung', async ({ page }) => {
        for (const seite of ['/', '/client.html', '/teilnehmer.html', '/steuerung.html']) {
            await page.goto(`${APP_URL}${seite}`);
            await expect(page).toHaveURL(`${APP_URL}/verbinden.html`);
        }
        await expect(page.locator('#koppelnBtn')).toBeVisible();
    });

    test('Kopplung: falscher Code wird abgewiesen, richtiger lädt die Turnierdaten', async ({ page, request }) => {
        test.setTimeout(90_000);
        turnier = await richteDk8TurnierEin(request, 'Mobil App Cup');
        const code = await kopplungscode(request);
        const falsch = code === '000000' ? '111111' : '000000';

        await page.goto(`${APP_URL}/verbinden.html`);
        await page.locator('#serverEingabe').fill('localhost:3400');
        await page.locator('#codeEingabe').fill(falsch);
        await page.locator('#koppelnBtn').click();
        await expect(page.locator('#meldung')).toHaveText('Code falsch.');

        await page.locator('#codeEingabe').fill(`${code.slice(0, 3)} ${code.slice(3)}`);
        await page.locator('#koppelnBtn').click();
        await expect(page).toHaveURL(`${APP_URL}/client.html`, { timeout: 60_000 });
        await expect(page.locator('#clientTurnier')).toContainText('Mobil App Cup');
        await expect(page.locator('#clientMatteSelect option')).toHaveCount(2); // Platzhalter + Matte 1

        const status = await appStatus(page);
        expect(status).toMatchObject({ rolle: 'client', app: true, app_version: version, server_url: SERVER_URL });
        const server = await (await page.request.get(`${SERVER_URL}/api/sync/status`)).json();
        expect(status.instanz_id).toBe(server.instanz_id);
        await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'verbunden');
    });

    test('Waage ohne Verbindung: 5 Wiegungen und 1 Nachmeldung, danach vollständig am Server', async ({ page, request }) => {
        test.setTimeout(150_000);
        // Als ausrichtender Verein verlangt das Formular Judopass und gültige Lizenz.
        for (const [i, id] of turnier.teilnehmerIds.entries()) {
            const r = await request.put(`/api/teilnehmer/${id}`, { data: { judopass_id: `MA-${i}`, lizenz_ablauf: '2030-12-31' } });
            expect(r.ok(), await r.text()).toBeTruthy();
        }
        await warteLeerlauf(request);
        await koppleGeraet(page, request);

        // Online laden, bis die Teilnehmerdaten (mit Judopass) lokal liegen.
        await page.goto(`${APP_URL}/teilnehmer.html?turnierId=${turnier.turnierId}`);
        await page.waitForFunction(() => typeof window.oeffneWaageModal === 'function' && !!window.Datenzugriff);
        await expect.poll(async () => page.evaluate(async (id) => {
            const liste = await fetch(`/api/teilnehmer?turnierId=${id}`).then(r => r.json());
            return liste.filter(t => t.judopass_id).length;
        }, turnier.turnierId), { timeout: 30_000 }).toBe(8);
        await warteBisSynchron(page);

        // Verbindung zum Hallen-Server kappen und die Seite neu laden: die App startet aus den lokalen Daten.
        await page.context().route(SERVER_MUSTER, route => route.abort('connectionrefused'));
        await page.goto(`${APP_URL}/teilnehmer.html?turnierId=${turnier.turnierId}`);
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => typeof window.oeffneWaageModal === 'function' && !!window.Datenzugriff);
        await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'offline', { timeout: 15_000 });

        // 1 Wiegung über das Formular (Teilnehmer aus den lokalen Daten).
        await page.evaluate((id) => window.oeffneWaageModal(id), turnier.teilnehmerIds[0]);
        await expect(page.locator('#vorname')).toHaveValue('Anna');
        await page.locator('#gewicht').fill('59,10');
        await expect(page.locator('#submitBtn')).toBeEnabled();
        await page.locator('#submitBtn').click();
        await page.getByRole('button', { name: 'Ja', exact: true }).click({ timeout: 3000 }).catch(() => {});
        await expect(page.locator('#snackbarText')).toContainText('Lokal gespeichert');

        // 4 weitere Wiegungen und 1 Nachmeldung.
        const ergebnisse = await page.evaluate(async ({ ids, turnierId }) => {
            const r = [];
            for (let i = 1; i <= 4; i++) {
                r.push(await window.Datenzugriff.speichereTeilnehmer(ids[i], { gewicht: 70 + i, gewogen: true }));
            }
            r.push(await window.Datenzugriff.speichereTeilnehmer(null, {
                turnier_id: turnierId, vorname: 'Nora', nachname: 'Nachzügler', verein: 'JC Spät', judopass_id: 'NZ-1',
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 72.3, altersklasse: 'U18', gewichtsklasse: '-73kg', gewogen: true
            }));
            return r;
        }, { ids: turnier.teilnehmerIds, turnierId: turnier.turnierId });
        expect(ergebnisse.every(e => e.ok && e.ausstehend)).toBe(true);
        expect((await appStatus(page)).ausstehend).toBe(6);
        await expect(page.locator('#syncStatusLeiste')).toContainText('6 Änderungen ausstehend');
        // Am Server ist noch nichts angekommen.
        const vorher = await (await request.get(`/api/teilnehmer?turnierId=${turnier.turnierId}`)).json();
        expect(vorher.filter(t => t.judopass_id === 'NZ-1')).toHaveLength(0);

        // Wieder im WLAN: alles wird übertragen.
        await page.context().unroute(SERVER_MUSTER);
        await warteBisSynchron(page);
        await expect.poll(async () => {
            const liste = await (await request.get(`/api/teilnehmer?turnierId=${turnier.turnierId}`)).json();
            return liste.filter(t => t.judopass_id === 'NZ-1').length;
        }, { timeout: 30_000 }).toBe(1);
        await warteLeerlauf(request);

        const liste = await (await request.get(`/api/teilnehmer?turnierId=${turnier.turnierId}`)).json();
        const gewichtVon = (id) => parseFloat(liste.find(t => t.id === id).gewicht);
        expect(gewichtVon(turnier.teilnehmerIds[0])).toBe(59.1);
        for (let i = 1; i <= 4; i++) expect(gewichtVon(turnier.teilnehmerIds[i])).toBe(70 + i);
        const nachmeldung = liste.filter(t => t.judopass_id === 'NZ-1');
        expect(nachmeldung).toHaveLength(1);
        expect(parseFloat(nachmeldung[0].gewicht)).toBe(72.3);
        await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'verbunden', { timeout: 15_000 });
    });

    test('Tablet an der Matte: Matte wählen, Kämpfe der Matte und Scoreboard aus den lokalen Daten', async ({ page, request }) => {
        test.setTimeout(90_000);
        await koppleGeraet(page, request);
        await page.locator('#clientMatteSelect').selectOption(String(turnier.matId));
        await expect.poll(async () => page.evaluate(() => fetch('/api/sync/client/matte').then(r => r.json())))
            .toEqual({ matte_id: turnier.matId });
        await expect(page.locator('#linkScoreboard')).toHaveAttribute('href', new RegExp(`matId=${turnier.matId}`));

        // Offline: die Kämpfe der Matte (DK8-Pool, 11 Kämpfe) kommen aus der lokalen Datenbank.
        await warteBisSynchron(page);
        await page.context().route(SERVER_MUSTER, route => route.abort('connectionrefused'));
        await page.goto(`${APP_URL}/steuerung.html?turnierId=${turnier.turnierId}&matId=${turnier.matId}`);
        await page.waitForLoadState('networkidle');
        const kaempfe = await page.evaluate((matId) => fetch(`/api/kaempfe?kampfflaecheId=${matId}`).then(r => r.json()), turnier.matId);
        expect(kaempfe.length).toBe(11);
        // Die Mattenwahl überlebt den Neustart der App-Seite.
        expect(await page.evaluate(() => fetch('/api/sync/client/matte').then(r => r.json()))).toEqual({ matte_id: turnier.matId });
        await page.context().unroute(SERVER_MUSTER);
    });

    test('Hallen-Server: client-konfig.html zeigt den Kopplungs-QR-Code mit LAN-Adresse', async ({ page, request }) => {
        await page.goto('/client-konfig.html');
        await expect(page.locator('#kopplungKarte')).toBeVisible();
        await expect(page.locator('#kopplungQr svg')).toBeVisible();
        await expect(page.locator('#kopplungQrAdresse')).toHaveText(/^http:\/\/\d+\.\d+\.\d+\.\d+:3400$/);
        const { urls } = await (await request.get('/api/client/kopplungscode')).json();
        expect(urls.length).toBeGreaterThan(0);
    });

    test('Download-Seite: Android bekommt die APK mit Kopplungscode, iPhone einen Hinweis', async ({ browser }) => {
        const ordner = path.join(TEST_DOWNLOADS, version);
        mkdirSync(ordner, { recursive: true });
        const apk = { datei: `Hajime-Pro-${version}.apk`, sha256: 'x', signatur: 'y' };
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: { android: { installieren: apk } } }));
        writeFileSync(path.join(ordner, apk.datei), 'APK');

        const android = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' });
        const seite = await android.newPage();
        await seite.goto(`${SERVER_URL}/download#code=123456`);
        await expect(seite.locator('#downloadHauptlink')).toHaveAttribute('href', `/downloads/${version}/${apk.datei}`);
        await expect(seite.locator('#downloadAnleitung')).toContainText('123 456');
        await android.close();

        const iphone = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
        const iseite = await iphone.newPage();
        await iseite.goto(`${SERVER_URL}/download`);
        await expect(iseite.locator('#downloadHinweis')).toContainText('iPhone und iPad');
        await expect(iseite.locator('#downloadHauptlink')).toHaveCount(0);
        await iphone.close();
    });
});
