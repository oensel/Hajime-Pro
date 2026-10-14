// End-to-End: Nachzügler in einem bereits laufenden Jeder-gegen-Jeden-Pool
// (docs/specs/2026-10-14-nachzuegler-laufender-pool.md). Regeln:
//  - Das Wettkampfsystem wechselt nach dem ersten Kampf nie; passt der Nachzügler nur mit anderem System,
//    ist der Pool gesperrt und das wird beim Einwiegen (Liste/Dialog) begründet.
//  - Passt er ins System, bekommt er nur zusätzliche Kämpfe gegen alle anderen; bestehende Kämpfe bleiben.
//  - Diese Kämpfe liegen zwischen den übrigen offenen Kämpfen der Matte, nicht hinten angehängt.
//  - Nur solange noch mindestens so viele Kämpfe offen sind, wie er selbst bestreiten müsste.
import { test, expect } from '@playwright/test';
import {
    legeTurnierAn, legeKlasseAn, loseAus, verteileAufMatten,
    holePools, holeKaempfeDerMatte, holeKaempfeDesPools
} from './helpers/turnier-aufbau.js';

const beende = async (request, kampf) => {
    const resp = await request.put(`/api/kaempfe/${kampf.id}`, {
        data: { status: 'beendet', sieger_id: kampf.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
};

test.describe.serial('Nachzügler in laufendem Jeder-gegen-Jeden-Pool', () => {
    let turnierId;
    let matteId;
    let poolId;
    let nachzueglerId;
    let kaempfeVorher;

    const holeNachzuegler = async (request) =>
        (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json()).nachzuegler;

    test('Aufbau: U13-Pool mit vier Teilnehmern, zwei Kämpfe beendet', async ({ request }) => {
        turnierId = await legeTurnierAn(request, { name: 'Nachzügler laufend', anzahlKampfflaechen: 1 });
        await legeKlasseAn(request, turnierId, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 4, gewichtStart: 36 });
        await loseAus(request, turnierId, ['U13']);
        await verteileAufMatten(request, turnierId);

        const pool = (await holePools(request, turnierId))[0];
        poolId = pool.id;
        matteId = pool.kampfflaeche_id;
        expect(pool.modus).toBe('Jeder-gegen-Jeden');

        for (let i = 0; i < 2; i++) {
            const kampf = (await holeKaempfeDesPools(request, poolId)).find(k => k.status === 'bereit');
            await beende(request, kampf);
        }
    });

    test('Nachzügler wird eingewogen: laufender Pool nimmt ihn auf, mit Hinweis auf die zusätzlichen Kämpfe', async ({ request }) => {
        [nachzueglerId] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 1, gewichtStart: 37, namenszusatz: 'Spaet'
        });
        const eintrag = (await holeNachzuegler(request)).find(n => n.teilnehmerId === nachzueglerId);
        expect(eintrag, 'Nachzügler fehlt in der Liste').toBeTruthy();
        expect(eintrag.vorschlag).toMatchObject({ poolId, teilnehmerNachher: 5, systemNachher: 'Jeder-gegen-Jeden' });
        const pool = eintrag.offenePools.find(p => p.poolId === poolId);
        expect(pool).toMatchObject({ moeglich: true, laeuft: true, art: 'einfuegen', neueKaempfe: 4 });
    });

    test('Einsortieren: nur neue Kämpfe, bestehende unverändert, neue zwischen den offenen verteilt', async ({ request }) => {
        kaempfeVorher = await holeKaempfeDesPools(request, poolId);
        expect(kaempfeVorher).toHaveLength(6);

        const resp = await request.post(`/api/pools/nachzuegler/${nachzueglerId}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        expect(await resp.json()).toMatchObject({ eingefuegt: true, neueKaempfe: 4 });

        const nachher = await holeKaempfeDesPools(request, poolId);
        expect(nachher).toHaveLength(10);
        // bestehende Kämpfe: gleiche IDs, gleiche Paarung, gleicher Status
        for (const alt of kaempfeVorher) {
            const neu = nachher.find(k => k.id === alt.id);
            expect(neu, `Kampf ${alt.id} fehlt`).toBeTruthy();
            expect([neu.kaempfer1_id, neu.kaempfer2_id, neu.status]).toEqual([alt.kaempfer1_id, alt.kaempfer2_id, alt.status]);
        }
        // der Nachzügler hat genau 4 Kämpfe, jeder gegen einen anderen Teilnehmer
        const seine = nachher.filter(k => k.kaempfer1_id === nachzueglerId || k.kaempfer2_id === nachzueglerId);
        expect(seine).toHaveLength(4);
        expect(seine.every(k => k.status === 'bereit')).toBeTruthy();
        const gegner = seine.map(k => (k.kaempfer1_id === nachzueglerId ? k.kaempfer2_id : k.kaempfer1_id));
        expect(new Set(gegner).size).toBe(4);

        // Reihenfolge der Matte: seine Kämpfe liegen zwischen den übrigen, nicht am Ende und nicht aufeinanderfolgend
        const warteschlange = (await holeKaempfeDerMatte(request, matteId)).filter(k => k.status === 'bereit');
        const ids = warteschlange.map(k => k.id);
        const seineIds = new Set(seine.map(k => k.id));
        expect(ids.filter(id => seineIds.has(id))).toHaveLength(4);
        expect(seineIds.has(ids[ids.length - 1]), 'letzter Kampf gehört dem Nachzügler').toBe(false);
        const positionen = ids.map((id, i) => (seineIds.has(id) ? i : -1)).filter(i => i >= 0);
        // nicht als Block hinten: zwischen seinem ersten und letzten Kampf liegen reguläre Kämpfe, und seine
        // Kämpfe stehen nie zu mehr als zweit direkt hintereinander (bei wenigen offenen Kämpfen zieht die
        // Pausenregel des Planers zwei Kämpfe zusammen; mehr als zwei ergäbe einen Block für ihn allein)
        const zwischen = ids.slice(positionen[0], positionen[positionen.length - 1] + 1).filter(id => !seineIds.has(id));
        expect(zwischen.length, `Positionen seiner Kämpfe: ${positionen}`).toBeGreaterThanOrEqual(2);
        let laengsteFolge = 1;
        let folge = 1;
        for (let i = 1; i < positionen.length; i++) {
            folge = positionen[i] - positionen[i - 1] === 1 ? folge + 1 : 1;
            laengsteFolge = Math.max(laengsteFolge, folge);
        }
        expect(laengsteFolge, `Positionen seiner Kämpfe: ${positionen}`).toBeLessThanOrEqual(2);
    });

    test('Sechster Teilnehmer: Systemwechsel nach Beginn ist nicht möglich und wird begründet', async ({ request }) => {
        const [sechster] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 1, gewichtStart: 38, namenszusatz: 'Sechs'
        });
        const eintrag = (await holeNachzuegler(request)).find(n => n.teilnehmerId === sechster);
        expect(eintrag.vorschlag).toBeNull();
        const pool = eintrag.offenePools.find(p => p.poolId === poolId);
        expect(pool).toMatchObject({ moeglich: false, laeuft: true });
        expect(pool.grund).toMatch(/Gruppen-Überkreuz statt Jeder-gegen-Jeden/);
        expect(pool.grund).toMatch(/Wechsel des Systems ist nach Beginn nicht möglich/);

        const resp = await request.post(`/api/pools/nachzuegler/${sechster}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.status()).toBe(409);
        expect((await resp.json()).error).toMatch(/Wechsel des Systems/);
        expect(await holeKaempfeDesPools(request, poolId)).toHaveLength(10);
    });

    test('Zu spät: weniger offene Kämpfe, als der Nachzügler bestreiten müsste', async ({ request }) => {
        // eigener kleiner Pool: 3 Teilnehmer = 3 Kämpfe, einer beendet -> 2 offen, der Nachzügler bräuchte 3
        await legeKlasseAn(request, turnierId, { altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: '-44', anzahl: 3, gewichtStart: 40 });
        await loseAus(request, turnierId, ['U15']);
        await verteileAufMatten(request, turnierId);
        const u15 = (await holePools(request, turnierId)).find(p => p.altersklasse === 'U15');
        const kampf = (await holeKaempfeDesPools(request, u15.id)).find(k => k.status === 'bereit');
        await beende(request, kampf);

        const [spaet] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: '-44', anzahl: 1, gewichtStart: 41, namenszusatz: 'Spaet'
        });
        const eintrag = (await holeNachzuegler(request)).find(n => n.teilnehmerId === spaet);
        const pool = eintrag.offenePools.find(p => p.poolId === u15.id);
        expect(pool).toMatchObject({ moeglich: false, laeuft: true });
        expect(pool.grund).toMatch(/noch 2 Kämpfe offen.*müsste 3 bestreiten/);
        expect(eintrag.vorschlag).toBeNull();

        const resp = await request.post(`/api/pools/nachzuegler/${spaet}/einsortieren`, { data: { turnierId, poolId: u15.id } });
        expect(resp.status()).toBe(409);
    });
});

