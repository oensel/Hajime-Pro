// End-to-End: ein Wettkampftag am Hallen-Server am Stück, in der Reihenfolge, in der ihn die Turnierleitung erlebt.
// Turnier für heute anlegen und aktivieren, Teilnehmer aus fünf Vereinen melden, Waage in zwei Runden (Gewicht,
// Lizenz, Startgeld), Auslosung der ersten Runde, Kampflos-Pool in den Nachbar-Pool verschieben und den leeren
// Pool löschen, auf zwei Matten verteilen, kämpfen. Während Runde 1 läuft, wird Runde 2 gewogen, ausgelost und
// verteilt. Ist ein Pool fertig, werden die Platzierungen gegen die Kampfergebnisse geprüft, der Pool
// abgeschlossen und seine Urkunden gedruckt, bevor die anderen Pools zu Ende sind. "Durchführung beenden" geht
// erst, wenn kein Kampf mehr offen ist; danach ist der Wettkampfbetrieb gesperrt.
//
// Die Einzelschritte prüfen andere Specs genauer (Drag & Drop: teilnehmer-pools-verteilung, Scoreboard:
// steuerung-*-komplett, Gleichstand: gleichstand-entscheidung, Urkunden: urkunden). Hier geht es um die
// Übergänge zwischen ihnen. Die Kämpfe laufen über dieselbe API wie das Scoreboard, in der Reihenfolge der Matte.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';
import { holePools, holeKaempfeDerMatte, holeKaempfeDesPools } from './helpers/turnier-aufbau.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLANKO = fs.readFileSync(path.join(__dirname, 'fixtures/urkunde-blanko.pdf')).toString('base64');
const NAME_FELD = { id: 'f1', text: '{Name}', x: 97, y: 400, breite: 400, schrift: 'noto-serif-bold', groesse: 30, farbe: '#1a1a1a', ausrichtung: 'zentriert' };
const VEREINE = ['JC Nord', 'JC Süd', 'TSV Ost', 'SV West', 'PSV Mitte'];
const heute = () => new Date().toISOString().slice(0, 10);

