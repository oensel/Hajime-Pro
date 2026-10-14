// Mannschafts-Pool mit 6 Teams auf zwei Matten: Begegnungen werden rundenweise verteilt, eine
// Begegnung bleibt immer ganz auf einer Matte, Runde n+1 beginnt erst nach Runde n.
import { test, expect } from '@playwright/test';

test.describe.serial('Mannschaften: Pool auf mehrere Matten', () => {
    let turnierId;
    let poolId;
    let matten = [];

    test('Turnier, 6 Teams und zwei Matten aufbauen', async ({ request }) => {
        const t = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Mehrere Matten ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC M', anzahl_kampfflaechen: 2 }
        });
        turnierId = (await t.json()).turnierId;
        matten = (await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json()).map(m => m.id);
        expect(matten).toHaveLength(2);

        const p = await request.post('/api/pools', {
            data: {
                turnier_id: turnierId, bezeichnung: 'Team-Pool', modus: 'Jeder-gegen-Jeden', altersklasse: 'U18',
                geschlecht: 'männlich', typ: 'mannschaft', mannschafts_gewichtsklassen: ['-73'], kampfzeit_sekunden: 180
            }
        });
        poolId = (await p.json()).poolId;

        for (let i = 1; i <= 6; i++) {
            const tm = await request.post('/api/mannschaften', { data: { turnier_id: turnierId, pool_id: poolId, verein: `JC ${i}`, bezeichnung: `Team ${i}` } });
            const { mannschaftId } = await tm.json();
            const tn = await request.post('/api/teilnehmer', {
                data: { turnier_id: turnierId, vorname: `K${i}`, nachname: 'Judoka', geschlecht: 'männlich', verein: `JC ${i}`, geburtsjahr: 2007, gewicht: 70, altersklasse: 'U18' }
            });
            const { teilnehmerId } = await tn.json();
            const m = await request.post(`/api/mannschaften/${mannschaftId}/mitglieder`, { data: { turnier_teilnehmer_id: teilnehmerId } });
            expect(m.ok(), await m.text()).toBeTruthy();
        }
    });

    test('Verteilung: 15 Begegnungen, 5 Runden à 3, beide Matten genutzt, kein Team doppelt je Runde', async ({ request }) => {
        const r = await request.put(`/api/mannschaften/pools/${poolId}/matten`, { data: { kampfflaechen: matten } });
        expect(r.ok(), await r.text()).toBeTruthy();

        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        expect(begegnungen).toHaveLength(15);
        const nachRunde = new Map();
        for (const b of begegnungen) {
            expect(matten).toContain(b.kampfflaeche_id);
            if (!nachRunde.has(b.runde)) nachRunde.set(b.runde, []);
            nachRunde.get(b.runde).push(b);
        }
        expect([...nachRunde.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
        for (const liste of nachRunde.values()) {
            expect(liste).toHaveLength(3);
            const teams = liste.flatMap(b => [b.mannschaft1_id, b.mannschaft2_id]);
            expect(new Set(teams).size).toBe(6);
        }
        const jeMatte = matten.map(m => begegnungen.filter(b => b.kampfflaeche_id === m).length);
        expect(Math.abs(jeMatte[0] - jeMatte[1])).toBeLessThanOrEqual(1);

        // Einzelkämpfe erben die Matte ihrer Begegnung.
        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
        for (const k of kaempfe) {
            const b = begegnungen.find(x => x.id === k.mannschaftskampf_id);
            expect(k.kampfflaeche_id).toBe(b.kampfflaeche_id);
        }
    });

    test('Mattenlisten: nur Runde 1 ist eingeplant, jede Matte zeigt nur ihre Begegnungen', async ({ request }) => {
        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        for (const matte of matten) {
            const liste = await (await request.get(`/api/kaempfe?kampfflaecheId=${matte}`)).json();
            expect(liste.length).toBeGreaterThan(0);
            for (const k of liste) {
                const b = begegnungen.find(x => x.id === k.mannschaftskampf_id);
                expect(b.kampfflaeche_id).toBe(matte);
                if (k.matten_reihenfolge != null) expect(b.runde).toBe(1);
            }
            expect(liste.some(k => k.matten_reihenfolge != null)).toBeTruthy();
        }
    });

    test('Nach Ende von Runde 1 wird Runde 2 freigegeben', async ({ request }) => {
        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        const runde1 = new Set(begegnungen.filter(b => b.runde === 1).map(b => b.id));
        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
        for (const k of kaempfe.filter(k => runde1.has(k.mannschaftskampf_id))) {
            const r = await request.put(`/api/kaempfe/${k.id}`, {
                data: { status: 'beendet', sieger_id: k.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
            });
            expect(r.ok(), await r.text()).toBeTruthy();
        }
        const runde2 = new Set(begegnungen.filter(b => b.runde === 2).map(b => b.id));
        let eingeplant = 0;
        for (const matte of matten) {
            const liste = await (await request.get(`/api/kaempfe?kampfflaecheId=${matte}`)).json();
            eingeplant += liste.filter(k => runde2.has(k.mannschaftskampf_id) && k.status === 'bereit' && k.matten_reihenfolge != null).length;
        }
        expect(eingeplant).toBe(3);
    });

    test('Einzelne Begegnung auf andere Matte verschieben, Zurücknehmen', async ({ request }) => {
        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        const b = begegnungen.find(x => x.runde === 3);
        const ziel = matten.find(m => m !== b.kampfflaeche_id);
        const r = await request.put(`/api/mannschaftskaempfe/${b.id}/matte`, { data: { kampfflaecheId: ziel } });
        expect(r.ok(), await r.text()).toBeTruthy();
        const danach = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        expect(danach.find(x => x.id === b.id).kampfflaeche_id).toBe(ziel);

        // Bereits begonnene Runde 1 ist nicht mehr verschiebbar.
        const alt = begegnungen.find(x => x.runde === 1);
        const abgelehnt = await request.put(`/api/mannschaftskaempfe/${alt.id}/matte`, { data: { kampfflaecheId: ziel } });
        expect(abgelehnt.status()).toBe(409);
    });

    test('Oberfläche: Matten-Knopf und Matten-Auswahl je Begegnung', async ({ page }) => {
        await page.goto(`/mannschaften.html?turnierId=${turnierId}`);
        await expect(page.locator('.pool-matten-btn')).toHaveCount(1);
        await expect(page.locator('.begegnung-matte-select').first()).toBeVisible();
        await expect(page.locator('.begegnung-runde').first()).toContainText('Runde');
        await page.locator('.pool-matten-btn').click();
        await expect(page.locator('#mattenModal')).toBeVisible();
        await expect(page.locator('#mattenAuswahl input:checked')).toHaveCount(2);
    });
});

test.describe.serial('Mannschaften: Doppel-KO-8 auf zwei Matten', () => {
    let turnierId;
    let poolId;
    let matten = [];

    test('Turnier mit 6 Teams im Doppel-KO-8, Verteilung auf zwei Matten', async ({ request }) => {
        const t = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E DKO Matten ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC D', anzahl_kampfflaechen: 2 }
        });
        turnierId = (await t.json()).turnierId;
        matten = (await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json()).map(m => m.id);

        const p = await request.post('/api/pools', {
            data: {
                turnier_id: turnierId, bezeichnung: 'DKO-Pool', modus: 'Doppel-KO-8', altersklasse: 'U18',
                geschlecht: 'männlich', typ: 'mannschaft', mannschafts_gewichtsklassen: ['-73'], kampfzeit_sekunden: 180
            }
        });
        poolId = (await p.json()).poolId;
        for (let i = 1; i <= 6; i++) {
            const tm = await request.post('/api/mannschaften', { data: { turnier_id: turnierId, pool_id: poolId, verein: `JC ${i}`, bezeichnung: `Team ${i}` } });
            const { mannschaftId } = await tm.json();
            const tn = await request.post('/api/teilnehmer', {
                data: { turnier_id: turnierId, vorname: `D${i}`, nachname: 'Judoka', geschlecht: 'männlich', verein: `JC ${i}`, geburtsjahr: 2007, gewicht: 70, altersklasse: 'U18' }
            });
            const { teilnehmerId } = await tn.json();
            await request.post(`/api/mannschaften/${mannschaftId}/mitglieder`, { data: { turnier_teilnehmer_id: teilnehmerId } });
        }
        const r = await request.put(`/api/mannschaften/pools/${poolId}/matten`, { data: { kampfflaechen: matten } });
        expect(r.ok(), await r.text()).toBeTruthy();

        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        expect(begegnungen.every(b => b.runde != null)).toBeTruthy();
        // Folgebegegnungen liegen in einer späteren Runde als ihre Quellen.
        const nachId = new Map(begegnungen.map(b => [b.id, b]));
        for (const b of begegnungen) {
            for (const q of [b.mannschaft1_quelle_kampf_id, b.mannschaft2_quelle_kampf_id]) {
                if (q != null) expect(b.runde).toBeGreaterThan(nachId.get(q).runde);
            }
        }
        const echte = begegnungen.filter(b => b.status !== 'freilos');
        expect(new Set(echte.map(b => b.kampfflaeche_id))).toEqual(new Set(matten));
    });

    test('Turnier lässt sich über beide Matten komplett durchspielen', async ({ request }) => {
        for (let durchlauf = 0; durchlauf < 20; durchlauf++) {
            const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
            const bereit = kaempfe.filter(k => k.status === 'bereit');
            if (bereit.length === 0) break;
            for (const k of bereit) {
                const r = await request.put(`/api/kaempfe/${k.id}`, {
                    data: { status: 'beendet', sieger_id: k.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
                });
                expect(r.ok(), await r.text()).toBeTruthy();
            }
        }
        const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
        expect(begegnungen.every(b => b.status === 'beendet' || b.status === 'freilos')).toBeTruthy();
        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
        for (const k of kaempfe) {
            expect(k.kampfflaeche_id).toBe(begegnungen.find(b => b.id === k.mannschaftskampf_id).kampfflaeche_id);
        }
        const pools = await (await request.get(`/api/mannschaften/pools?turnierId=${turnierId}`)).json();
        expect(pools.find(p => p.id === poolId).status).toBe('kaempfe_beendet');
    });
});