// ---------- Doppel-KO: der Nachzügler nimmt den freien Freilos-Platz ----------
import { spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

test.describe.serial('Nachzügler in laufendem Doppel-KO-8-Pool', () => {
    let turnierId;
    let poolId;

    const kaempfe = async (request) => holeKaempfeDesPools(request, poolId);
    const nach = (liste, nr) => liste.find(k => k.reihenfolge_nummer === nr);
    const holeNachzuegler = async (request) =>
        (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json()).nachzuegler;

    async function baueDoppelKo8(request, name) {
        turnierId = await legeTurnierAn(request, { name, anzahlKampfflaechen: 1 });
        await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50', anzahl: 7, gewichtStart: 46, gewichtSchritt: 0.5
        });
        await loseAus(request, turnierId, ['U15']);
        await verteileAufMatten(request, turnierId);
        const pool = (await holePools(request, turnierId))[0];
        poolId = pool.id;
        expect(pool.modus).toBe('Doppel-KO-8');
        expect(nach(await kaempfe(request), 'H4').status).toBe('freilos'); // 7 Teilnehmer: Freilos auf Platz 8
    }

    test('Einfügen: der Freilos-Platz wird zum Kampf, der Baum läuft mit 8 Teilnehmern zu Ende', async ({ request }) => {
        await baueDoppelKo8(request, 'Nachzügler DK8');
        await beende(request, nach(await kaempfe(request), 'H1'));
        const vorher = await kaempfe(request);
        const partnerId = nach(vorher, 'H4').sieger_id; // rückte kampflos weiter
        expect(partnerId).toBeTruthy();

        const [spaet] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50', anzahl: 1, gewichtStart: 49.5, namenszusatz: 'Spaet'
        });
        const eintrag = (await holeNachzuegler(request)).find(n => n.teilnehmerId === spaet);
        expect(eintrag.vorschlag).toMatchObject({ poolId, teilnehmerNachher: 8, systemNachher: 'Doppel-KO-8' });
        const pool = eintrag.offenePools.find(p => p.poolId === poolId);
        expect(pool).toMatchObject({ moeglich: true, laeuft: true, art: 'einfuegen', neueKaempfe: 1 });
        expect(pool.hinweis).toMatch(/Platz H4 im Turnierbaum/);

        const resp = await request.post(`/api/pools/nachzuegler/${spaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        expect(await resp.json()).toMatchObject({ eingefuegt: true, neueKaempfe: 1, modus: 'Doppel-KO-8' });

        const nachher = await kaempfe(request);
        expect(nachher).toHaveLength(vorher.length); // kein Kampf kommt hinzu: das Freilos wird zum Kampf
        // H4 ist jetzt ein echter Kampf zwischen Partner und Nachzügler; beendete Kämpfe unverändert
        const h4 = nach(nachher, 'H4');
        expect(h4.status).toBe('bereit');
        expect(new Set([h4.kaempfer1_id, h4.kaempfer2_id])).toEqual(new Set([partnerId, spaet]));
        expect(nach(nachher, 'H1')).toMatchObject({ status: 'beendet', sieger_id: nach(vorher, 'H1').sieger_id });
        // der Partner steht nicht mehr kampflos in H6
        const h6 = nach(nachher, 'H6');
        expect([h6.kaempfer1_id, h6.kaempfer2_id]).not.toContain(partnerId);
        expect(h6.status).toBe('angelegt');

        // Baum komplett durchspielen: 8 Teilnehmer = 11 echte Kämpfe, kein Freilos mehr
        await spieleBracketKomplettDurch(request, poolId, 12);
        const fertig = await kaempfe(request);
        expect(fertig.filter(k => k.status === 'beendet')).toHaveLength(11);
        expect(fertig.some(k => k.status === 'freilos')).toBe(false);
        const poolNachher = (await holePools(request, turnierId)).find(p => p.id === poolId);
        expect(poolNachher.status).toBe('kaempfe_beendet');
    });

    test('Gesperrt: der Folgekampf des freien Platzes ist schon ausgetragen', async ({ request }) => {
        await baueDoppelKo8(request, 'Nachzügler DK8 gesperrt');
        for (const nr of ['H1', 'H2', 'H3']) await beende(request, nach(await kaempfe(request), nr));
        const h6 = nach(await kaempfe(request), 'H6');
        expect(h6.status).toBe('bereit'); // H3-Sieger gegen den kampflos weitergekommenen Partner von H4
        await beende(request, h6);

        const [spaet] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50', anzahl: 1, gewichtStart: 49.5, namenszusatz: 'Spaet'
        });
        const eintrag = (await holeNachzuegler(request)).find(n => n.teilnehmerId === spaet);
        expect(eintrag.vorschlag).toBeNull();
        const pool = eintrag.offenePools.find(p => p.poolId === poolId);
        expect(pool).toMatchObject({ moeglich: false, laeuft: true });
        expect(pool.grund).toMatch(/Platz im Turnierbaum \(H4\).*Kampf H6 hat bereits begonnen oder ist beendet/);

        const resp = await request.post(`/api/pools/nachzuegler/${spaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.status()).toBe(409);
        expect((await resp.json()).error).toMatch(/Kampf H6/);
        // der Baum blieb unverändert
        expect(nach(await kaempfe(request), 'H4').status).toBe('freilos');
    });
});

