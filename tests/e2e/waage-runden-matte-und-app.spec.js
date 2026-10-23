// End-to-End: Waage in Runden über die ganze Kette. U13 ist ausgelost, auf der Matte verteilt und ein
// Kampf läuft bereits; währenddessen werden U15 männlich und weiblich eingewogen, ausgelost und auf die
// Matte verteilt. Geprüft wird, was die Geräte danach sehen: das Scoreboard (Kämpfe der Matte, wie sie
// datenzugriff.js lädt) bekommt die neuen Kämpfe, ohne den laufenden Kampf oder die Reihenfolge der
// U13-Kämpfe anzutasten, und die Teilnehmer-App (Live-Snapshot → Ingest → App-API/PWA) zeigt die neuen
// Pools. Baut sein Turnier selbst auf (helpers/turnier-aufbau.js), unabhängig von anderen Specs.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';
import { zugangsKopf, merkeZugang } from './helpers/live-zugang.js';
import { ladeSnapshots } from '../../src/live/snapshot.js';
import {
    legeTurnierAn, legeKlasseAn, wiege, loseAus, verteileAufMatten,
    holePools, holeKaempfeDerMatte, holeKaempfeDesPools
} from './helpers/turnier-aufbau.js';

const TOKEN = 'hjl_e2e_runden_0123456789abcdef0123456789abcdef';
const GEHEIMNIS = 'e2e-runden-geheimnis';

