// End-to-End: Videoaufnahme für den Videoschiedsrichter. Chromium liefert per Fake-Kamera ein Testbild; die Steuerung nimmt je
// Kampf einen Clip auf, der Hallen-Server speichert Datei und Marken, die Live-Ansicht zeigt das Bild und der Video-Archiv spielt
// den Clip ab.
import { test, expect } from '@playwright/test';
import { rmSync, existsSync, statSync } from 'node:fs';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';
import { VIDEO_TESTVERZEICHNIS } from './test-env.js';

test.use({
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

const TEILNEHMER = ['Anna', 'Berta', 'Clara'];

async function richteTurnierEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Video', ort: 'Teststadt', datum: '2027-07-10', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const { poolId } = await (await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: 'Video Pool', altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    })).json();
    const ids = [];
    for (const vorname of TEILNEHMER) {
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname, nachname: `${vorname}x`, verein: `JC ${vorname}`,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 70, altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        ids.push((await t.json()).teilnehmerId);
    }
    for (const teilnehmerId of ids) expect((await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } })).ok()).toBeTruthy();
    expect((await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } })).ok()).toBeTruthy();
    return { turnierId, matId };
}

test('Videoaufnahme: live zum Server, Live-Raster, Ansehen in der Steuerung, vollständiger Clip mit Marken, Video-Archiv', async ({ page, context, request }) => {
    rmSync(VIDEO_TESTVERZEICHNIS, { recursive: true, force: true });
    const status = await (await request.get('/api/video/status')).json();
    expect(status.verfuegbar, status.grund).toBe(true);

    const { turnierId, matId } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    // Videoaufnahme einschalten
    await page.locator('.st-nav-btn[data-st-oeffne="video"]').click();
    const aktiv = page.locator('#videoAktiv');
    await expect(aktiv).toBeEnabled({ timeout: 10_000 });
    await page.locator('label.switch-aufnahme').click();
    await page.keyboard.press('Escape'); // Panel schließen, es überdeckt sonst die Bühne
    await expect(aktiv).toBeChecked();
    await expect(page.locator('#videoStatus')).toContainText('Kamera bereit', { timeout: 15_000 });
    // "Video ansehen" sitzt oben links in der Meta-Leiste der eingebetteten Anzeige, neben Klasse und Gewicht
    const ansehen = page.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]').locator('.top-meta-bar #iframeBtnVideoAnsehen');
    await expect(ansehen).toBeHidden(); // ohne laufende Aufnahme nichts anzusehen

    // Kampf laden: die Aufnahme beginnt (nur lokal im Browser)
    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#videoStatus')).toContainText('Aufnahme läuft', { timeout: 10_000 });
    await expect(ansehen).toBeVisible({ timeout: 5000 });
    const kn = await ansehen.boundingBox();
    const meta = await page.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]').locator('#outMeta').boundingBox();
    expect(kn.x).toBeLessThan(meta.x); // links neben Klasse und Gewicht

    // Mit Verbindung wird schon während der Aufnahme zum Server übertragen (Live)
    await expect(page.locator('#videoUebertragung')).toContainText('Live zum Server', { timeout: 15_000 });
    await expect.poll(async () => (await (await request.get('/api/video/status')).json()).live.length).toBe(1);

    // Live-Raster in einem zweiten Fenster: eine Kachel für die Matte mit Kamerabild
    const live = await context.newPage();
    await live.goto('/video-live.html');
    await expect(live.locator('.video-kachel')).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => live.locator('.video-kachel-bild').evaluate(v => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(live.locator('.video-kachel-titel')).toContainText('Video Pool');

    // Farbe von Kämpfer 2 auf Rot stellen (Turnier, Pool oder Kampf): gehört zum Clip und zum Ergebnistext
    await page.evaluate(() => window.changeFighterColorSlider(true, false));

    // START, STOPP (dazwischen etwas Aufnahme)
    await page.locator('#btnStartStopLive').click();
    await expect(page.locator('#btnStartStopLive')).toHaveText('STOPP');
    await page.waitForTimeout(3500);
    await page.locator('#btnStartStopLive').click();
    await expect(page.locator('#btnStartStopLive')).toHaveText('START');

    // Während des Kampfes: bisherigen Stand ansehen, vor- und zurückspulen. Am Server liegt noch nichts.
    await ansehen.click();
    const review = page.locator('#videoReview');
    await expect(review).toBeVisible();
    const spieler = page.locator('#videoReviewPlayer');
    await expect.poll(() => spieler.evaluate(v => Number.isFinite(v.duration) && v.duration > 2), { timeout: 20_000 }).toBe(true);
    await expect(page.locator('#videoReviewMarken .video-review-knopf')).toHaveCount(3); // geladen, START, STOPP
    await review.locator('[data-sprung="-10"]').click();
    await expect.poll(() => spieler.evaluate(v => v.currentTime)).toBe(0);
    await review.locator('[data-sprung="5"]').click();
    await expect.poll(() => spieler.evaluate(v => v.currentTime)).toBeGreaterThan(1);
    const vorher = await spieler.evaluate(v => v.currentTime);
    await review.locator('[data-sprung="-5"]').click();
    await expect.poll(() => spieler.evaluate(v => v.currentTime)).toBeLessThan(vorher);
    await review.locator('#videoReviewAktualisieren').click();
    await expect.poll(() => spieler.evaluate(v => Number.isFinite(v.duration) && v.duration > 2), { timeout: 20_000 }).toBe(true);
    // Der Clip ist am Server schon da, aber noch unvollständig (läuft)
    const laufend = (await (await request.get('/api/video/clips')).json());
    expect(laufend.length).toBe(1);
    expect(laufend[0].ende).toBeNull();
    await review.locator('#videoReviewSchliessen').click();
    await expect(review).toBeHidden();

    // Ergebnis senden: der Clip wird abgeschlossen und liegt vollständig am Server; die Live-Kachel verschwindet
    await page.evaluate(() => window.changeScore('W', 'ippon', 1));
    await page.locator('#btnErgebnisSendenLive').click();
    await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    await expect(ansehen).toBeHidden({ timeout: 5000 }); // nach dem Ergebnis läuft keine Aufnahme mehr

    // Clip ist gespeichert, mit Marken in der richtigen Reihenfolge
    let clip;
    await expect.poll(async () => {
        const clips = await (await request.get('/api/video/clips')).json();
        clip = clips[0];
        return clip && clip.ende && clip.groesse > 20_000 ? clip.marken.map(m => m.typ).join(',') : '';
    }, { timeout: 20_000 }).toBe('geladen,start,stopp,ergebnis');
    expect(clip.pool).toBe('Video Pool');
    expect(clip.abgebrochen).toBe(false);
    expect(clip.farbe2).toBe('rot');
    expect(clip.ergebnis).toBe('Sieger Weiß');
    const marken = Object.fromEntries(clip.marken.map(m => [m.typ, m.ms]));
    expect(marken.stopp - marken.start).toBeGreaterThan(3000);
    expect(marken.start).toBeGreaterThanOrEqual(marken.geladen);
    const datei = `${VIDEO_TESTVERZEICHNIS}/turnier-${turnierId}/matte-${matId}/${clip.id}.webm`;
    expect(existsSync(datei)).toBe(true);
    expect(statSync(datei).size).toBe(clip.groesse);

    await expect(live.locator('.video-kachel')).toHaveCount(0, { timeout: 20_000 });
    await live.close();

    // Video-Archiv: Liste, Abspielen, Marken
    const beweis = await context.newPage();
    await beweis.goto('/videobeweis.html');
    const zeile = beweis.locator(`tr[data-clip-id="${clip.id}"]`);
    await expect(zeile).toContainText('Video Pool');
    await expect(zeile.locator('.video-farbmarke-rot')).toHaveCount(1);
    await expect(zeile.locator('.video-kaempfer div')).toHaveCount(2); // Kämpfer untereinander
    await zeile.locator('.video-ansehen').click();
    await expect(beweis.locator('#vbMarken .video-marke')).toHaveCount(4);
    await expect.poll(() => beweis.locator('#vbVideo').evaluate(v => Number.isFinite(v.duration) && v.duration > 1), { timeout: 20_000 }).toBe(true);
    await beweis.locator('.video-marke-stopp').click();
    await expect.poll(() => beweis.locator('#vbVideo').evaluate(v => v.currentTime)).toBeGreaterThan(0.5);

    // Löschen
    beweis.once('dialog', d => d.accept());
    await zeile.locator('.video-knopf-gefahr').click();
    await expect.poll(async () => (await (await request.get('/api/video/clips')).json()).length).toBe(0);
    await expect(beweis.locator('#vbListe')).toContainText('Noch keine Aufnahmen');
});

