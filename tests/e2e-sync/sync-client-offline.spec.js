// Offline-Betrieb eines Client-Geräts: die Matte spielt einen kompletten Doppel-KO-8-Pool ohne
// Verbindung zum Hallen-Server (Offline-Kaskade am Gerät), danach wird alles übertragen und der
// Server kommt zum selben Ergebnis.
import { test, expect } from '@playwright/test';
import { richteDk8TurnierEin, syncLeerlauf, clientTrennen, clientVerbinden, clientStatus, CLIENT_BASE_URL } from './helpers.js';

async function spieleKomplettDurch(page, anzahl) {
    let vorher = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahl; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await page.waitForFunction(
            (v) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== v, vorher
        );
        vorher = await page.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);
        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

test('Scoreboard am Client: DK8 komplett offline, danach identisch am Server', async ({ page, request }) => {
    test.setTimeout(180_000);
    const { turnierId, matId } = await richteDk8TurnierEin(request, 'Sync Client Offline DK8');
    await syncLeerlauf(request);
    const matteGesetzt = await request.put(`${CLIENT_BASE_URL}/api/sync/client/matte`, { data: { matte_id: matId } });
    expect(matteGesetzt.ok()).toBeTruthy();

    await clientTrennen(request);
    await page.goto(`${CLIENT_BASE_URL}/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await spieleKomplettDurch(page, 11);

    // Lokal (Client-API) ist der Pool komplett durch — ohne jeden Server-Kontakt.
    const lokal = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(lokal.every(k => k.status === 'beendet')).toBe(true);
    expect(lokal.find(k => k.reihenfolge_nummer === 'F').kaempfer1_nachname).toBe('Adler');
    expect((await clientStatus(request)).ausstehend).toBeGreaterThan(0);
    // Statusleiste (syncStatus.js): gelb mit Anzahl der ausstehenden Änderungen.
    await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'offline');
    await expect(page.locator('#syncStatusLeiste')).toContainText('ausstehend');
    const serverVorher = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(serverVorher.some(k => k.status !== 'beendet')).toBe(true);

    await clientVerbinden(request);
    await syncLeerlauf(request);
    await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'verbunden');
    await expect(page.locator('#syncStatusLeiste')).toHaveText('verbunden');

    const server = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(server).toHaveLength(11);
    expect(server.every(k => k.status === 'beendet')).toBe(true);
    const finale = server.find(k => k.reihenfolge_nummer === 'F');
    expect(finale.sieger_id).toBe(finale.kaempfer1_id);
    expect(finale.kaempfer1_nachname).toBe('Adler');
    // Lokale Kaskade und Server-Kaskade kommen zu denselben Paarungen.
    const paarung = (l) => Object.fromEntries(l.map(k => [k.reihenfolge_nummer, [k.kaempfer1_nachname, k.kaempfer2_nachname, k.sieger_id === k.kaempfer1_id]]));
    expect(paarung(server)).toEqual(paarung(lokal));
    expect((await clientStatus(request)).ausstehend).toBe(0);
});

test('Mattenleitung am Client: Disqualifikation offline, lokale Kaskade, danach identisch am Server', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { turnierId, matId } = await richteDk8TurnierEin(request, 'Sync Client Offline DSQ');
    await syncLeerlauf(request);
    expect((await request.put(`${CLIENT_BASE_URL}/api/sync/client/matte`, { data: { matte_id: matId } })).ok()).toBeTruthy();
    await clientTrennen(request);

    const vorher = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
    const [erster, zweiter] = vorher.filter(k => k.status === 'bereit');
    // Folgekampf, der die Sieger genau dieser beiden Vorkämpfe bekommt (DK8: H5 aus H1/H2). Die
    // Kaskade befüllt ihn erst, wenn BEIDE Quellen entschieden sind.
    const folge = vorher.find(x => [x.kaempfer1_quelle_kampf_id, x.kaempfer2_quelle_kampf_id].sort().join() === [erster.id, zweiter.id].sort().join()
        && x.kaempfer1_quelle_typ === 'sieger');

    await page.goto(`${CLIENT_BASE_URL}/kampf.html?turnierId=${turnierId}`);
    await expect(page.locator('#mattenSelect')).toHaveValue(String(matId));
    // Jeweils Kämpfer 2 disqualifizieren -> Kämpfer 1 gewinnt mit 10 Punkten.
    for (const kampf of [erster, zweiter]) {
        await page.getByRole('button', { name: `${kampf.kaempfer2_nachname}, ${kampf.kaempfer2_vorname}: DSQ` }).first().click();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toContainText('Forfeit gewertet');
        await expect.poll(async () => {
            const lokal = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
            return lokal.find(x => x.id === kampf.id).status;
        }).toBe('beendet');
    }

    // Lokal: der Folgekampf ist durch die Offline-Kaskade mit beiden Siegern befüllt und bereit.
    await expect.poll(async () => {
        const lokal = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const f = lokal.find(x => x.id === folge.id);
        return [f.status, [f.kaempfer1_id, f.kaempfer2_id].sort()];
    }).toEqual(['bereit', [erster.kaempfer1_id, zweiter.kaempfer1_id].sort()]);

    await clientVerbinden(request);
    await syncLeerlauf(request);
    const server = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    for (const kampf of [erster, zweiter]) {
        const k = server.find(x => x.id === kampf.id);
        expect(k.status).toBe('beendet');
        expect(k.sieger_id).toBe(kampf.kaempfer1_id);
        const teilnehmer = await (await request.get(`/api/teilnehmer/${kampf.kaempfer2_id}`)).json();
        expect(teilnehmer.status).toBe('disqualifiziert');
    }
    const f = server.find(x => x.id === folge.id);
    expect([f.kaempfer1_id, f.kaempfer2_id].sort()).toEqual([erster.kaempfer1_id, zweiter.kaempfer1_id].sort());
});