test.describe.serial('Waage in Runden: Matte und Teilnehmer-App', () => {
    let db;
    let turnierId;
    let turnierKey;
    let matteId;
    let laufenderKampfId;
    let u13ReihenfolgeVorher;
    let u15Ids;
    let sequenz = Date.now();

    async function sendeSnapshot(request) {
        const [snapshot] = (await ladeSnapshots(db, { geheimnis: GEHEIMNIS }))
            .filter(s => s.turnierKey === turnierKey);
        expect(snapshot, 'Turnier fehlt im Live-Snapshot').toBeTruthy();
        const resp = await request.post('/api/live/ingest', {
            data: { ...snapshot, stand: new Date().toISOString(), sequenz: ++sequenz },
            headers: { Authorization: `Bearer ${TOKEN}` }
        });
        expect(resp.status(), await resp.text()).toBe(204);
        return snapshot;
    }

    test.beforeAll(async () => {
        db = knexLib({ client: 'pg', connection: testDbVerbindung });
        await db('live_ingest_tokens').where({ name: 'e2e-runden' }).del();
        await db('live_ingest_tokens').insert({
            name: 'e2e-runden', token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex')
        });
    });

    test.afterAll(async () => {
        if (turnierKey) await db('live_turniere').where({ turnier_key: turnierKey }).del();
        await db.destroy();
    });

    test('Aufbau: Turnier mit einer Matte, U13 eingewogen, U15 m/w noch angemeldet', async ({ request }) => {
        turnierId = await legeTurnierAn(request, { name: 'Runden Matte+App', anzahlKampfflaechen: 1 });
        await legeKlasseAn(request, turnierId, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 4, gewogen: true, gewichtStart: 36 });
        const m = await legeKlasseAn(request, turnierId, { altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50', anzahl: 4, gewogen: false, gewichtStart: 46 });
        const w = await legeKlasseAn(request, turnierId, { altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: '-44', anzahl: 4, gewogen: false, gewichtStart: 40 });
        u15Ids = [...m, ...w];

        // Freigabe wie nach einem Import aus der Cloud: Herkunfts-ID + Haken "Live freigeben"
        const urspruenglich = 800000000 + (Date.now() % 100000000);
        await db('turniere').where({ id: turnierId }).update({ urspruengliche_id: urspruenglich, live_freigabe: true });
        turnierKey = String(urspruenglich);
    });

    test('U13 wird ausgelost, auf die Matte verteilt und ein Kampf läuft', async ({ request }) => {
        await loseAus(request, turnierId, ['U13']);
        await verteileAufMatten(request, turnierId);

        const pools = await holePools(request, turnierId);
        expect(pools.every(p => p.altersklasse === 'U13')).toBeTruthy();
        matteId = pools[0].kampfflaeche_id;
        expect(matteId).toBeTruthy();

        const kaempfe = await holeKaempfeDerMatte(request, matteId);
        const erster = kaempfe.find(k => k.status === 'bereit');
        expect(erster, 'kein spielbarer U13-Kampf').toBeTruthy();
        const resp = await request.put(`/api/kaempfe/${erster.id}`, { data: { status: 'gestartet' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        laufenderKampfId = erster.id;

        u13ReihenfolgeVorher = (await holeKaempfeDerMatte(request, matteId)).map(k => k.id);
        expect(u13ReihenfolgeVorher.length).toBeGreaterThan(1);
    });

    test('App zeigt vor Runde 2 nur den U13-Pool', async ({ request }) => {
        const snapshot = await sendeSnapshot(request);
        expect(snapshot.pools.map(p => p.altersklasse)).toEqual(['U13']);
        const resp = await request.get(`/api/live/turniere/${turnierKey}/pools`, { headers: await zugangsKopf(turnierKey) });
        expect(resp.ok()).toBeTruthy();
        expect((await resp.json()).pools.map(p => p.altersklasse)).toEqual(['U13']);
    });

    test('U15 m/w werden eingewogen, ausgelost und verteilt, während U13 kämpft', async ({ request }) => {
        await wiege(request, u15Ids);
        await loseAus(request, turnierId, ['U15']);
        await verteileAufMatten(request, turnierId);

        const pools = await holePools(request, turnierId);
        const u15 = pools.filter(p => p.altersklasse === 'U15');
        expect(new Set(u15.map(p => p.geschlecht))).toEqual(new Set(['männlich', 'weiblich']));
        expect(u15.every(p => p.kampfflaeche_id === matteId)).toBeTruthy();
    });

    test('Scoreboard der Matte: neue Kämpfe da, laufender Kampf und U13-Reihenfolge unverändert', async ({ request }) => {
        const pools = await holePools(request, turnierId);
        const neueIds = [];
        for (const p of pools.filter(q => q.altersklasse === 'U15')) {
            neueIds.push(...(await holeKaempfeDesPools(request, p.id)).map(k => k.id));
        }
        expect(neueIds.length).toBeGreaterThan(0);

        const matte = await holeKaempfeDerMatte(request, matteId);
        const ids = matte.map(k => k.id);
        for (const id of neueIds) expect(ids, `Kampf ${id} fehlt auf der Matte`).toContain(id);

        // das Scoreboard nimmt zuerst den gestarteten Kampf: es muss derselbe bleiben
        expect(matte.find(k => k.status === 'gestartet').id).toBe(laufenderKampfId);
        // die U13-Kämpfe behalten ihre Reihenfolge zueinander
        expect(ids.filter(id => u13ReihenfolgeVorher.includes(id))).toEqual(u13ReihenfolgeVorher);
        // der laufende Kampf bleibt vorn; die Planung verschränkt die neuen Pools mit den vorhandenen
        // (CLAUDE.md, Pool-Beginn-Hinweis), die genaue Lage der neuen Kämpfe ist daher nicht festgelegt
        expect(ids[0]).toBe(laufenderKampfId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(u13ReihenfolgeVorher.length + neueIds.length);
    });

    test('Teilnehmer-App: nach dem nächsten Snapshot erscheinen die neuen Pools und ihre Kämpfe', async ({ page, request }) => {
        const snapshot = await sendeSnapshot(request);
        const u15 = snapshot.pools.filter(p => p.altersklasse === 'U15');
        expect(u15).toHaveLength(2);
        const warteschlange = snapshot.warteschlangen.find(w => w.matteId === matteId).kaempfe;
        expect(warteschlange.length).toBeGreaterThan(u13ReihenfolgeVorher.length - 1);

        // App-API
        const poolListe = (await (await request.get(`/api/live/turniere/${turnierKey}/pools`, { headers: await zugangsKopf(turnierKey) })).json()).pools;
        expect(poolListe.filter(p => p.altersklasse === 'U15')).toHaveLength(2);
        const detail = await (await request.get(`/api/live/turniere/${turnierKey}/pools/${u15[0].id}`, { headers: await zugangsKopf(turnierKey) })).json();
        expect(detail.kaempfe.length).toBeGreaterThan(0);

        // PWA
        await merkeZugang(page, turnierKey);
        await page.goto(`/live/#/t/${turnierKey}`);
        await page.getByTestId('tab-pools').click();
        for (const p of u15) await expect(page.getByTestId(`pool-${p.id}`)).toContainText('U15');
    });
});
