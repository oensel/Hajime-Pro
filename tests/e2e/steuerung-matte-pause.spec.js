// End-to-End: Matte in steuerung.html pausieren/fortsetzen. Gegen den echten Server: der Status der
// Matte ändert sich in der Datenbank, die Anzeige (anzeige.html, separat geöffnet) zeigt die kommenden
// Kämpfe mit dem Banner "PAUSE", und START sowie "Nächsten Kampf holen" sind währenddessen gesperrt.
import { test, expect } from '@playwright/test';

const TEILNEHMER = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 }
];

async function richteTurnierEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Matte-Pause', ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: 'Pause Pool', altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    });
    const { poolId } = await poolResp.json();
    for (const t of TEILNEHMER) {
        const tResp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht, altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        const { teilnehmerId } = await tResp.json();
        expect((await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } })).ok()).toBeTruthy();
    }
    const zuordnen = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnen.ok(), await zuordnen.text()).toBeTruthy();
    return { turnierId, matId };
}

test('Matte pausieren: Status am Server, PAUSE-Banner auf der Anzeige, START und Kampf holen gesperrt; Fortsetzen hebt alles auf', async ({ browser, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    const context = await browser.newContext();
    const steuerung = await context.newPage();
    const anzeige = await context.newPage();
    const matteStatus = async () => (await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json()).find(m => m.id === matId).status;

    await Promise.all([
        steuerung.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`),
        anzeige.goto('/anzeige.html')
    ]);
    await expect(steuerung.locator('#matSelect')).toHaveValue(String(matId));
    await expect(steuerung.locator('#btnMattePauseLive')).toHaveText(/Matte pausieren/);

    await steuerung.locator('#btnMattePauseLive').click();
    await expect(steuerung.locator('#btnMattePauseLive')).toHaveText(/Matte fortsetzen/);
    expect(await matteStatus()).toBe('pausiert');

    // Anzeige: kommende Kämpfe mit Banner "PAUSE"
    await expect(anzeige.locator('#ovVorschau')).toBeVisible();
    await expect(anzeige.locator('#ovPauseBanner')).toBeVisible();
    await expect(anzeige.locator('#ovPauseBanner')).toHaveText('PAUSE');
    await expect(anzeige.locator('#vorschauNameW1')).not.toHaveText('');

    // Gesperrt: kein Kampf laden, solange die Matte pausiert ist
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).toHaveValue('Kämpfer 1');
    const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(kaempfe.some(k => k.status === 'gestartet')).toBe(false);

    await steuerung.locator('#btnMattePauseLive').click();
    await expect(steuerung.locator('#btnMattePauseLive')).toHaveText(/Matte pausieren/);
    expect(await matteStatus()).not.toBe('pausiert');
    await expect(anzeige.locator('#ovPauseBanner')).toBeHidden();
    await expect(anzeige.locator('#ovVorschau')).toBeHidden();

    // Danach lässt sich der Kampf wieder laden
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).not.toHaveValue('Kämpfer 1');

    await context.close();
});

test('Pause-Button nur zusammen mit START; Pause mit geladenem Kampf, danach lässt sich der nächste Kampf laden', async ({ browser, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    const context = await browser.newContext();
    const steuerung = await context.newPage();
    await steuerung.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(steuerung.locator('#matSelect')).toHaveValue(String(matId));

    // Kampf laden und beenden
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await steuerung.locator('#btnStartStopLive').click();
    await steuerung.evaluate(() => window.changeScore('W', 'ippon', 1));
    await steuerung.locator('#btnErgebnisSendenLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeVisible();

    // In der Vorschau nach "Ergebnis senden" gibt es keinen Pause-Button (nur zusammen mit START)
    await expect(steuerung.locator('#btnStartStopLive')).toBeHidden();
    await expect(steuerung.locator('#btnMattePauseLive')).toBeHidden();
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();
    await expect(steuerung.locator('#btnMattePauseLive')).toBeVisible();

    // Pause mit geladenem, noch nicht gestartetem Kampf, danach Kampf beenden
    await steuerung.locator('#btnMattePauseLive').click();
    await expect(steuerung.locator('#btnMattePauseLive')).toHaveText(/Matte fortsetzen/);
    await steuerung.locator('#btnMattePauseLive').click();
    await expect(steuerung.locator('#btnMattePauseLive')).toHaveText(/Matte pausieren/);
    await steuerung.locator('#btnStartStopLive').click();
    await expect(steuerung.locator('#btnStartStopLive')).toHaveText('STOPP');
    await steuerung.evaluate(() => window.changeScore('W', 'ippon', 1));
    await steuerung.locator('#btnErgebnisSendenLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeVisible();
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();

    await context.close();
});

test('Pause-Button verschwindet mit dem START; ein anderswo beendeter Kampf wird freigegeben, der nächste lässt sich laden', async ({ browser, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    const context = await browser.newContext();
    const steuerung = await context.newPage();
    await steuerung.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(steuerung.locator('#matSelect')).toHaveValue(String(matId));

    // Kampf laden: Pause-Button vor Kampfbeginn sichtbar, mit START weg
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await expect(steuerung.locator('#btnMattePauseLive')).toBeVisible();
    await steuerung.locator('#btnStartStopLive').click();
    await expect(steuerung.locator('#btnStartStopLive')).toHaveText('STOPP');
    await expect(steuerung.locator('#btnMattePauseLive')).toBeHidden();
    await steuerung.locator('#btnStartStopLive').click(); // stoppen

    // Zweiter Kampf geladen, aber der Kampf wird an anderer Stelle beendet (z.B. kampf.html)
    await steuerung.evaluate(() => window.changeScore('W', 'ippon', 1));
    await steuerung.locator('#btnErgebnisSendenLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeVisible();
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();
    const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    const geladenName = await steuerung.locator('#nameW').inputValue();
    const veraltet = kaempfe.find(k => k.status === 'bereit' && `${k.kaempfer1_nachname}, ${k.kaempfer1_vorname}` === geladenName);
    expect(veraltet).toBeTruthy();
    const beenden = await request.put(`/api/kaempfe/${veraltet.id}`, {
        data: { status: 'beendet', sieger_id: veraltet.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0 }
    });
    expect(beenden.ok(), await beenden.text()).toBeTruthy();

    // START auf dem veralteten Kampf: Meldung, Kampf wird freigegeben, "Nächsten Kampf holen" ist wieder da
    await steuerung.locator('#btnStartStopLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeVisible();
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();

    await context.close();
});

test('"Mit nächstem Kampf tauschen" lädt die neuen Kämpfer ins Scoreboard, wenn der geladene Kampf betroffen ist', async ({ browser, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    const context = await browser.newContext();
    const steuerung = await context.newPage();
    await steuerung.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(steuerung.locator('#matSelect')).toHaveValue(String(matId));
    const paarung = () => steuerung.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);

    // Erster Kampf wird beendet; der nächste enthält einen Kämpfer ohne ausreichende Pause (Pausenwarnung)
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await steuerung.locator('#btnStartStopLive').click();
    await steuerung.evaluate(() => window.changeScore('W', 'ippon', 1));
    await steuerung.locator('#btnErgebnisSendenLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeVisible();
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();

    const vorher = await paarung();
    await expect(steuerung.locator('#pausenWarnungBanner')).toBeVisible();
    await steuerung.locator('#btnPausenTausch').click();
    await expect.poll(paarung).not.toBe(vorher);
    // Der Kampf ist weiterhin geladen und noch nicht gestartet
    await expect(steuerung.locator('#btnStartStopLive')).toBeVisible();
    await expect(steuerung.locator('#btnNaechsterKampfLive')).toBeHidden();

    await context.close();
});
