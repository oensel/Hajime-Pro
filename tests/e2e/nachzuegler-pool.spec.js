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
        const sammelzeile = page.locator('tr.pool-section', { has: page.locator('.pool-name-input[value="Verspätet"]') });
        await expect(sammelzeile).toHaveCount(1);
        await expect(sammelzeile.locator('.draggable-athlete')).toHaveCount(1);

        // Der Sammelpool sieht aus wie jeder andere Pool: gleiche Spalten, gleiche Bedienelemente.
        const normaleZeile = page.locator('tr.pool-section', { has: page.locator('.pool-name-input:not([value="Verspätet"])') }).first();
        await expect(sammelzeile.locator('td')).toHaveCount(await normaleZeile.locator('td').count());
        await expect(sammelzeile.locator('.pool-name-input')).toHaveValue('Verspätet');
        await expect(sammelzeile.locator('.pool-time-select')).toHaveCount(1);
        await expect(sammelzeile.locator('.pool-gs-select')).toHaveCount(1);
        await expect(sammelzeile.locator('.pool-einstellung-label')).toHaveCount(await normaleZeile.locator('.pool-einstellung-label').count());
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

test.describe.serial('Nachzügler: Pool-Auswahl nach dem Speichern', () => {
    let turnierId;
    let poolId;
    const anlegen = async (request, name, gewicht, extra = {}) => {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'Auswahl', verein: 'JC Auswahl',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true, ...extra
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    };
    const alleTeilnehmer = async (request) => (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json());
    const nachVorname = async (request, vorname) => (await alleTeilnehmer(request)).find(t => t.vorname === vorname);
    const nachzuegler = async (request) =>
        (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json()).nachzuegler;

    async function neuesFormular(page, name, gewicht, geburtsjahr = '2016', altersklasse = 'U11') {
        await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
        await page.locator('#addBtn').click();
        await expect(page.locator('#waageModal')).toBeVisible();
        await page.locator('#vorname').fill(name);
        await page.locator('#nachname').fill('Auswahl');
        await page.locator('#judopass_id').fill(`JP-AUSWAHL-${name}-${turnierId}`);
        await page.locator('#verein').fill('JC Auswahl');
        await page.locator('#geburtsjahr').fill(geburtsjahr);
        await page.locator('#geschlecht').selectOption('männlich');
        await page.locator('#lizenz_ablauf').fill('2099-12-31');
        await page.locator('#gewicht').fill(String(gewicht).replace('.', ','));
        await page.locator('#altersklasse').selectOption(altersklasse);
        await page.locator('#gewichtsklasse').selectOption({ index: 1 });
        await page.locator('#submitBtn').click();
        await page.locator('#modalConfirmBtn').click();
    }

    test('Aufbau: U11 ausgelost, offene Pools samt Vorschlag in der Nachzügler-Liste', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Auswahl ${Date.now()}`, ort: 'Halle', datum: '2027-06-18', ausrichter: 'JC Auswahl', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        for (const [i, g] of [28, 29, 29.5, 30].entries()) await anlegen(request, `Stamm${i}`, g);
        for (const [i, g] of [50, 51].entries()) await anlegen(request, `Schwer${i}`, g, { gewichtsklasse: '-55' });
        expect((await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } })).ok()).toBeTruthy();
        expect((await request.post('/api/pools/aufteilen', { data: { turnierId } })).ok()).toBeTruthy();
        const pools = await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();
        poolId = pools.find(p => p.teilnehmer.some(t => t.vorname === 'Stamm0')).id;

        const spaet = await anlegen(request, 'Probe', 29.2);
        const eintrag = (await nachzuegler(request)).find(n => n.teilnehmerId === spaet);
        expect(eintrag.vorschlag.poolId).toBe(poolId);
        expect(eintrag.offenePools[0]).toMatchObject({ poolId, gleicheAltersklasse: true, gewichtsspanneUeberschritten: false });
        expect(eintrag.offenePools.length).toBeGreaterThanOrEqual(2);
        const andere = eintrag.offenePools.find(p => p.poolId !== poolId);
        expect(andere.gewichtsspanneUeberschritten).toBe(true);
    });

    test('POST /verspaetet legt genau diesen Teilnehmer in den Sammelpool; fremdes Turnier -> 404', async ({ request }) => {
        const id = (await nachVorname(request, 'Probe')).id;
        const anderesTurnier = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Fremd ${Date.now()}`, ort: 'Halle', datum: '2027-06-19', ausrichter: 'JC Auswahl', anzahl_kampfflaechen: 1 }
        });
        const fremdId = (await anderesTurnier.json()).turnierId;
        const fremd = await request.post(`/api/pools/nachzuegler/${id}/verspaetet`, { data: { turnierId: fremdId } });
        expect(fremd.status()).toBe(404);

        const ok = await request.post(`/api/pools/nachzuegler/${id}/verspaetet`, { data: { turnierId } });
        expect(ok.ok(), await ok.text()).toBeTruthy();
        const sammelpools = (await (await request.get(`/api/pools/details?turnierId=${turnierId}&mitVerspaetet=1`)).json()).filter(p => p.verspaetet);
        expect(sammelpools).toHaveLength(1);
        expect(sammelpools[0].teilnehmer.map(t => t.id)).toEqual([id]);
        const doppelt = await request.post(`/api/pools/nachzuegler/${id}/verspaetet`, { data: { turnierId } });
        expect(doppelt.status()).toBe(409);
    });

    test('Dialog nach dem Speichern: Vorschlag vorgewählt, "Einsortieren" setzt in den Pool', async ({ page, request }) => {
        await neuesFormular(page, 'Dialog', 29.3);
        const dialog = page.locator('#nachzueglerDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('In welchen Pool soll Dialog Auswahl');
        await expect(page.locator('#nachzueglerPoolSelect')).toHaveValue(String(poolId));
        await expect(page.locator('#nachzueglerPoolSelect option:checked')).toContainText('Vorschlag');
        await page.locator('#nachzueglerEinsortierenBtn').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await nachVorname(request, 'Dialog')).pool_id).toBe(poolId);
    });

    test('"Später" lässt den Teilnehmer in der Nachzügler-Liste', async ({ page, request }) => {
        await neuesFormular(page, 'Spaeter', 29.4);
        await expect(page.locator('#nachzueglerDialog')).toBeVisible();
        await page.locator('#nachzueglerSpaeterBtn').click();
        await expect(page.locator('#nachzueglerDialog')).toHaveCount(0);
        const t = await nachVorname(request, 'Spaeter');
        expect((await nachzuegler(request)).some(n => n.teilnehmerId === t.id)).toBe(true);
        expect(t.pool_id).toBeNull();
    });

    test('Auswahl "Verspätet (Sammelpool)" im Dialog', async ({ page, request }) => {
        await neuesFormular(page, 'Sammel', 29.5);
        await page.locator('#nachzueglerPoolSelect').selectOption('verspaetet');
        await page.locator('#nachzueglerEinsortierenBtn').click();
        const sammelpool = (await (await request.get(`/api/pools/details?turnierId=${turnierId}&mitVerspaetet=1`)).json()).find(p => p.verspaetet);
        await expect.poll(async () => (await nachVorname(request, 'Sammel')).pool_id).toBe(sammelpool.id);
    });

    test('Kein Dialog für eine nicht ausgeloste Altersklasse', async ({ page, request }) => {
        await neuesFormular(page, 'Jung', 40, '2014', 'U13');
        await expect.poll(async () => Boolean(await nachVorname(request, 'Jung'))).toBe(true);
        await expect(page.locator('#nachzueglerDialog')).toHaveCount(0);
    });
});