test.describe.serial('Nachzügler in laufendem Doppel-KO-16-Pool', () => {
    test('Einfügen auf dem freien Platz (H7), danach läuft der Baum mit 10 Teilnehmern zu Ende', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, { name: 'Nachzügler DK16', anzahlKampfflaechen: 1 });
        const ids = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-55', anzahl: 9, gewichtStart: 50, gewichtSchritt: 0.4
        });
        await loseAus(request, turnierId, ['U15']);
        await verteileAufMatten(request, turnierId);
        const pool = (await holePools(request, turnierId))[0];
        expect(pool.modus).toBe('Doppel-KO-16');

        // erste Runde teilweise ausgetragen
        const vorher = await holeKaempfeDesPools(request, pool.id);
        for (const nr of ['H1', 'H2']) {
            const k = vorher.find(x => x.reihenfolge_nummer === nr);
            if (k.status === 'bereit') await beende(request, k);
        }
        const [spaet] = await legeKlasseAn(request, turnierId, {
            altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-55', anzahl: 1, gewichtStart: 53.8, namenszusatz: 'Spaet'
        });
        const liste = (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json()).nachzuegler;
        const eintrag = liste.find(n => n.teilnehmerId === spaet);
        expect(eintrag.offenePools.find(p => p.poolId === pool.id)).toMatchObject({ moeglich: true, art: 'einfuegen' });

        const resp = await request.post(`/api/pools/nachzuegler/${spaet}/einsortieren`, { data: { turnierId, poolId: pool.id } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const nachher = await holeKaempfeDesPools(request, pool.id);
        expect(nachher.filter(k => k.status === 'beendet').length).toBeGreaterThanOrEqual(1); // Beendetes bleibt
        const h7 = nachher.find(k => k.reihenfolge_nummer === 'H7');
        expect([h7.kaempfer1_id, h7.kaempfer2_id]).toContain(spaet);

        await spieleBracketKomplettDurch(request, pool.id, 14);
        const fertig = await holeKaempfeDesPools(request, pool.id);
        expect(fertig.every(k => k.status === 'beendet' || k.status === 'freilos')).toBe(true);
        expect((await holePools(request, turnierId)).find(p => p.id === pool.id).status).toBe('kaempfe_beendet');
        // alle 10 Teilnehmer kommen in einem Kampf vor
        const vorkommen = new Set(fertig.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean));
        for (const id of [...ids, spaet]) expect(vorkommen.has(id)).toBe(true);
    });
});

