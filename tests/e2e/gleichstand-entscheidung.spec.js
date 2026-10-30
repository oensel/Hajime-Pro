// Gleichstand, den weder Siege, Wertungspunkte noch der direkte Vergleich auflösen (src/shared/gleichstand.js,
// src/services/gleichstandService.js): Im Jeder-gegen-Jeden lässt sich der Pool erst nach einer Entscheidung abschließen,
// im Gruppen-Überkreuz bleibt das Halbfinale unbefüllt, bis die Turnierleitung nach Siegzeit oder per Stichkampf entschieden hat.
// Alles über die HTTP-API (IS_OFFLINE), jede Gruppe von Tests mit eigenem Turnier.
import { test, expect } from '@playwright/test';
import { legeTurnierAn } from './helpers/turnier-aufbau.js';

async function legePoolMitTeilnehmern(request, turnierId, name, anzahl) {
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: name, altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();
    const ids = [];
    for (let i = 0; i < anzahl; i++) {
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: `${name}${i}`, nachname: `Gl${i}`, verein: `Verein ${i}`, geburtsjahr: 2014,
                geschlecht: 'männlich', gewicht: 36 + i, altersklasse: 'U13', gewichtsklasse: '-40'
            }
        });
        expect(t.ok(), await t.text()).toBeTruthy();
        const { teilnehmerId } = await t.json();
        ids.push(teilnehmerId);
        const m = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(m.ok(), await m.text()).toBeTruthy();
    }
    const z = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(z.ok(), await z.text()).toBeTruthy();
    return { poolId, matId, ids };
}

const holeKaempfe = async (request, poolId) => (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
const holePool = async (request, turnierId, poolId) => (await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json()).find(p => p.id === poolId);

async function beende(request, kampf, siegerId, zeit, punkte = 10) {
    const r = await request.put(`/api/kaempfe/${kampf.id}`, {
        data: {
            status: 'beendet', sieger_id: siegerId,
            unterbewertung_kaempfer1: siegerId === kampf.kaempfer1_id ? punkte : 0,
            unterbewertung_kaempfer2: siegerId === kampf.kaempfer2_id ? punkte : 0,
            kampfzeit_in_sekunden: zeit
        }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
}

// Dreierkreis: der erste Kämpfer schlägt den zweiten, der dritte den ersten, der zweite den dritten; je 10 Punkte
async function spieleKreis(request, kaempfe, zeiten) {
    const sortiert = [...kaempfe].sort((a, b) => String(a.reihenfolge_nummer).localeCompare(String(b.reihenfolge_nummer), 'de', { numeric: true }));
    const [x, y, z] = [sortiert[0].kaempfer1_id, sortiert[0].kaempfer2_id, sortiert[1].kaempfer2_id];
    const sieger = { [`${x}-${y}`]: x, [`${x}-${z}`]: z, [`${y}-${z}`]: y };
    for (const [i, k] of sortiert.entries()) {
        const s = sieger[`${k.kaempfer1_id}-${k.kaempfer2_id}`] ?? sieger[`${k.kaempfer2_id}-${k.kaempfer1_id}`];
        await beende(request, k, s, zeiten[i]);
    }
}

test.describe.serial('Gleichstand im Jeder-gegen-Jeden: Pool lässt sich erst nach der Entscheidung abschließen', () => {
    let turnierId, poolId;

    test('Aufbau: Dreierkreis mit unterschiedlichen Siegzeiten, Pool in Prüfung', async ({ request }) => {
        turnierId = await legeTurnierAn(request, { name: 'Gleichstand JGJ' });
        ({ poolId } = await legePoolMitTeilnehmern(request, turnierId, 'Kreis', 3));
        await spieleKreis(request, await holeKaempfe(request, poolId), [30, 50, 70]);
        expect((await holePool(request, turnierId, poolId)).status).toBe('kaempfe_beendet');
    });

    test('Abschließen wird bei offenem Gleichstand abgelehnt', async ({ request }) => {
        const r = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(r.status()).toBe(409);
        expect((await r.json()).error).toMatch(/Gleichstand auf Platz 1 bis 3/);
    });

    test('Entscheidung nach Siegzeit speichert die Reihenfolge, danach lässt sich der Pool abschließen', async ({ request }) => {
        const r = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'pool', regel: 'siegzeit' } });
        expect(r.ok(), await r.text()).toBeTruthy();
        const pool = await holePool(request, turnierId, poolId);
        const gespeichert = JSON.parse(pool.gleichstand_entscheidung);
        expect(gespeichert.pool).toHaveLength(1);
        expect(gespeichert.pool[0]).toHaveLength(3);
        const zweite = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'pool', regel: 'siegzeit' } });
        expect(zweite.status()).toBe(409); // nichts mehr offen
        const zu = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(zu.ok(), await zu.text()).toBeTruthy();
        expect((await holePool(request, turnierId, poolId)).status).toBe('abgeschlossen');
    });
});