test.describe.serial('Mannschaften: freie Teams dürfen der Runde vorauseilen', () => {
    let turnierId;
    let poolId;
    let matten = [];

    test('Aufbau: 6 Teams, Jeder gegen Jeden, zwei Matten', async ({ request }) => {
        const t = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Vorauseilen ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC V', anzahl_kampfflaechen: 2 }
        });
        turnierId = (await t.json()).turnierId;
        matten = (await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json()).map(m => m.id);
        const p = await request.post('/api/pools', {
            data: {
                turnier_id: turnierId, bezeichnung: 'V-Pool', modus: 'Jeder-gegen-Jeden', altersklasse: 'U18',
                geschlecht: 'männlich', typ: 'mannschaft', mannschafts_gewichtsklassen: ['-73'], kampfzeit_sekunden: 180
            }
        });
        poolId = (await p.json()).poolId;
        for (let i = 1; i <= 6; i++) {
            const tm = await request.post('/api/mannschaften', { data: { turnier_id: turnierId, pool_id: poolId, verein: `JC ${i}`, bezeichnung: `Team ${i}` } });
            const { mannschaftId } = await tm.json();
            const tn = await request.post('/api/teilnehmer', {
                data: { turnier_id: turnierId, vorname: `V${i}`, nachname: 'Judoka', geschlecht: 'männlich', verein: `JC ${i}`, geburtsjahr: 2007, gewicht: 70, altersklasse: 'U18' }
            });
            const { teilnehmerId } = await tn.json();
            await request.post(`/api/mannschaften/${mannschaftId}/mitglieder`, { data: { turnier_teilnehmer_id: teilnehmerId } });
        }
        const r = await request.put(`/api/mannschaften/pools/${poolId}/matten`, { data: { kampfflaechen: matten } });
        expect(r.ok(), await r.text()).toBeTruthy();
    });

    test('Eine Begegnung ist genau dann eingeplant, wenn ihre Teams in früheren Runden frei sind', async ({ request }) => {
        const holeZustand = async () => {
            const begegnungen = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
            const eingeplant = new Set();
            for (const matte of matten) {
                const liste = await (await request.get(`/api/kaempfe?kampfflaecheId=${matte}`)).json();
                liste.filter(k => k.status === 'bereit' && k.matten_reihenfolge != null).forEach(k => eingeplant.add(k.mannschaftskampf_id));
            }
            return { begegnungen, eingeplant };
        };
        const erwartet = (begegnungen) => new Set(begegnungen
            .filter(b => b.status === 'bereit' && !begegnungen.some(c =>
                c.id !== b.id && c.runde < b.runde && c.status !== 'beendet' && c.status !== 'freilos'
                && [c.mannschaft1_id, c.mannschaft2_id].some(t => t === b.mannschaft1_id || t === b.mannschaft2_id)))
            .map(b => b.id));

        let vorausgeeilt = false;
        for (let schritt = 0; schritt < 3; schritt++) {
            const { begegnungen, eingeplant } = await holeZustand();
            expect([...eingeplant].sort()).toEqual([...erwartet(begegnungen)].sort());
            if ([...eingeplant].some(id => begegnungen.find(b => b.id === id).runde > 1)) vorausgeeilt = true;

            // Genau eine weitere Begegnung der frühesten offenen Runde beenden.
            const offene = begegnungen.filter(b => b.status === 'bereit' && b.runde === 1);
            if (offene.length === 0) break;
            const kaempfe = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
            for (const k of kaempfe.filter(k => k.mannschaftskampf_id === offene[0].id && k.status === 'bereit')) {
                const r = await request.put(`/api/kaempfe/${k.id}`, {
                    data: { status: 'beendet', sieger_id: k.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
                });
                expect(r.ok(), await r.text()).toBeTruthy();
            }
        }
        // Nach den ersten Begegnungen der Runde 1 gibt es nichts Vorauseilendes, nach allen dreien Runde 2.
        const { begegnungen, eingeplant } = await holeZustand();
        expect([...eingeplant].sort()).toEqual([...erwartet(begegnungen)].sort());
        expect([...eingeplant].every(id => begegnungen.find(b => b.id === id).runde === 2)).toBeTruthy();
        expect(eingeplant.size).toBe(3);
        void vorausgeeilt;
    });
});

test('Menü: "Matte" ist aktiv, sobald nur ein Mannschafts-Pool existiert', async ({ request, page }) => {
    const t = await request.post('/api/turniere', {
        data: { bezeichnung: `E2E Menue Matte ${Date.now()}`, ort: 'Halle', datum: '2027-06-01', ausrichter: 'JC M', anzahl_kampfflaechen: 1 }
    });
    const turnierId = (await t.json()).turnierId;

    await page.goto(`/mannschaften.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-matten')).toHaveClass(/disabled/);

    const p = await request.post('/api/pools', {
        data: {
            turnier_id: turnierId, bezeichnung: 'Nur-Team', modus: 'Jeder-gegen-Jeden', altersklasse: 'U18',
            geschlecht: 'männlich', typ: 'mannschaft', mannschafts_gewichtsklassen: ['-73'], kampfzeit_sekunden: 180
        }
    });
    expect(p.ok()).toBeTruthy();

    await page.goto(`/mannschaften.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-matten')).not.toHaveClass(/disabled/);
});
