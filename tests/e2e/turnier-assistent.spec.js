// End-to-End: Assistent in turnier.html (vier Seiten, Fragen zur Ausstattung, Funktionen je Turnier).
// Hallen-Server ohne Anmeldung (Einzelbenutzer). Die Antworten schalten Funktionen frei, ausgeschaltete verlieren ihre Menüpunkte.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const antwort = (page, frage, wert) => page.locator(`button[data-frage="${frage}"][data-antwort="${wert}"]`).click();
const schalter = (page, id) => page.locator(`#${id}`);

async function grunddatenEintragen(page, name, datum) {
    await page.locator('#bezeichnung').fill(name);
    await page.locator('#datum').fill(datum);
    await page.locator('#ort').fill('Senden');
    await page.locator('#ausrichter').fill('JC Assistent');
}

test('Weiter ohne Pflichtfelder bleibt auf Seite 1, mit Pflichtfeldern führt der Assistent durch alle vier Seiten', async ({ page }) => {
    await page.goto('/turnier.html');
    await expect(page.locator('.assistent-schritt')).toHaveCount(4);
    await expect(page.locator('.assistent-seite:not([hidden])')).toHaveAttribute('data-seite', '1');

    await page.locator('#assistentWeiter').click();
    await expect(page.locator('.assistent-seite:not([hidden])')).toHaveAttribute('data-seite', '1');

    await grunddatenEintragen(page, `Assistent Seiten ${Date.now()}`, '2035-04-12');
    await page.locator('#assistentWeiter').click();
    await expect(page.locator('.assistent-seite:not([hidden])')).toHaveAttribute('data-seite', '2');
    await expect(page.locator('#anzahl_kampfflaechen')).toBeVisible();
    await page.locator('#assistentWeiter').click();
    await expect(page.locator('#startgeld')).toBeVisible();
    await page.locator('#assistentWeiter').click();
    await expect(page.locator('#ausstattungFragen')).toBeVisible();
    await expect(page.locator('#assistentWeiter')).toHaveText('Turnier anlegen');
    await page.locator('#assistentZurueck').click();
    await expect(page.locator('#startgeld')).toBeVisible();
});

