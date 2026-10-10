// End-to-End: Nachzügler in ausgeloste Altersklassen (docs/specs/2026-10-10-nachzuegler-pool-design.md).
import { test, expect } from '@playwright/test';

test.describe.serial('Nachzügler', () => {
    let turnierId;
    let poolId;
    const ids = {};

    async function legeAn(request, name, gewicht, extra = {}) {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'Test', verein: 'JC Nachzug',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true, ...extra
            }
        });
        const body = await resp.json();
        expect(resp.ok(), JSON.stringify(body)).toBeTruthy();
        return body.teilnehmerId;
    }
    const holePools = async (request, mit = false) =>
        (await (await request.get(`/api/pools/details?turnierId=${turnierId}${mit ? '&mitVerspaetet=1' : ''}`)).json());
    const holeNachzuegler = async (request) => (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json());
    const sammeln = (request) => request.post('/api/pools/nachzuegler/sammeln', { data: { turnierId } });

    test('Turnier, U11-Pool mit vier Teilnehmern ausgelost und auf der Matte', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Nachzügler ${Date.now()}`, ort: 'Halle', datum: '2027-06-12', ausrichter: 'JC Nachzug', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        for (const [i, g] of [28, 29, 29.5, 30].entries()) ids[`t${i}`] = await legeAn(request, `Stamm${i}`, g);
        const gen = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } });
        expect(gen.ok(), await gen.text()).toBeTruthy();
        const verteilt = await request.post('/api/pools/aufteilen', { data: { turnierId } });
        expect(verteilt.ok(), await verteilt.text()).toBeTruthy();
        poolId = (await holePools(request))[0].id;
    });

    test('Nachzügler erscheint mit Vorschlag auf den offenen Pool', async ({ request }) => {
        ids.spaet = await legeAn(request, 'Spaet', 29.2);
        const { nachzuegler } = await holeNachzuegler(request);
        const eintrag = nachzuegler.find(n => n.teilnehmerId === ids.spaet);
        expect(eintrag, JSON.stringify(nachzuegler)).toBeTruthy();
        expect(eintrag.vorschlag).toMatchObject({ poolId, teilnehmerNachher: 5, systemNachher: 'Jeder-gegen-Jeden' });
        expect(eintrag.vorschlag.matteId).not.toBeNull();
    });

    test('Einsortieren baut den Pool neu auf, die Matte plant neu', async ({ request }) => {
        const resp = await request.post(`/api/pools/nachzuegler/${ids.spaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const nachher = (await holePools(request)).find(p => p.id === poolId);
        expect(nachher.anzahl_teilnehmer).toBe(5);
        expect(nachher.kaempfe.filter(k => k.status !== 'freilos')).toHaveLength(10); // 5er Jeder-gegen-Jeden
        expect(nachher.kaempfe.every(k => k.matten_reihenfolge != null)).toBeTruthy();
        expect((await holeNachzuegler(request)).nachzuegler.some(n => n.teilnehmerId === ids.spaet)).toBe(false);
    });

    test('Nach dem ersten echten Kampf ist der Pool zu: Einsortieren → 409, Sammeln → Sammelpool', async ({ request }) => {
        const kampf = (await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json()).find(k => k.status === 'bereit');
        const beendet = await request.put(`/api/kaempfe/${kampf.id}`, {
            data: { status: 'beendet', sieger_id: kampf.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
        });
        expect(beendet.ok(), await beendet.text()).toBeTruthy();

        ids.zuSpaet = await legeAn(request, 'ZuSpaet', 29.4);
        const resp = await request.post(`/api/pools/nachzuegler/${ids.zuSpaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.status()).toBe(409);

        const eintrag = (await holeNachzuegler(request)).nachzuegler.find(n => n.teilnehmerId === ids.zuSpaet);
        expect(eintrag.vorschlag).toBeNull();

        const gesammelt = await sammeln(request);
        expect((await gesammelt.json()).anzahl).toBe(1);
        const alle = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const sammelpool = (await holePools(request, true)).find(p => p.verspaetet);
        expect(sammelpool).toMatchObject({ bezeichnung: 'Verspätet', anzahl_teilnehmer: 1, modus: 'Nicht startbereit' });
        expect(sammelpool.kampfflaeche_id).toBeNull();
        expect(sammelpool.kaempfe).toHaveLength(0);
        expect(alle.find(t => t.id === ids.zuSpaet).pool_id).toBe(sammelpool.id);

        // idempotent: nichts mehr zu sammeln, kein zweiter Sammelpool
        expect((await (await sammeln(request)).json()).anzahl).toBe(0);
        expect((await holePools(request, true)).filter(p => p.verspaetet)).toHaveLength(1);
    });

    test('Sammelpool fehlt in allen Anzeigen außer der Pool-Verwaltung', async ({ request }) => {
        expect((await holePools(request)).some(p => p.verspaetet)).toBe(false);
        const matten = await (await request.get(`/api/pools/kampfflaechen?turnierId=${turnierId}`)).json();
        expect(matten.pools.some(p => p.verspaetet)).toBe(false);
        const urkunden = await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json();
        expect(JSON.stringify(urkunden)).not.toContain('Verspätet');
        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.ausgelosteAltersklassen).not.toContain('Verspätet');
        const aufteilen = await request.post('/api/pools/aufteilen', { data: { turnierId } });
        expect(aufteilen.status()).toBe(400); // nichts zu verteilen: der Sammelpool wird nie verteilt
    });

    test('Drag&Drop aus dem Sammelpool in einen offenen Pool', async ({ request }) => {
        // zweiter, noch offener Pool derselben Klasse
        for (const [i, g] of [40, 41, 42].entries()) ids[`s${i}`] = await legeAn(request, `Schwer${i}`, g, { gewichtsklasse: '-45' });
        const gen = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'], neuGenerieren: true } });
        expect(gen.status()).toBe(409); // U11 hat schon einen echten Kampf: kein Neu-Generieren
        const offenerPool = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung: 'U11 m -45kg', altersklasse: 'U11', geschlecht: 'männlich', gewichtsklasse: '-45' }
        });
        const offenerPoolId = (await offenerPool.json()).poolId;
        const sammelpool = (await holePools(request, true)).find(p => p.verspaetet);

        const verschoben = await request.post('/api/pools/verschieben', {
            data: { teilnehmerId: ids.zuSpaet, zielPoolId: offenerPoolId, turnierId }
        });
        expect(verschoben.ok(), await verschoben.text()).toBeTruthy();
        const nachher = await holePools(request, true);
        expect(nachher.find(p => p.id === sammelpool.id).kaempfe).toHaveLength(0); // kein Kampfplan für den Sammelpool
        expect(nachher.find(p => p.id === offenerPoolId).anzahl_teilnehmer).toBe(1);

        // in den Pool mit begonnenen Kämpfen geht es nicht
        const zu = await request.post('/api/pools/verschieben', { data: { teilnehmerId: ids.zuSpaet, zielPoolId: poolId, turnierId } });
        expect(zu.status()).toBe(409);
    });

    test('Verschieben mit fremder turnierId wird abgewiesen (Pool-Zuordnung bleibt)', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Verschieben Fremd ${Date.now()}`, ort: 'Halle', datum: '2027-06-15', ausrichter: 'JC Nachzug', anzahl_kampfflaechen: 1 }
        });
        const fremdId = (await resp.json()).turnierId;
        const vorher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(t => t.id === ids.zuSpaet);

        const abgewiesen = await request.post('/api/pools/verschieben', {
            data: { teilnehmerId: ids.zuSpaet, zielPoolId: poolId, turnierId: fremdId }
        });
        expect(abgewiesen.status()).toBe(404);
        const nachher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(t => t.id === ids.zuSpaet);
        expect(nachher.pool_id).toBe(vorher.pool_id);
    });

    test('Einsortieren mit fremder turnierId wird abgewiesen (Teilnehmer bleibt unverändert)', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Nachzügler Fremd ${Date.now()}`, ort: 'Halle', datum: '2027-06-13', ausrichter: 'JC Nachzug', anzahl_kampfflaechen: 1 }
        });
        const fremdId = (await resp.json()).turnierId;
        expect(fremdId).not.toBe(turnierId);
        const teilnehmerVorher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(t => t.id === ids.zuSpaet);
        const poolVorher = teilnehmerVorher.pool_id;

        const abgewiesen = await request.post(`/api/pools/nachzuegler/${ids.zuSpaet}/einsortieren`, { data: { turnierId: fremdId, poolId } });
        expect(abgewiesen.status()).toBe(404);

        const nachher = (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(t => t.id === ids.zuSpaet);
        expect(nachher.pool_id).toBe(poolVorher);
    });
});

test.describe.serial('Nachzügler: Pools-Seite', () => {
    let turnierId;
    const anlegen = async (request, name, gewicht, extra = {}) => {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'UiTest', verein: 'JC Ui',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true, ...extra
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    };

    test('Vorschlag übernehmen und Sammelpool-Zeile', async ({ page, request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Nachzügler UI ${Date.now()}`, ort: 'Halle', datum: '2027-06-14', ausrichter: 'JC Ui', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        for (const [i, g] of [28, 29, 29.5, 30].entries()) await anlegen(request, `Stamm${i}`, g);
        expect((await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } })).ok()).toBeTruthy();
        expect((await request.post('/api/pools/aufteilen', { data: { turnierId } })).ok()).toBeTruthy();

        await anlegen(request, 'Spaet', 29.2);
        await page.goto(`/pools.html?id=${turnierId}`);
        const zeile = page.locator('.nachzuegler-zeile');
        await expect(zeile).toHaveCount(1);
        await expect(zeile).toContainText('Spaet');
        await page.locator('.nachzuegler-uebernehmen').click();
        await expect(page.locator('.nachzuegler-zeile')).toHaveCount(0);

        // Nachzügler ohne passenden Pool (Gewicht weit entfernt): landet automatisch im Sammelpool
        await anlegen(request, 'Schwer', 60, { gewichtsklasse: '-66' });
        await page.reload();
        await expect(page.locator('.pool-sammelpool')).toBeVisible();
        await expect(page.locator('.pool-sammelpool .draggable-athlete')).toHaveCount(1);
    });
});