test('Ohne Verbindung bleibt der Clip lokal (auch nach Neuladen) und geht später vollständig zum Server', async ({ page, request }) => {
    rmSync(VIDEO_TESTVERZEICHNIS, { recursive: true, force: true });
    const { turnierId, matId } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);

    // Verbindung zum Video-WebSocket des Servers sperren (Server "nicht erreichbar")
    let gesperrt = true;
    await page.routeWebSocket('**/api/video', (ws) => {
        if (gesperrt) ws.close();
        else ws.connectToServer();
    });

    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await page.locator('.st-nav-btn[data-st-oeffne="video"]').click();
    await expect(page.locator('#videoAktiv')).toBeEnabled({ timeout: 10_000 });
    await page.locator('label.switch-aufnahme').click();
    await page.keyboard.press('Escape'); // Panel schließen, es überdeckt sonst die Bühne
    await expect(page.locator('#videoStatus')).toContainText('Kamera bereit', { timeout: 15_000 });

    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#videoStatus')).toContainText('Aufnahme läuft', { timeout: 10_000 });
    await expect(page.locator('#videoUebertragung')).toContainText('Keine Verbindung zum Server', { timeout: 10_000 });
    await page.locator('#btnStartStopLive').click();
    await page.waitForTimeout(2500);
    await page.locator('#btnStartStopLive').click();
    await page.evaluate(() => window.changeScore('W', 'ippon', 1));
    await page.locator('#btnErgebnisSendenLive').click();
    await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    await expect(page.locator('#videoUebertragung')).toContainText('1 Clip wartet');
    await page.waitForTimeout(1500); // Zwischenspeicher im Browser schreiben lassen
    expect((await (await request.get('/api/video/clips')).json()).length).toBe(0);

    // Seite neu laden: der Clip steht im Zwischenspeicher und wird nach der Rückkehr der Verbindung übertragen
    await page.reload();
    await expect(page.locator('#videoUebertragung')).toContainText('Clip wartet', { timeout: 15_000 });
    gesperrt = false;
    let clip;
    await expect.poll(async () => {
        const clips = await (await request.get('/api/video/clips')).json();
        clip = clips[0];
        return clip && clip.ende && clip.groesse > 20_000 ? clip.marken.map(m => m.typ).join(',') : '';
    }, { timeout: 60_000 }).toBe('geladen,start,stopp,ergebnis');
    expect(clip.ergebnis).toBe('Sieger Weiß');
    expect(clip.abgebrochen).toBe(false);
    await expect(page.locator('#videoUebertragung')).toContainText('Alle Clips sind am Server gespeichert', { timeout: 15_000 });

    // Der Clip ist vollständig und abspielbar
    const beweis = await page.context().newPage();
    await beweis.goto('/videobeweis.html');
    await beweis.locator(`tr[data-clip-id="${clip.id}"] .video-ansehen`).click();
    await expect.poll(() => beweis.locator('#vbVideo').evaluate(v => Number.isFinite(v.duration) && v.duration > 1), { timeout: 20_000 }).toBe(true);
});