test.describe.serial('Gleichstand im Jeder-gegen-Jeden: Stichkämpfe', () => {
    let turnierId, poolId, matId;

    test('Aufbau: Dreierkreis mit gleichen Siegzeiten, die Siegzeit entscheidet nicht', async ({ request }) => {
        turnierId = await legeTurnierAn(request, { name: 'Gleichstand Stich' });
        ({ poolId, matId } = await legePoolMitTeilnehmern(request, turnierId, 'Stich', 3));
        await spieleKreis(request, await holeKaempfe(request, poolId), [60, 60, 60]);
        const r = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'pool', regel: 'siegzeit' } });
        expect(r.status()).toBe(409);
        expect((await r.json()).error).toMatch(/Siegzeit entscheidet hier nicht/);
    });

    test('Stichkämpfe: drei neue Kämpfe, Pool wieder in Betrieb, auf der Matte eingeordnet', async ({ request }) => {
        const r = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'pool', regel: 'stichkampf' } });
        expect(r.ok(), await r.text()).toBeTruthy();
        expect((await r.json()).ergebnis).toHaveLength(3);
        expect((await holePool(request, turnierId, poolId)).status).toBe('gestartet');
        const kaempfe = await holeKaempfe(request, poolId);
        const neue = kaempfe.filter(k => k.status === 'bereit');
        expect(neue).toHaveLength(3);
        expect(neue.every(k => k.matten_reihenfolge != null && k.reihenfolge_manuell)).toBeTruthy();
        // alle drei Paarungen unter den Betroffenen, keine doppelt
        const paare = new Set(neue.map(k => [k.kaempfer1_id, k.kaempfer2_id].sort().join('-')));
        expect(paare.size).toBe(3);
        const auf = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        expect(auf.filter(k => k.status === 'bereit')).toHaveLength(3);
    });

    test('Nach den Stichkämpfen ist der Platz eindeutig und der Pool lässt sich abschließen', async ({ request }) => {
        // Der erste der Dreierkreis-Teilnehmer gewinnt beide Stichkämpfe, der zweite gegen den dritten
        const neue = (await holeKaempfe(request, poolId)).filter(k => k.status === 'bereit');
        const alle = (await holeKaempfe(request, poolId)).filter(k => k.status === 'beendet');
        const ids = [...new Set(alle.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]))].sort((a, b) => a - b);
        const rang = new Map(ids.map((id, i) => [id, i]));
        for (const k of neue) {
            const s = rang.get(k.kaempfer1_id) < rang.get(k.kaempfer2_id) ? k.kaempfer1_id : k.kaempfer2_id;
            await beende(request, k, s, 45);
        }
        expect((await holePool(request, turnierId, poolId)).status).toBe('kaempfe_beendet');
        const zu = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(zu.ok(), await zu.text()).toBeTruthy();
    });
});