test('Alle Funktionen sind gesperrt, bis die passende Frage mit Ja beantwortet ist; ohne WLAN entfallen Internet und Teilnehmer-App', async ({ page }) => {
    await page.goto('/turnier.html');
    await grunddatenEintragen(page, `Assistent Fragen ${Date.now()}`, '2035-04-13');
    await page.locator('[data-schritt="4"]').click();

    for (const id of ['planungs_tools', 'fkt_urkunden', 'fkt_wettkampfplaene', 'fkt_anzeige', 'fkt_teilnehmer_app', 'fkt_video', 'fkt_streaming']) {
        await expect(schalter(page, id)).toBeDisabled();
        await expect(schalter(page, id)).not.toBeChecked();
    }
    await expect(page.locator('#ausstattungZaehler')).toHaveText('0 von 5 Fragen beantwortet');

    await antwort(page, 'drucker', 'ja');
    await expect(schalter(page, 'fkt_urkunden')).toBeEnabled();
    await expect(schalter(page, 'fkt_urkunden')).toBeChecked();
    await expect(schalter(page, 'fkt_wettkampfplaene')).toBeChecked();
    await expect(page.locator('button[data-frage="drucker"][data-antwort="ja"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('button[data-frage="drucker"][data-antwort="nein"]')).toHaveAttribute('aria-pressed', 'false');

    // Ja lässt sich pro Funktion wieder abschalten
    await schalter(page, 'fkt_wettkampfplaene').uncheck();
    await expect(schalter(page, 'fkt_urkunden')).toBeChecked();

    await antwort(page, 'wlan', 'ja');
    await expect(page.locator('button[data-frage="internet"]')).toHaveCount(2);
    await antwort(page, 'internet', 'ja');
    await antwort(page, 'app', 'ja');
    await expect(schalter(page, 'fkt_teilnehmer_app')).toBeChecked();

    await antwort(page, 'wlan', 'nein');
    await expect(page.locator('button[data-frage="internet"]')).toHaveCount(0);
    await expect(page.locator('button[data-frage="app"]')).toHaveCount(0);
    await expect(schalter(page, 'fkt_teilnehmer_app')).toBeDisabled();
    await expect(schalter(page, 'fkt_teilnehmer_app')).not.toBeChecked();

    // Ohne PC an der Fläche gibt es keine Kamerafrage, Video bleibt gesperrt
    await antwort(page, 'pc', 'nein');
    await expect(page.locator('button[data-frage="kamera"]')).toHaveCount(0);
    await expect(schalter(page, 'fkt_video')).toBeDisabled();
});

test('Angelegtes Turnier speichert die Funktionen, ausgeschaltete verlieren ihre Menüpunkte und Knöpfe', async ({ page, request }) => {
    await page.goto('/turnier.html');
    await grunddatenEintragen(page, `Assistent Anlegen ${Date.now()}`, '2035-04-14');
    await page.locator('[data-schritt="4"]').click();
    await antwort(page, 'orga', 'nein');
    await antwort(page, 'drucker', 'nein');
    await antwort(page, 'anzeige', 'ja');
    await antwort(page, 'pc', 'nein');
    await antwort(page, 'wlan', 'nein');

    const gespeichert = page.waitForResponse(r => r.url().endsWith('/api/turniere') && r.request().method() === 'POST');
    await page.locator('#assistentWeiter').click();
    const antwortBody = await (await gespeichert).json();
    expect(antwortBody.success).toBeTruthy();
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/, { timeout: 15_000 });
    const turnierId = antwortBody.turnierId;

    const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(turnier.planungs_tools).toBe(false);
    expect(turnier.ausstattung).toEqual({ orga: 'nein', drucker: 'nein', anzeige: 'ja', pc: 'nein', wlan: 'nein' });
    expect(turnier.funktionen).toEqual({
        urkunden: false, wettkampfplaene: false, anzeige: true, teilnehmer_app: false, video: false, streaming: false
    });

    // Menü: Urkunden und Orga weg, Anzeigen bleiben
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await expect(page.locator('#nav-urkunden')).toBeHidden();
    await expect(page.locator('#nav-urkunden-designer')).toBeHidden();
    await expect(page.locator('#nav-orga')).toBeHidden();
    await expect(page.locator('#nav-dashboard')).toBeVisible();
    await expect(page.locator('#nav-uebersicht')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/fkt-aus-wettkampfplaene/);

    // Druckknopf der Matten-Seite ist ausgeblendet
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect(page.locator('body')).toHaveClass(/fkt-aus-wettkampfplaene/);
    await expect(page.locator('#alleDruckenBtn')).toBeHidden();
});

test('Beim Bearbeiten zeigen Fragen und Schalter den gespeicherten Stand, Antworten lassen sich ändern', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: {
            bezeichnung: `Assistent Bearbeiten ${Date.now()}`, ort: 'Teststadt', datum: '2035-04-15', ausrichter: 'JC Assistent', anzahl_kampfflaechen: 1,
            funktionen: { urkunden: false, video: true, streaming: true },
            ausstattung: { drucker: 'nein', wlan: 'ja', internet: 'nein' }
        }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    const { turnierId } = await resp.json();
    const gespeichert = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(gespeichert.ausstattung).toEqual({ drucker: 'nein', wlan: 'ja', internet: 'nein' });

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('[data-schritt="4"]').click();
    await expect(page.locator('#ausstattungKarte')).toBeVisible();
    await expect(page.locator('#assistentWeiter')).toHaveText('Speichern');
    await expect(page.locator('button[data-frage="drucker"][data-antwort="nein"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('button[data-frage="internet"][data-antwort="nein"]')).toHaveAttribute('aria-pressed', 'true');

    // Beantwortet mit Nein: gesperrt. Ohne Antwort: Stand bleibt erhalten und bedienbar.
    await expect(schalter(page, 'fkt_urkunden')).toBeDisabled();
    await expect(schalter(page, 'fkt_wettkampfplaene')).toBeDisabled();
    await expect(schalter(page, 'fkt_teilnehmer_app')).toBeDisabled();
    await expect(schalter(page, 'fkt_anzeige')).toBeEnabled();
    await expect(schalter(page, 'fkt_anzeige')).toBeChecked();
    await expect(schalter(page, 'fkt_video')).toBeEnabled();
    await expect(schalter(page, 'fkt_streaming')).toBeChecked();

    // Antwort ändern: Drucker ist jetzt da
    await antwort(page, 'drucker', 'ja');
    await expect(schalter(page, 'fkt_urkunden')).toBeEnabled();
    await expect(schalter(page, 'fkt_urkunden')).toBeChecked();
    await expect(schalter(page, 'fkt_wettkampfplaene')).toBeChecked();

    // Live-Streaming folgt der Videoaufnahme
    await schalter(page, 'fkt_video').uncheck();
    await expect(schalter(page, 'fkt_streaming')).not.toBeChecked();
    await expect(schalter(page, 'fkt_streaming')).toBeDisabled();

    const speichern = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#assistentWeiter').click();
    expect((await speichern).ok()).toBeTruthy();
    const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(turnier.ausstattung).toEqual({ drucker: 'ja', wlan: 'ja', internet: 'nein' });
    expect(turnier.funktionen).toMatchObject({ urkunden: true, wettkampfplaene: true, anzeige: true, teilnehmer_app: false, video: false, streaming: false });

    // Erneut öffnen: der gespeicherte Stand kommt unverändert zurück, eine abgewählte Funktion bleibt aus
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('[data-schritt="4"]').click();
    await expect(page.locator('button[data-frage="drucker"][data-antwort="ja"]')).toHaveAttribute('aria-pressed', 'true');
    await schalter(page, 'fkt_wettkampfplaene').uncheck();
    const nochmal = page.waitForResponse(r => r.url().includes(`/api/turniere/${turnierId}`) && r.request().method() === 'PUT');
    await page.locator('#assistentWeiter').click();
    expect((await nochmal).ok()).toBeTruthy();
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await page.locator('[data-schritt="4"]').click();
    await expect(schalter(page, 'fkt_wettkampfplaene')).not.toBeChecked();
    await expect(schalter(page, 'fkt_wettkampfplaene')).toBeEnabled();
    await expect(schalter(page, 'fkt_urkunden')).toBeChecked();
});

test('Geänderte Funktionen passen das Menü nach dem Speichern an und der Assistent bleibt auf Seite 4', async ({ page, request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Assistent Menü ${Date.now()}`, ort: 'Teststadt', datum: '2035-04-17', ausrichter: 'JC Assistent', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await resp.json();

    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#bezeichnung')).not.toHaveValue('');
    await expect(page.locator('#nav-urkunden')).toBeVisible();
    await expect(page.locator('#nav-dashboard')).toBeVisible();

    await page.locator('[data-schritt="4"]').click();
    await schalter(page, 'fkt_urkunden').uncheck();
    await schalter(page, 'fkt_anzeige').uncheck();
    await page.locator('#assistentWeiter').click();
    await expect(page.locator('#nav-urkunden')).toBeHidden();
    await expect(page.locator('#nav-dashboard')).toBeHidden();
    await expect(page.locator('#nav-uebersicht')).toBeHidden();
    await expect(page.locator('.assistent-seite:not([hidden])')).toHaveAttribute('data-seite', '4');

    // Wieder einschalten: die Punkte kommen zurück
    await schalter(page, 'fkt_urkunden').check();
    await page.locator('#assistentWeiter').click();
    await expect(page.locator('#nav-urkunden')).toBeVisible();
    await expect(page.locator('#nav-dashboard')).toBeHidden();
});

test('Turniere ohne Angabe zeigen weiter alle Funktionen', async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Assistent Standard ${Date.now()}`, ort: 'Teststadt', datum: '2035-04-16', ausrichter: 'JC Assistent', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await resp.json();
    const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
    expect(Object.values(turnier.funktionen).every(an => an === true)).toBeTruthy();
});