test('Aufnahme nach dem Laden des Kampfes einschalten: Clip, Overlay-Knopf und flüssige Live-Kachel', async ({ page, context, request }) => {
    rmSync(VIDEO_TESTVERZEICHNIS, { recursive: true, force: true });
    const { turnierId, matId } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    // Erst den Kampf laden, dann die Aufnahme einschalten: sie beginnt sofort für diesen Kampf
    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await page.locator('.st-nav-btn[data-st-oeffne="video"]').click();
    await expect(page.locator('#videoAktiv')).toBeEnabled({ timeout: 10_000 });
    await page.locator('label.switch-aufnahme').click();
    await page.keyboard.press('Escape'); // Panel schließen, es überdeckt sonst die Bühne
    await expect(page.locator('#videoStatus')).toContainText('Aufnahme läuft', { timeout: 15_000 });
    const ansehen = page.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]').locator('.top-meta-bar #iframeBtnVideoAnsehen');
    await expect(ansehen).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#videoMessung')).toContainText('fps', { timeout: 5000 });

    // Live-Kachel: gleichmäßig laufend (Bilder pro Sekunde, Puffer vor der Wiedergabe)
    const live = await context.newPage();
    await live.goto('/video-live.html');
    await expect(live.locator('.video-kachel-bild')).toHaveCount(1, { timeout: 15_000 });
    await live.waitForTimeout(6000);
    const m = await live.evaluate(async () => {
        const v = document.querySelector('.video-kachel-bild');
        const q0 = v.getVideoPlaybackQuality();
        await new Promise(r => setTimeout(r, 6000));
        const q1 = v.getVideoPlaybackQuality();
        return { fps: (q1.totalVideoFrames - q0.totalVideoFrames) / 6, rate: v.playbackRate, puffer: v.buffered.end(v.buffered.length - 1) - v.currentTime };
    });
    expect(m.fps).toBeGreaterThan(20);
    expect(m.puffer).toBeGreaterThan(0.3);

    // Ergebnis: der Clip wird vollständig abgelegt
    await page.evaluate(() => window.changeScore('W', 'ippon', 1));
    await page.locator('#btnErgebnisSendenLive').click();
    await expect.poll(async () => {
        const clips = await (await request.get('/api/video/clips')).json();
        return clips[0] && clips[0].ende ? clips[0].marken.map(k => k.typ).join(',') : '';
    }, { timeout: 30_000 }).toContain('geladen');
});