test.describe.serial('Gleichstand im Gruppen-Überkreuz: das Halbfinale bleibt gesperrt', () => {
    const vorrunde = async (request, poolId) => (await holeKaempfe(request, poolId)).filter(k => /^V_/.test(k.reihenfolge_nummer));
    const halbfinale = async (request, poolId) => (await holeKaempfe(request, poolId)).filter(k => /^HF/.test(k.reihenfolge_nummer));

    // Gruppe A im Kreis (je 10 Punkte), Gruppe B klar (erster gewinnt alles)
    async function spieleVorrunde(request, poolId, zeitenA) {
        const alle = await vorrunde(request, poolId);
        const a = alle.filter(k => k.reihenfolge_nummer.startsWith('V_A_'));
        const b = alle.filter(k => k.reihenfolge_nummer.startsWith('V_B_'));
        await spieleKreis(request, a, zeitenA);
        for (const k of b) await beende(request, k, k.kaempfer1_id, 60);
    }

    test('Gruppe A im Kreis: HF1 und HF2 bleiben leer; nach Siegzeit-Entscheidung werden sie besetzt', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, { name: 'Gleichstand Ueberkreuz Zeit' });
        const { poolId } = await legePoolMitTeilnehmern(request, turnierId, 'UeZeit', 6);
        expect((await holePool(request, turnierId, poolId)).modus).toBe('Gruppen-Überkreuz');
        await spieleVorrunde(request, poolId, [30, 50, 70]);

        const hf = await halbfinale(request, poolId);
        expect(hf).toHaveLength(2);
        expect(hf.every(k => k.kaempfer1_id == null)).toBeTruthy();

        const falscheGruppe = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'B', regel: 'siegzeit' } });
        expect(falscheGruppe.status()).toBe(409); // Gruppe B ist eindeutig

        const r = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'A', regel: 'siegzeit' } });
        expect(r.ok(), await r.text()).toBeTruthy();
        const danach = await halbfinale(request, poolId);
        expect(danach.every(k => k.kaempfer1_id != null && k.kaempfer2_id != null)).toBeTruthy();
        expect(danach.every(k => k.status === 'bereit')).toBeTruthy();
    });

    test('Stichkämpfe der Gruppe (V_A_S1 …) sperren das Halbfinale, bis sie entschieden sind', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, { name: 'Gleichstand Ueberkreuz Stich' });
        const { poolId } = await legePoolMitTeilnehmern(request, turnierId, 'UeStich', 6);
        await spieleVorrunde(request, poolId, [60, 60, 60]);

        const siegzeit = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'A', regel: 'siegzeit' } });
        expect(siegzeit.status()).toBe(409);

        const r = await request.post(`/api/pools/${poolId}/gleichstand`, { data: { schluessel: 'A', regel: 'stichkampf' } });
        expect(r.ok(), await r.text()).toBeTruthy();
        const stich = (await holeKaempfe(request, poolId)).filter(k => /^V_A_S/.test(k.reihenfolge_nummer));
        expect(stich.map(k => k.reihenfolge_nummer).sort()).toEqual(['V_A_S1', 'V_A_S2', 'V_A_S3']);
        expect(stich.every(k => k.status === 'bereit' && k.matten_reihenfolge != null)).toBeTruthy();
        expect((await halbfinale(request, poolId)).every(k => k.kaempfer1_id == null)).toBeTruthy();

        // nur zwei von drei Stichkämpfen entschieden: das Halbfinale bleibt gesperrt
        const rang = new Map([...new Set(stich.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]))].sort((a, b) => a - b).map((id, i) => [id, i]));
        const gewinner = (k) => (rang.get(k.kaempfer1_id) < rang.get(k.kaempfer2_id) ? k.kaempfer1_id : k.kaempfer2_id);
        await beende(request, stich[0], gewinner(stich[0]), 40);
        await beende(request, stich[1], gewinner(stich[1]), 40);
        expect((await halbfinale(request, poolId)).every(k => k.kaempfer1_id == null)).toBeTruthy();

        await beende(request, stich[2], gewinner(stich[2]), 40);
        const hf = await halbfinale(request, poolId);
        expect(hf.every(k => k.kaempfer1_id != null && k.kaempfer2_id != null)).toBeTruthy();
    });
});
