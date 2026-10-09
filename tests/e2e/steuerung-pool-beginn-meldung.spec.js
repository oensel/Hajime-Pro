// End-to-End: steuerung.html zeigt ein Durchsage-Overlay, wenn in den nächsten 3 Kämpfen ein Pool beginnt.
// Zwei Pools à 3 Teilnehmer (Jeder gegen Jeden = je 3 Kämpfe) auf einer Matte; die Planung verschränkt sie, beide
// Pools beginnen also innerhalb der ersten 3 Kämpfe.
import { test, expect } from '@playwright/test';

const POOLS = [
    { name: 'Pool Leicht', gewichtsklasse: '-73kg', gewicht: 70, namen: ['Anna', 'Berta', 'Clara'] },
    { name: 'Pool Schwer', gewichtsklasse: '-81kg', gewicht: 79, namen: ['Doris', 'Eva', 'Fiona'] }
];

async function richteTurnierEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Pool-Beginn', ort: 'Teststadt', datum: '2027-05-15', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    const poolIds = [];
    for (const p of POOLS) {
        const r = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung: p.name, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: p.gewichtsklasse }
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
    for (const [i, poolId] of poolIds.entries()) {
        const r = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: i + 1 } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    return { turnierId, matId };
}

test('Pool beginnt in den nächsten 3 Kämpfen: Overlay mit Erledigt, danach nicht erneut (auch nicht nach Neuladen)', async ({ page, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    const url = `/steuerung.html?turnierId=${turnierId}&matId=${matId}`;
    await page.goto(url);

    const overlay = page.locator('#poolBeginnOverlay');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay).toContainText('Durchsage: Beginn');
    await expect(overlay).toContainText('Pool Schwer');
    await expect(overlay).toContainText(/auf Matte \d/);
    await expect(overlay).not.toContainText('Matte Matte');
    await expect(overlay).toContainText('Pool Leicht');

    await expect(overlay).toContainText('bei gedrückter Strg-Taste');
    await page.locator('#poolBeginnErledigtBtn').click();
    await expect(overlay).toBeHidden();

    await page.reload();
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await page.waitForTimeout(2000); // Zeit für das Laden der Matten-Übersicht
    await expect(overlay).toBeHidden();
});

test('Overlay liegt über "Nächsten Kampf holen" und sperrt nur diesen, bis "Erledigt" geklickt ist', async ({ page, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);

    const overlay = page.locator('#poolBeginnOverlay');
    const holen = page.locator('#btnNaechsterKampfLive');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // Der Knopf ist verdeckt (Klick würde vom Overlay abgefangen), die übrige Steuerung bleibt bedienbar.
    await expect(holen.click({ trial: true, timeout: 1500 })).rejects.toThrow(/intercepts pointer events/);
    await page.evaluate(() => window.naechstenKampfHolen()); // auch ein Aufruf per Skript/Tastenkürzel holt nichts
    await expect(page.locator('#nameW')).toHaveValue('Kämpfer 1');
    await page.locator('.st-nav-btn[data-st-oeffne="daten"]').click({ trial: true, timeout: 1500 }); // Menü bleibt bedienbar

    await page.locator('#poolBeginnErledigtBtn').click();
    await expect(overlay).toBeHidden();
    await holen.click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await expect(holen).toBeHidden();
});
