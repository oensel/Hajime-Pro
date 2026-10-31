// End-to-End: Prüfungs-Sperre der Steuerung (#poolPruefungOverlay). Wartet ein Pool der Matte auf die Ergebnisprüfung
// ("kaempfe_beendet") und gehört der nächste Kampf zu einem noch nicht begonnenen Pool, holt "Nächsten Kampf holen"
// nichts, bis der Pool abgeschlossen ist. Kämpfe bereits laufender Pools bleiben holbar.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

const POOLS = [
    { name: 'Pool Leicht', gewichtsklasse: '-73kg', gewicht: 70, namen: ['Anna', 'Berta', 'Clara'] },
    { name: 'Pool Schwer', gewichtsklasse: '-81kg', gewicht: 79, namen: ['Doris', 'Eva', 'Fiona'] }
];

// Zwei Pools à 3 Teilnehmer (Jeder gegen Jeden = je 3 Kämpfe). Ohne zweiterAufMatte bleibt der zweite Pool vorerst ohne Matte.
async function richteTurnierEin(request, bezeichnung, { zweiterAufMatte }) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-05-15', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    const poolIds = [];
    for (const p of POOLS) {
        const r = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung: `${bezeichnung} ${p.name}`, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: p.gewichtsklasse }
        });
        poolIds.push((await r.json()).poolId);
    }
    // Erst alle anmelden, dann verschieben (ein Pool mit Teilnehmern sperrt die Altersklasse für Anmeldungen).
    const zuordnung = [];
    for (const [i, p] of POOLS.entries()) {
        for (const vorname of p.namen) {
            const t = await request.post('/api/teilnehmer', {
                data: {
                    turnier_id: turnierId, vorname, nachname: `${vorname}x`, verein: `JC ${vorname}`,
                    geburtsjahr: 2009, geschlecht: 'männlich', gewicht: p.gewicht, altersklasse: 'U18', gewichtsklasse: p.gewichtsklasse
                }
            });
            zuordnung.push({ teilnehmerId: (await t.json()).teilnehmerId, zielPoolId: poolIds[i] });
        }
    }
    for (const z of zuordnung) expect((await request.post('/api/pools/verschieben', { data: z })).ok()).toBeTruthy();
    await ordneZu(request, poolIds[0], matId, 1);
    if (zweiterAufMatte) await ordneZu(request, poolIds[1], matId, 2);
    return { turnierId, matId, poolIds };
}

async function ordneZu(request, poolId, matId, position) {
    const r = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position } });
    expect(r.ok(), await r.text()).toBeTruthy();
}

async function kaempfeDerMatte(request, matId) {
    return (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
}

// Holt den nächsten Kampf und lässt "W" (kaempfer1) per Ippon gewinnen
async function spieleNaechstenKampf(page) {
    const vorher = await page.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);
    await page.locator('#btnNaechsterKampfLive').click();
    await page.waitForFunction(
        (v) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== v,
        vorher
    );
    await page.evaluate(() => window.changeScore('W', 'ippon', 1));
    await page.locator('#btnErgebnisSendenLive').click();
    await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
}

test('Neuer Pool nach einem Pool in Prüfung: Holen gesperrt, bis der Pool abgeschlossen ist', async ({ page, request }) => {
    const { turnierId, matId, poolIds } = await richteTurnierEin(request, 'Sperre', { zweiterAufMatte: false });
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    for (let i = 0; i < 3; i++) await spieleNaechstenKampf(page);
    expect((await kaempfeDerMatte(request, matId)).every(k => k.pool_status === 'kaempfe_beendet')).toBe(true);

    // Der zweite Pool kommt erst jetzt auf die Matte: sein erster Kampf ist der nächste und der Pool hat nicht begonnen
    await ordneZu(request, poolIds[1], matId, 2);
    await page.reload();
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    const sperre = page.locator('#poolPruefungOverlay');
    await expect(sperre).toBeVisible({ timeout: 15_000 });
    await expect(sperre).toContainText('Sperre Pool Leicht: Ergebnisse prüfen');
    await expect(sperre).toContainText('1. ');
    await expect(page.locator('#poolBeginnOverlay')).toBeHidden(); // Durchsage erst nach dem Abschluss

    // Der Knopf ist verdeckt, auch ein Aufruf per Skript/Tastenkürzel holt nichts
    const holen = page.locator('#btnNaechsterKampfLive');
    await expect(holen.click({ trial: true, timeout: 1500 })).rejects.toThrow(/intercepts pointer events/);
    await page.evaluate(() => window.naechstenKampfHolen());
    await expect(page.locator('#nameW')).toHaveValue('Kämpfer 1');

    // "Im Pool-Panel öffnen" zeigt den Pool mit seinen Platzierungen
    await sperre.getByRole('button', { name: 'Im Pool-Panel öffnen' }).click();
    await expect(page.locator('.st-panel[data-st-panel="pool"]')).toHaveClass(/aktiv/);
    await expect(page.locator('#poolPlatzierungen')).toContainText('Platzierungen');
    await page.keyboard.press('Escape');

    page.once('dialog', d => d.accept());
    await sperre.getByRole('button', { name: 'Pool abschließen' }).click();
    await expect(sperre).toBeHidden();
    const pools = await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();
    expect(pools.find(p => Number(p.id) === Number(poolIds[0])).status).toBe('abgeschlossen');

    // Jetzt lässt sich der erste Kampf des neuen Pools holen (die Durchsage klickt der Locator-Handler weg)
    await holen.click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await expect(page.locator('#poolName')).toHaveValue('Sperre Pool Schwer');
});

test('Pool in Prüfung sperrt keine Kämpfe eines bereits laufenden Pools', async ({ page, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request, 'Laufend', { zweiterAufMatte: true });
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    // Bis einer der beiden (verschränkten) Pools in Prüfung geht
    let kaempfe = await kaempfeDerMatte(request, matId);
    while (!kaempfe.some(k => k.pool_status === 'kaempfe_beendet')) {
        await spieleNaechstenKampf(page);
        kaempfe = await kaempfeDerMatte(request, matId);
    }
    const offen = kaempfe.filter(k => k.status === 'bereit');
    expect(offen.length).toBeGreaterThan(0);
    // Voraussetzung: der andere Pool hat schon begonnen
    expect(kaempfe.some(k => Number(k.pool_id) === Number(offen[0].pool_id) && k.status === 'beendet')).toBe(true);

    await page.reload();
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await page.waitForTimeout(2000); // Zeit für das Laden der Matten-Übersicht
    await expect(page.locator('#poolPruefungOverlay')).toBeHidden();
    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
});
