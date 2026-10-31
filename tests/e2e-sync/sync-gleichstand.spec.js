// Gleichstand entscheiden über das Dokument-Backend (public/js/datenzugriff.js: entscheideGleichstand): ein Gerät schreibt einen
// Antrag ins Pool-Dokument, die Sync-Brücke führt ihn am Hallen-Server aus (src/services/gleichstandService.js).
import { test, expect } from '@playwright/test';
import { legeTurnierAn, warteLeerlauf } from './helpers.js';

async function legePool(request, turnierId, name, anzahl) {
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: name, altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();
    for (let i = 0; i < anzahl; i++) {
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: `${name}${i}`, nachname: `Gl${i}`, verein: `Verein ${i}`, geburtsjahr: 2014,
                geschlecht: 'männlich', gewicht: 36 + i, altersklasse: 'U13', gewichtsklasse: '-40'
            }
        });
        expect(t.ok(), await t.text()).toBeTruthy();
        const m = await request.post('/api/pools/verschieben', { data: { teilnehmerId: (await t.json()).teilnehmerId, zielPoolId: poolId } });
        expect(m.ok(), await m.text()).toBeTruthy();
    }
    const z = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(z.ok(), await z.text()).toBeTruthy();
    return poolId;
}

const holeKaempfe = async (request, poolId) => (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
const nachNummer = (a, b) => String(a.reihenfolge_nummer).localeCompare(String(b.reihenfolge_nummer), 'de', { numeric: true });

async function beende(request, kampf, siegerId, zeit) {
    const r = await request.put(`/api/kaempfe/${kampf.id}`, {
        data: {
            status: 'beendet', sieger_id: siegerId,
            unterbewertung_kaempfer1: siegerId === kampf.kaempfer1_id ? 10 : 0,
            unterbewertung_kaempfer2: siegerId === kampf.kaempfer2_id ? 10 : 0,
            kampfzeit_in_sekunden: zeit
        }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
}

async function spieleKreis(request, kaempfe, zeiten) {
    const s = [...kaempfe].sort(nachNummer);
    const [x, y, z] = [s[0].kaempfer1_id, s[0].kaempfer2_id, s[1].kaempfer2_id];
    const sieger = { [`${x}-${y}`]: x, [`${x}-${z}`]: z, [`${y}-${z}`]: y };
    for (const [i, k] of s.entries()) {
        await beende(request, k, sieger[`${k.kaempfer1_id}-${k.kaempfer2_id}`] ?? sieger[`${k.kaempfer2_id}-${k.kaempfer1_id}`], zeiten[i]);
    }
}

test.describe.serial('Gleichstand entscheiden über das Dokument-Backend', () => {
    async function ladeModul(page) {
        await page.goto('/login.html');
        await page.addScriptTag({ url: '/js/pouchdb/pouchdb.min.js' });
        await page.addScriptTag({ url: '/js/datenzugriff.js' });
        return page.evaluate(() => window.Datenzugriff.init());
    }

    test('Jeder-gegen-Jeden: Antrag "nach Siegzeit" speichert die Entscheidung am Server', async ({ page, request }) => {
        const turnierId = await legeTurnierAn(request, 'Sync Gleichstand JGJ');
        const poolId = await legePool(request, turnierId, 'SyncKreis', 3);
        await spieleKreis(request, await holeKaempfe(request, poolId), [30, 50, 70]);
        await warteLeerlauf(request);

        expect(await ladeModul(page)).toBe('dokumente');
        const r = await page.evaluate((id) => window.Datenzugriff.entscheideGleichstand(id, 'pool', 'siegzeit'), poolId);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        const pool = (await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json()).find(p => p.id === poolId);
        expect(JSON.parse(pool.gleichstand_entscheidung).pool[0]).toHaveLength(3);
        await warteLeerlauf(request);
        const zu = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(zu.ok(), await zu.text()).toBeTruthy();
    });

    test('Gruppen-Überkreuz: Antrag "Stichkampf" legt V_A_S1 bis V_A_S3 an und sperrt das Halbfinale', async ({ page, request }) => {
        const turnierId = await legeTurnierAn(request, 'Sync Gleichstand Ueberkreuz');
        const poolId = await legePool(request, turnierId, 'SyncUe', 6);
        const alle = (await holeKaempfe(request, poolId)).filter(k => /^V_/.test(k.reihenfolge_nummer));
        await spieleKreis(request, alle.filter(k => k.reihenfolge_nummer.startsWith('V_A_')), [60, 60, 60]);
        for (const k of alle.filter(k => k.reihenfolge_nummer.startsWith('V_B_'))) await beende(request, k, k.kaempfer1_id, 60);
        await warteLeerlauf(request);

        await ladeModul(page);
        const abgelehnt = await page.evaluate((id) => window.Datenzugriff.entscheideGleichstand(id, 'A', 'siegzeit'), poolId);
        expect(abgelehnt.ok).toBe(false); // gleiche Zeiten: die Siegzeit entscheidet nicht
        const r = await page.evaluate((id) => window.Datenzugriff.entscheideGleichstand(id, 'A', 'stichkampf'), poolId);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        await warteLeerlauf(request);

        const kaempfe = await holeKaempfe(request, poolId);
        expect(kaempfe.filter(k => /^V_A_S/.test(k.reihenfolge_nummer))).toHaveLength(3);
        expect(kaempfe.filter(k => /^HF/.test(k.reihenfolge_nummer)).every(k => k.kaempfer1_id == null)).toBeTruthy();
    });
});