test.describe.serial('Kompletter Wettkampftag am Hallen-Server', () => {
    let db;
    let turnierId;
    let matten;
    let vorlageId;
    // Stärke je Teilnehmer: der Stärkere gewinnt jeden Kampf, damit die Platzierungen vorab feststehen.
    const staerke = new Map();
    const namen = new Map();
    const runde1 = [];
    const runde2 = [];
    let einzelgaenger;
    let u13PoolId;
    let gemeldet = 0;

    async function melde(request, { altersklasse, geschlecht, gewichtsklasse, gewichte }) {
        const ids = [];
        for (const [i, gewicht] of gewichte.entries()) {
            const vorname = `${altersklasse}${geschlecht[0]}${i}`;
            const nachname = `Ablauf${turnierId}`;
            const resp = await request.post('/api/teilnehmer', {
                data: {
                    turnier_id: turnierId, vorname, nachname, verein: VEREINE[gemeldet++ % VEREINE.length],
                    geburtsjahr: 2012, geschlecht, gewicht, altersklasse, gewichtsklasse, gewogen: false
                }
            });
            expect(resp.status(), await resp.text()).toBe(201);
            const id = (await resp.json()).teilnehmerId;
            staerke.set(id, 100 - i);
            namen.set(id, `${nachname}, ${vorname}`);
            ids.push(id);
        }
        return ids;
    }

    // Waage: Gewicht ist gemeldet, am Tisch werden Gewogen, Lizenz und Startgeld bestätigt.
    async function wiegeEin(request, ids) {
        for (const id of ids) {
            const resp = await request.put(`/api/teilnehmer/${id}/status`, {
                data: { gewogen: true, lizenz_ablauf: '2099-12-31', startgeld_bezahlt: true }
            });
            expect(resp.ok(), await resp.text()).toBeTruthy();
        }
    }

    async function loseAus(request, altersklassen) {
        const resp = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
    }

    async function verteile(request) {
        const resp = await request.post('/api/pools/aufteilen', { data: { turnierId, modus: 'neue' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
    }

    // Wie das Scoreboard: an einer Matte den vordersten spielbaren Kampf holen und mit Ippon für den Stärkeren beenden.
    async function kaempfeNaechsten(request, matteId) {
        const kampf = (await holeKaempfeDerMatte(request, matteId)).find(k => k.status === 'bereit');
        if (!kampf) return null;
        const ersterGewinnt = staerke.get(kampf.kaempfer1_id) > staerke.get(kampf.kaempfer2_id);
        const resp = await request.put(`/api/kaempfe/${kampf.id}`, {
            data: {
                status: 'beendet', sieger_id: ersterGewinnt ? kampf.kaempfer1_id : kampf.kaempfer2_id,
                unterbewertung_kaempfer1: ersterGewinnt ? 10 : 0, unterbewertung_kaempfer2: ersterGewinnt ? 0 : 10,
                kampfzeit_in_sekunden: 60
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return kampf;
    }

    // Beide Matten abwechselnd, bis `fertig` zutrifft oder keine Matte mehr einen Kampf hat.
    async function kaempfeBis(request, fertig) {
        for (let runde = 0; runde < 200; runde++) {
            if (await fertig()) return;
            const gespielt = [];
            for (const m of matten) gespielt.push(await kaempfeNaechsten(request, m.id));
            if (gespielt.every(k => k === null)) break;
        }
        expect(await fertig(), 'Matten haben keine spielbaren Kämpfe mehr').toBe(true);
    }

    const offeneKaempfe = async (request, poolId) =>
        (await holeKaempfeDesPools(request, poolId)).filter(k => !['beendet', 'freilos'].includes(k.status)).length;

    // Erwartete Rangfolge aus den Kampfergebnissen, unabhängig von src/shared/platzierungen.js: im
    // Jeder-gegen-Jeden zählen die Siege, ein Gleichstand darf bei dieser Stärkeverteilung nicht vorkommen.
    async function erwarteteRangfolge(request, poolId) {
        const siege = new Map();
        for (const k of await holeKaempfeDesPools(request, poolId)) {
            for (const id of [k.kaempfer1_id, k.kaempfer2_id]) if (!siege.has(id)) siege.set(id, 0);
            siege.set(k.sieger_id, siege.get(k.sieger_id) + 1);
        }
        const rang = [...siege.entries()].sort((a, b) => b[1] - a[1]);
        expect(new Set(rang.map(([, s]) => s)).size, 'Gleichstand bei den Siegen').toBe(rang.length);
        return rang.map(([id]) => namen.get(id));
    }

    async function pruefeSiegerliste(page, request, poolId) {
        const [erster, zweiter, dritter] = await erwarteteRangfolge(request, poolId);
        const pool = (await holePools(request, turnierId)).find(p => p.id === poolId);
        await page.goto(`/siegerliste.html?turnierId=${turnierId}`);
        const zeile = page.locator('#platzierungenTableBody tr').filter({ hasText: pool.bezeichnung });
        await expect(zeile).toHaveCount(1);
        await expect(zeile.locator('.siegerliste-platz1')).toHaveText(erster);
        await expect(zeile.locator('.siegerliste-platz2')).toHaveText(zweiter);
        await expect(zeile.locator('.siegerliste-platz3')).toContainText(dritter);
    }

    async function schliesseAb(request, poolId) {
        const pool = (await holePools(request, turnierId)).find(p => p.id === poolId);
        expect(pool.status, `Pool ${pool.bezeichnung}`).toBe('kaempfe_beendet');
        const resp = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(resp.ok(), await resp.text()).toBeTruthy();
    }

    async function druckeUrkunden(request, poolIds) {
        const uebersicht = await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json();
        const erwartet = uebersicht.pools.filter(p => poolIds.includes(p.id)).reduce((s, p) => s + p.anzahl['3'], 0);
        expect(erwartet).toBeGreaterThan(0);
        const resp = await request.post('/api/urkunden/generieren', {
            data: { turnierId, vorlageId, platzbereich: '3', poolIds, reihenfolge: 'absteigend' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        expect(resp.headers()['content-type']).toContain('application/pdf');
        expect((await PDFDocument.load(await resp.body())).getPageCount()).toBe(erwartet);
    }

    test.beforeAll(async () => {
        db = knexLib({ client: 'pg', connection: testDbVerbindung });
    });

    // Bricht der Ablauf vorher ab, bliebe das Turnier aktiv und blockierte das Aktivieren in anderen Specs.
    test.afterAll(async () => {
        if (turnierId) await db('turniere').where({ id: turnierId }).update({ aktiv: false });
        await db.destroy();
    });

    test('Aufbau: Turnier für heute mit zwei Matten anlegen und aktivieren, Urkundenvorlage hinterlegen', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: {
                bezeichnung: `E2E Wettkampftag ${Date.now()}`, ort: 'Halle', datum: heute(), ausrichter: 'JC Nord',
                anzahl_kampfflaechen: 2,
                // mit Startgeld, damit "bezahlt" an der Waage eine Rolle spielt (Beispiel-IBAN aus der ISO-Norm)
                startgeld: 10, iban: 'DE89370400440532013000', kontoinhaber: 'JC Nord', verwendungszweck: 'Startgeld'
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        turnierId = (await resp.json()).turnierId;

        const aktiviert = await request.post(`/api/turniere/${turnierId}/aktivieren`, { data: {} });
        expect(aktiviert.ok(), await aktiviert.text()).toBeTruthy();
        const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
        expect(turnier.aktiv).toBe(true);

        matten = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
        expect(matten).toHaveLength(2);

        const vorlage = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: `Wettkampftag ${Date.now()}`, pdf_base64: BLANKO, pdf_dateiname: 'blanko.pdf' }
        });
        expect(vorlage.ok(), await vorlage.text()).toBeTruthy();
        vorlageId = (await vorlage.json()).id;
        const felder = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, { data: { felder: [NAME_FELD] } });
        expect(felder.ok(), await felder.text()).toBeTruthy();
    });

    test('Meldung: U13 m und U15 m/w aus fünf Vereinen, ein U13-Einzelgänger in einer leichteren Klasse', async ({ request }) => {
        // Gewichtsklasse wie bei der Meldung angegeben (die Auslosung gruppiert danach)
        runde1.push(...await melde(request, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', gewichte: [36, 37, 38, 39] }));
        [einzelgaenger] = await melde(request, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-28', gewichte: [26] });
        // Der Einzelgänger ist der Schwächste im späteren Fünfer-Pool.
        staerke.set(einzelgaenger, 1);
        runde1.push(einzelgaenger);
        runde2.push(...await melde(request, { altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50', gewichte: [46, 47, 48, 49] }));
        runde2.push(...await melde(request, { altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: '-44', gewichte: [40, 41, 42, 43] }));

        const teilnehmer = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        expect(teilnehmer).toHaveLength(13);
        expect(new Set(teilnehmer.map(t => t.verein)).size).toBe(VEREINE.length);
        expect(teilnehmer.every(t => !t.gewogen)).toBe(true);
    });

    test('Runde 1: U13 wiegen, auslosen, Kampflos-Pool zusammenführen, leeren Pool löschen, auf die Matten', async ({ request }) => {
        await wiegeEin(request, runde1);
        await loseAus(request, ['U13']);

        let pools = await holePools(request, turnierId);
        expect(pools.every(p => p.altersklasse === 'U13')).toBe(true);
        const kampflos = pools.filter(p => p.anzahl_teilnehmer === 1);
        expect(kampflos, 'genau der Einzelgänger steht allein').toHaveLength(1);
        const ziel = pools.find(p => p.anzahl_teilnehmer === 4);
        expect(ziel).toBeTruthy();

        // dieselbe Anfrage wie das Drag & Drop in pools.html
        const verschoben = await request.post('/api/pools/verschieben', { data: { teilnehmerId: einzelgaenger, zielPoolId: ziel.id, turnierId } });
        expect(verschoben.ok(), await verschoben.text()).toBeTruthy();
        const geloescht = await request.delete(`/api/pools/${kampflos[0].id}`);
        expect(geloescht.ok(), await geloescht.text()).toBeTruthy();

        pools = await holePools(request, turnierId);
        expect(pools).toHaveLength(1);
        expect(pools[0].anzahl_teilnehmer).toBe(5);
        expect(pools[0].modus).toBe('Jeder-gegen-Jeden');
        u13PoolId = pools[0].id;

        await verteile(request);
        pools = await holePools(request, turnierId);
        expect(pools[0].kampfflaeche_id).toBeTruthy();
        expect(await offeneKaempfe(request, u13PoolId)).toBe(10);
    });

    test('Runde 2 während Runde 1 kämpft: U15 m/w wiegen, auslosen und verteilen, die U13-Ergebnisse bleiben', async ({ request }) => {
        for (let i = 0; i < 3; i++) await kaempfeNaechsten(request, (await holePools(request, turnierId))[0].kampfflaeche_id);
        expect(await offeneKaempfe(request, u13PoolId)).toBe(7);

        await wiegeEin(request, runde2);
        await loseAus(request, ['U15']);
        await verteile(request);

        const pools = await holePools(request, turnierId);
        const u15 = pools.filter(p => p.altersklasse === 'U15');
        expect(u15).toHaveLength(2);
        expect(u15.every(p => p.anzahl_teilnehmer === 4 && p.kampfflaeche_id)).toBe(true);
        // beide Matten sind belegt
        expect(new Set(pools.map(p => p.kampfflaeche_id)).size).toBe(2);
        expect(await offeneKaempfe(request, u13PoolId)).toBe(7);
    });

    test('Durchführung beenden ist gesperrt, solange Kämpfe offen sind (Server und Knopf in turnier.html)', async ({ page, request }) => {
        const resp = await request.post(`/api/turniere/${turnierId}/durchfuehrung-beenden`);
        expect(resp.status()).toBe(409);
        expect((await resp.json()).error).toMatch(/Kämpfe offen/);

        const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
        expect(turnier.offene_kaempfe).toBeGreaterThan(0);
        expect(turnier.aktiv).toBe(true);
        await page.goto(`/turnier.html?id=${turnierId}`);
        await expect(page.locator('#durchfuehrungBeendenBtn')).toBeHidden();
    });

    test('U13 fertig kämpfen: Platzierungen passen zu den Ergebnissen, Pool abschließen, Urkunden drucken, U15 läuft weiter', async ({ page, request }) => {
        await kaempfeBis(request, async () => (await offeneKaempfe(request, u13PoolId)) === 0);

        await schliesseAb(request, u13PoolId);
        await pruefeSiegerliste(page, request, u13PoolId);
        // der stärkste U13-Kämpfer gewinnt, der Einzelgänger aus dem gelöschten Pool wird Fünfter
        const rang = await erwarteteRangfolge(request, u13PoolId);
        expect(rang[0]).toBe(namen.get(runde1[0]));
        expect(rang[4]).toBe(namen.get(einzelgaenger));
        await druckeUrkunden(request, [u13PoolId]);

        const u15 = (await holePools(request, turnierId)).filter(p => p.altersklasse === 'U15');
        const offen = (await Promise.all(u15.map(p => offeneKaempfe(request, p.id)))).reduce((a, b) => a + b, 0);
        expect(offen, 'U15 soll beim U13-Abschluss noch nicht fertig sein').toBeGreaterThan(0);
    });

    test('U15 fertig kämpfen, prüfen, abschließen und Urkunden drucken', async ({ page, request }) => {
        const u15 = (await holePools(request, turnierId)).filter(p => p.altersklasse === 'U15').map(p => p.id);
        await kaempfeBis(request, async () => {
            for (const id of u15) if (await offeneKaempfe(request, id)) return false;
            return true;
        });
        for (const id of u15) {
            await schliesseAb(request, id);
            await pruefeSiegerliste(page, request, id);
        }
        await druckeUrkunden(request, u15);

        const pools = await holePools(request, turnierId);
        expect(pools.every(p => p.status === 'abgeschlossen')).toBe(true);
    });

    test('Durchführung beenden: Turnier abgeschlossen und nicht mehr aktiv, Wettkampfbetrieb gesperrt', async ({ page, request }) => {
        await page.goto(`/turnier.html?id=${turnierId}`);
        await expect(page.locator('#durchfuehrungBeendenBtn')).toBeVisible();

        const resp = await request.post(`/api/turniere/${turnierId}/durchfuehrung-beenden`);
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const turnier = await (await request.get(`/api/turniere/${turnierId}`)).json();
        expect(turnier.status).toBe('abgeschlossen');
        expect(turnier.aktiv).toBe(false);
        expect(turnier.offene_kaempfe).toBe(0);

        const nachher = await request.post('/api/pools/aufteilen', { data: { turnierId, modus: 'neue' } });
        expect(nachher.status()).toBe(403);
    });
});