// ---------- Hinweis nach dem Einwiegen muss bestätigt werden ----------
test.describe.serial('Einwiegen: Hinweis zum laufenden Pool muss bestätigt werden', () => {
    let turnierId;
    let poolId;

    async function einwiegen(page, name, gewicht) {
        await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
        await page.locator('#addBtn').click();
        await expect(page.locator('#waageModal')).toBeVisible();
        await page.locator('#vorname').fill(name);
        await page.locator('#nachname').fill('Bestaetigung');
        await page.locator('#judopass_id').fill(`JP-BEST-${name}-${turnierId}`);
        await page.locator('#verein').fill('JC Bestaetigung');
        await page.locator('#geburtsjahr').fill('2014');
        await page.locator('#geschlecht').selectOption('männlich');
        await page.locator('#lizenz_ablauf').fill('2099-12-31');
        await page.locator('#gewicht').fill(String(gewicht).replace('.', ','));
        await page.locator('#altersklasse').selectOption('U13');
        await page.locator('#gewichtsklasse').selectOption({ index: 1 });
        await page.locator('#submitBtn').click();
        await page.locator('#modalConfirmBtn').click();
    }
    const teilnehmerDa = async (request, name) =>
        (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json()).find(t => t.vorname === name);

    test('Aufbau: laufender U13-Pool (4 Teilnehmer, 2 Kämpfe beendet)', async ({ request }) => {
        turnierId = await legeTurnierAn(request, { name: 'Einwiegen Bestätigung', anzahlKampfflaechen: 1 });
        await legeKlasseAn(request, turnierId, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 4, gewichtStart: 36 });
        await loseAus(request, turnierId, ['U13']);
        await verteileAufMatten(request, turnierId);
        poolId = (await holePools(request, turnierId))[0].id;
        for (let i = 0; i < 2; i++) {
            await beende(request, (await holeKaempfeDesPools(request, poolId)).find(k => k.status === 'bereit'));
        }
    });

    test('Laufender Pool: Dialog erst nach Bestätigung bedienbar, Escape schließt nicht', async ({ page, request }) => {
        await einwiegen(page, 'Aufnahme', 37.5);
        const dialog = page.locator('#nachzueglerDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Der Pool läuft');
        await expect(page.locator('#nachzueglerEinsortierenBtn')).toBeDisabled();
        await expect(page.locator('#nachzueglerSpaeterBtn')).toBeDisabled();

        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();

        await page.locator('#nachzueglerBestaetigung').check();
        await expect(page.locator('#nachzueglerEinsortierenBtn')).toBeEnabled();
        await page.locator('#nachzueglerEinsortierenBtn').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await teilnehmerDa(request, 'Aufnahme')).pool_id).toBe(poolId);
        expect(await holeKaempfeDesPools(request, poolId)).toHaveLength(10);
    });

    test('Kein Pool nimmt mehr auf: deutlicher Hinweis, Bestätigung nötig, dann "Später"', async ({ page, request }) => {
        await einwiegen(page, 'Sechster', 38);
        const dialog = page.locator('#nachzueglerDialog');
        await expect(dialog).toBeVisible();
        await expect(page.locator('#nachzueglerKeinPool')).toContainText('Ein Wechsel des Wettkampfsystems ist nach Beginn eines Pools nicht möglich');
        await expect(page.locator('#nachzueglerSperrgruende')).toContainText('Gruppen-Überkreuz statt Jeder-gegen-Jeden');
        await expect(page.locator('#nachzueglerSpaeterBtn')).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();

        await page.locator('#nachzueglerBestaetigung').check();
        await page.locator('#nachzueglerSpaeterBtn').click();
        await expect(dialog).toHaveCount(0);
        expect((await teilnehmerDa(request, 'Sechster')).pool_id).toBeNull();
    });
});
