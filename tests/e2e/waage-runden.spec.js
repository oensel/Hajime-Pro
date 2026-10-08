// End-to-End: Waage in Runden (docs/specs/2026-10-08-waage-runden-design.md). Ein Turnier mit zwei
// Matten und drei Runden (U11/U13 -> U15 -> U18): pro Runde werden nur die gewählten Altersklassen
// ausgelost und ihre neuen Pools an die Matten angehängt, frühere Pools bleiben unberührt; noch nicht
// gewogene Teilnehmer anderer Klassen bleiben "angemeldet" und lassen sich auch nach den ersten
// Kämpfen noch einwiegen. Läuft über die HTTP-API (IS_OFFLINE: keine Anmeldung nötig) plus je einen
// Test für den Auswahl-Dialog auf pools.html und die Matten-Buttons.
import { test, expect } from '@playwright/test';

const WETTKAMPFTAG = '2027-05-15';

test.describe.serial('Waage in Runden', () => {
    let turnierId;
    const teilnehmer = {}; // altersklasse -> [{ id, status }]

    async function legeTeilnehmerAn(request, altersklasse, index, { gewogen, gewichtsklasse }) {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: `Vor${altersklasse}${index}`, nachname: `Nach${altersklasse}${index}`,
                verein: `Verein ${index % 2}`, geburtsjahr: 2010, geschlecht: 'männlich',
                gewicht: 28 + index, altersklasse, gewichtsklasse,
                lizenz_ablauf: '2099-12-31', gewogen
            }
        });
        return { resp, body: await resp.json() };
    }

    async function fuelleKlasse(request, altersklasse, anzahlGewogen, anzahlOffen, gewichtsklasse) {
        teilnehmer[altersklasse] = [];
        for (let i = 0; i < anzahlGewogen + anzahlOffen; i++) {
            const { resp, body } = await legeTeilnehmerAn(request, altersklasse, i, {
                gewogen: i < anzahlGewogen, gewichtsklasse
            });
            expect(resp.ok(), JSON.stringify(body)).toBeTruthy();
            teilnehmer[altersklasse].push(body.teilnehmerId);
        }
    }

    const holeTeilnehmer = async (request) => (await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json());
    const holePools = async (request) => (await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json());
    const holeStatus = async (request) => (await (await request.get(`/api/pools/altersklassen-status?turnierId=${turnierId}`)).json()).altersklassen;
    const generiere = (request, data) => request.post('/api/pools/generieren', { data: { turnierId, ...data } });
    const holeKampfIds = async (request, pools) => {
        const ids = [];
        for (const p of pools) {
            const kaempfe = await (await request.get(`/api/kaempfe?poolId=${p.id}`)).json();
            ids.push(...kaempfe.map(k => k.id));
        }
        return ids;
    };
    const zuordnung = (pools) => Object.fromEntries(pools.map(p => [p.id, [p.kampfflaeche_id, p.matte_reihenfolge]]));

    test('Turnier und Teilnehmer der drei Runden anlegen', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Waage in Runden ${Date.now()}`, ort: 'Halle', datum: WETTKAMPFTAG, ausrichter: 'JC Runden', anzahl_kampfflaechen: 2 }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        turnierId = (await resp.json()).turnierId;

        await fuelleKlasse(request, 'U11', 4, 1, '-30');
        await fuelleKlasse(request, 'U13', 3, 0, '-40');
        await fuelleKlasse(request, 'U15', 0, 4, '-50');
        await fuelleKlasse(request, 'U18', 0, 3, '-60');
    });

    test('Status zeigt je Altersklasse die Eingewogenen; nur U11/U13 sind auslosbar', async ({ request }) => {
        const status = await holeStatus(request);
        const nachKlasse = Object.fromEntries(status.map(s => [s.altersklasse, s]));
        expect(nachKlasse.U11).toMatchObject({ kampfbereit: 4, angemeldet: 1, gesamt: 5, ausgelost: false, hatEchteKaempfe: false });
        expect(nachKlasse.U13).toMatchObject({ kampfbereit: 3, ausgelost: false });
        expect(nachKlasse.U15).toMatchObject({ kampfbereit: 0, angemeldet: 4 });
        expect(nachKlasse.U18).toMatchObject({ kampfbereit: 0, angemeldet: 3 });
    });

    test('Generieren ohne eingewogene Teilnehmer der Auswahl wird abgewiesen, leere Auswahl ebenso', async ({ request }) => {
        const keine = await generiere(request, { altersklassen: ['U15'] });
        expect(keine.status()).toBe(400);
        const leer = await generiere(request, { altersklassen: [] });
        expect(leer.status()).toBe(400);
        expect((await holePools(request))).toHaveLength(0);
    });

    test('Runde 1: U11 und U13 werden ausgelost, U15/U18 bleiben angemeldet', async ({ request }) => {
        const resp = await generiere(request, { altersklassen: ['U11', 'U13'] });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const pools = await holePools(request);
        expect(pools.length).toBeGreaterThanOrEqual(2);
        expect(new Set(pools.map(p => p.altersklasse))).toEqual(new Set(['U11', 'U13']));

        const alle = await holeTeilnehmer(request);
        const status = (id) => alle.find(t => t.id === id).status;
        // der nicht gewogene U11-Teilnehmer gilt als nicht erschienen, die übrigen Klassen wiegen weiter
        expect(status(teilnehmer.U11[4])).toBe('nicht_erschienen');
        for (const id of [...teilnehmer.U15, ...teilnehmer.U18]) expect(status(id)).toBe('angemeldet');
        for (const id of teilnehmer.U11.slice(0, 4)) expect(status(id)).toBe('kampfbereit');
    });

    test('Ausgeloste Altersklasse ist ohne Neu-Generieren abgewiesen (409), Nachmeldung ebenso', async ({ request }) => {
        const doppelt = await generiere(request, { altersklassen: ['U11'] });
        expect(doppelt.status()).toBe(409);

        const { resp } = await legeTeilnehmerAn(request, 'U11', 99, { gewogen: true, gewichtsklasse: '-30' });
        expect(resp.status()).toBe(409);

        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.ausgelosteAltersklassen).toEqual(['U11', 'U13']);
        expect(vorhanden.gesperrteAltersklassen).toEqual([]);
        expect(vorhanden.gesperrt).toBe(false);
    });

    test('Pools aufteilen (Runde 1) verteilt die neuen Pools auf die Matten', async ({ request }) => {
        const resp = await request.post('/api/pools/aufteilen', { data: { turnierId } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const pools = await holePools(request);
        expect(pools.every(p => p.kampfflaeche_id)).toBeTruthy();
    });

    let zuordnungNachRunde1;
    let ersterKampfPoolId;

    test('Ein U11-Kampf wird beendet: Klasse U11 ist gesperrt, andere Klassen nicht', async ({ request }) => {
        const pools = await holePools(request);
        zuordnungNachRunde1 = zuordnung(pools);
        const u11Pool = pools.find(p => p.altersklasse === 'U11');
        ersterKampfPoolId = u11Pool.id;

        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${u11Pool.id}`)).json();
        const kampf = kaempfe.find(k => k.status === 'bereit');
        expect(kampf, 'kein spielbarer U11-Kampf').toBeTruthy();
        const resp = await request.put(`/api/kaempfe/${kampf.id}`, {
            data: { status: 'beendet', sieger_id: kampf.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.gesperrteAltersklassen).toEqual(['U11']);
        expect(vorhanden.gesperrt).toBe(true);
        expect(vorhanden.mannschaftenGesperrt).toBe(false);
    });

    test('Laufende Einzelkämpfe sperren Mannschaften nicht (erst ein laufender Mannschafts-Pool)', async ({ request }) => {
        const resp = await request.post('/api/mannschaften', {
            data: { turnier_id: turnierId, bezeichnung: 'Team Runden', verein: 'JC Runden' }
        });
        expect(resp.status(), await resp.text()).toBe(201);
    });

    test('Teilnehmer gesperrter Klassen sind gesperrt, offene Klassen bleiben bearbeitbar', async ({ request }) => {
        const gesperrt = await request.delete(`/api/teilnehmer/${teilnehmer.U11[0]}`);
        expect(gesperrt.status()).toBe(409);
        const aendern = await request.put(`/api/teilnehmer/${teilnehmer.U11[0]}`, { data: { vorname: 'Neu', nachname: 'Name' } });
        expect(aendern.status()).toBe(409);

        // Einwiegen in U15, obwohl U11 bereits kämpft
        for (const id of teilnehmer.U15.slice(0, 3)) {
            const wiegen = await request.put(`/api/teilnehmer/${id}/status`, { data: { gewogen: true, lizenz_ablauf: '2099-12-31' } });
            expect(wiegen.ok(), await wiegen.text()).toBeTruthy();
        }
        const loeschen = await request.delete(`/api/teilnehmer/${teilnehmer.U15[3]}`);
        expect(loeschen.ok(), await loeschen.text()).toBeTruthy();
        teilnehmer.U15.pop();
    });

    test('Neu-Generieren einer Klasse mit echten Kämpfen ist abgewiesen', async ({ request }) => {
        const resp = await generiere(request, { altersklassen: ['U11'], neuGenerieren: true });
        expect(resp.status()).toBe(409);
    });

    test('Runde 2: U15 wird ausgelost, frühere Pools bleiben unverändert', async ({ request }) => {
        const vorher = await holePools(request);
        const kampfIdsVorher = await holeKampfIds(request, vorher);
        const resp = await generiere(request, { altersklassen: ['U15'] });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const nachher = await holePools(request);
        const neuePools = nachher.filter(p => !vorher.some(v => v.id === p.id));

        // IDs werden fortgesetzt, nie doppelt vergeben: frühere Pool-/Kampf-IDs bleiben, neue liegen dahinter
        expect(new Set(nachher.map(p => p.id)).size).toBe(nachher.length);
        const hoechstePoolId = Math.max(...vorher.map(p => p.id));
        expect(neuePools.every(p => p.id > hoechstePoolId)).toBeTruthy();
        const kampfIdsNachher = await holeKampfIds(request, nachher);
        expect(new Set(kampfIdsNachher).size).toBe(kampfIdsNachher.length);
        for (const id of kampfIdsVorher) expect(kampfIdsNachher).toContain(id);
        const hoechsteKampfId = Math.max(...kampfIdsVorher);
        const neueKampfIds = kampfIdsNachher.filter(id => !kampfIdsVorher.includes(id));
        expect(neueKampfIds.length).toBeGreaterThan(0);
        expect(neueKampfIds.every(id => id > hoechsteKampfId)).toBeTruthy();
        expect(neuePools.length).toBeGreaterThanOrEqual(1);
        expect(neuePools.every(p => p.altersklasse === 'U15')).toBeTruthy();
        expect(neuePools.every(p => !p.kampfflaeche_id)).toBeTruthy();
        // bestehende Pools samt Matten und Reihenfolge unverändert
        expect(zuordnung(nachher.filter(p => vorher.some(v => v.id === p.id)))).toEqual(zuordnungNachRunde1);

        // der Kampf in U11 ist erhalten
        const kaempfe = await (await request.get(`/api/kaempfe?poolId=${ersterKampfPoolId}`)).json();
        expect(kaempfe.some(k => k.status === 'beendet')).toBeTruthy();

        // U18 wurde nicht angefasst
        const alle = await holeTeilnehmer(request);
        for (const id of teilnehmer.U18) expect(alle.find(t => t.id === id).status).toBe('angemeldet');
    });

    test('Pools aufteilen hängt nur die neuen Pools an, bestehende Zuordnungen bleiben', async ({ request }) => {
        const resp = await request.post('/api/pools/aufteilen', { data: { turnierId, modus: 'neue' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const pools = await holePools(request);
        expect(pools.every(p => p.kampfflaeche_id)).toBeTruthy();
        const bestehende = pools.filter(p => zuordnungNachRunde1[p.id]);
        expect(zuordnung(bestehende)).toEqual(zuordnungNachRunde1);

        // Reihenfolge der U15-Pools auf jeder Matte liegt hinter allen früheren Pools dieser Matte
        for (const p of pools.filter(q => q.altersklasse === 'U15')) {
            const frueher = bestehende.filter(b => b.kampfflaeche_id === p.kampfflaeche_id);
            for (const b of frueher) expect(p.matte_reihenfolge).toBeGreaterThan(b.matte_reihenfolge);
        }

        // erneut aufrufen: nichts mehr zu verteilen
        const nochmal = await request.post('/api/pools/aufteilen', { data: { turnierId, modus: 'neue' } });
        expect(nochmal.status()).toBe(400);
        expect((await nochmal.json()).error).toBe('Es sind keine weiteren Pools zur Verteilung bereit.');
    });

    test('Neu-Generieren von U15 (ohne Kämpfe) betrifft nur U15', async ({ request }) => {
        const vorher = await holePools(request);
        const resp = await generiere(request, { altersklassen: ['U15'], neuGenerieren: true });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const nachher = await holePools(request);
        const unveraendert = nachher.filter(p => p.altersklasse !== 'U15');
        expect(zuordnung(unveraendert)).toEqual(zuordnung(vorher.filter(p => p.altersklasse !== 'U15')));
        expect(nachher.some(p => p.altersklasse === 'U15')).toBeTruthy();
    });

    test('Runde 3: U18 einwiegen und auslosen', async ({ request }) => {
        for (const id of teilnehmer.U18) {
            const wiegen = await request.put(`/api/teilnehmer/${id}/status`, { data: { gewogen: true, lizenz_ablauf: '2099-12-31' } });
            expect(wiegen.ok(), await wiegen.text()).toBeTruthy();
        }
        const status = (await holeStatus(request)).filter(s => !s.ausgelost && s.kampfbereit >= 1).map(s => s.altersklasse);
        expect(status).toEqual(['U18']);

        const resp = await generiere(request, { altersklassen: ['U18'] });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const pools = await holePools(request);
        expect(new Set(pools.map(p => p.altersklasse))).toEqual(new Set(['U11', 'U13', 'U15', 'U18']));
    });

    test('Pools-Seite: Dialog zeigt nur auslosbare Altersklassen', async ({ page, request }) => {
        // frische Klasse mit Eingewogenen, die noch nicht ausgelost ist
        const { resp } = await legeTeilnehmerAn(request, 'U21', 0, { gewogen: true, gewichtsklasse: '-66' });
        expect(resp.ok()).toBeTruthy();
        const { resp: resp2 } = await legeTeilnehmerAn(request, 'U21', 1, { gewogen: true, gewichtsklasse: '-66' });
        expect(resp2.ok()).toBeTruthy();

        await page.goto(`/pools.html?id=${turnierId}`);
        const knopf = page.locator('#generateMorePoolsBtn');
        await expect(knopf).toBeVisible();
        await knopf.click();

        const dialog = page.locator('#altersklassenDialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.altersklassen-checkbox')).toHaveCount(1);
        await expect(dialog.locator('.altersklassen-checkbox')).toHaveValue('U21');
        await page.locator('#altersklassenAbbrechen').click();
        await expect(dialog).toBeHidden();
    });

    test('Matten-Seite: "Alle neu verteilen" verteilt alle Pools ohne echte Kämpfe neu', async ({ page, request }) => {
        await request.post('/api/pools/aufteilen', { data: { turnierId } });
        await page.goto(`/matten.html?id=${turnierId}`);
        await expect(page.locator('#alleNeuVerteilenBtn')).toBeVisible();
        const pools = await holePools(request);
        const mitKampf = pools.find(p => p.id === ersterKampfPoolId);

        await page.locator('#alleNeuVerteilenBtn').click();
        await expect(page.locator('#customConfirmModal')).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toContainText('erfolgreich auf Kampfflächen aufgeteilt');

        const nachher = await holePools(request);
        expect(nachher.every(p => p.kampfflaeche_id)).toBeTruthy();
        // der Pool mit begonnenem Kampf bleibt auf seiner Matte
        expect(nachher.find(p => p.id === ersterKampfPoolId).kampfflaeche_id).toBe(mitKampf.kampfflaeche_id);
    });
    test('Matten-Seite: Beim Drucken lassen sich die Alters-/Geschlechtsklassen auswählen', async ({ page, request }) => {
        await page.goto(`/matten.html?id=${turnierId}`);
        await expect(page.locator('#alleDruckenBtn')).toBeEnabled();

        await page.locator('#alleDruckenBtn').click();
        const boxen = page.locator('.druck-klasse-checkbox');
        const anzahlKlassen = await boxen.count();
        expect(anzahlKlassen).toBeGreaterThanOrEqual(2);
        await boxen.first().uncheck();
        const abgewaehlt = await boxen.first().getAttribute('value');

        await page.locator('#druckKlassenDrucken').click();
        const rahmenUrl = await page.locator('iframe[aria-hidden="true"]').getAttribute('src');
        expect(rahmenUrl).toContain('druckMatte=alle');
        const klassen = decodeURIComponent(new URL(rahmenUrl, 'http://x').searchParams.get('druckKlassen')).split(',');
        expect(klassen).not.toContain(abgewaehlt);
        expect(klassen.length).toBe(anzahlKlassen - 1);
    });
});