test.describe.serial('Nachzügler: Robustheit', () => {
    let turnierId;
    const anlegen = async (request, name, gewicht, extra = {}) => {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'Robust', verein: 'JC Robust',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true, ...extra
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    };

    test('Altersklassenwechsel in offenem Pool auf der Matte: Kämpfe behalten eine Mattenreihenfolge', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Robust ${Date.now()}`, ort: 'Halle', datum: '2027-06-16', ausrichter: 'JC Robust', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        const ids = [];
        for (const [i, g] of [28, 29, 29.5, 30].entries()) ids.push(await anlegen(request, `Stamm${i}`, g));
        expect((await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } })).ok()).toBeTruthy();
        expect((await request.post('/api/pools/aufteilen', { data: { turnierId } })).ok()).toBeTruthy();

        const wechsel = await request.put(`/api/teilnehmer/${ids[3]}`, {
            data: {
                vorname: 'Stamm3', nachname: 'Robust', geschlecht: 'männlich', gewicht: 30, altersklasse: 'U13',
                gewichtsklasse: '-30', geburtsjahr: 2016, judopass_id: ''
            }
        });
        expect(wechsel.ok(), await wechsel.text()).toBeTruthy();

        const pools = await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();
        const pool = pools.find(p => p.altersklasse === 'U11');
        expect(pool.anzahl_teilnehmer).toBe(3);
        const echte = pool.kaempfe.filter(k => k.status !== 'freilos');
        expect(echte.length).toBeGreaterThan(0);
        expect(echte.every(k => k.matten_reihenfolge != null), JSON.stringify(pool.kaempfe)).toBeTruthy();
    });

    test('Paralleles Sammeln legt genau einen Sammelpool an', async ({ request }) => {
        await anlegen(request, 'Schwer1', 60, { gewichtsklasse: '-66' });
        await anlegen(request, 'Schwer2', 61, { gewichtsklasse: '-66' });
        const antworten = await Promise.all([1, 2, 3].map(() =>
            request.post('/api/pools/nachzuegler/sammeln', { data: { turnierId } })));
        for (const a of antworten) expect(a.ok(), await a.text()).toBeTruthy();
        const pools = await (await request.get(`/api/pools/details?turnierId=${turnierId}&mitVerspaetet=1`)).json();
        expect(pools.filter(p => p.verspaetet)).toHaveLength(1);
    });
});
