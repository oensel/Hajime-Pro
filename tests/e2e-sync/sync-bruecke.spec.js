// Brücke Dokument-DB -> relationale DB: Änderungen, die Matte/Waage als Dokument schreiben, landen
// über die bestehende Fachlogik in SQL; Ablehnungen kommen als letzte_ablehnung + konflikt:-Dokument
// zurück.
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, alleDokumente, ladeDokument, schreibeDokument } from './helpers.js';

test.describe.serial('Brücke: Dokument-Änderungen landen über die Fachlogik in der relationalen DB', () => {
    let dbName, matId, turnierId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId } = await richteDk8TurnierEin(request, 'Sync Brücke'));
        await warteLeerlauf(request);
        dbName = (await syncStatus(request)).db_name;
    });

    const sqlKaempfe = async (request) => (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();

    // Nachmeldungen zuerst: nach dem ersten echten Kampf sperrt die Fachlogik die Teilnehmerliste
    // (turnierHatEchteKaempfe in poolController.js).
    test('Nachmeldung und Dublette', async ({ request }) => {
        const neu = {
            _id: 'teilnehmer:u-11111111-1111-4111-8111-111111111111', dokumenttyp: 'teilnehmer', sql_id: null, bearbeitet_von: 'test',
            turnier_id: turnierId, vorname: 'Nina', nachname: 'Nach', verein: 'JC Neu', judopass_id: 'NP-1',
            geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 70, altersklasse: 'U21', gewichtsklasse: '-81kg'
        };
        await schreibeDokument(request, dbName, neu);
        await warteLeerlauf(request);
        const doc = await ladeDokument(request, dbName, neu._id);
        expect(doc.sql_id).toBeGreaterThan(0);
        expect(doc.bearbeitet_von).toBe('server');

        const dublette = { ...neu, _id: 'teilnehmer:u-22222222-2222-4222-8222-222222222222', gewicht: 71.5 };
        await schreibeDokument(request, dbName, dublette);
        await warteLeerlauf(request);
        const liste = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        expect(liste.filter(t => t.judopass_id === 'NP-1')).toHaveLength(1);
        expect(parseFloat(liste.find(t => t.judopass_id === 'NP-1').gewicht)).toBe(71.5);
        const dDoc = await ladeDokument(request, dbName, dublette._id);
        expect(dDoc.dublette_von).toBe(neu._id);
        expect(dDoc.sql_id).toBe(doc.sql_id);
        const konflikte = (await alleDokumente(request, dbName)).filter(d => d.dokumenttyp === 'konflikt' && d.bezug_id === dublette._id);
        expect(konflikte.map(k => k.konflikt_typ)).toEqual(['dublette']);
    });

    test('Ergebnis per Dokument -> SQL + Kaskade', async ({ request }) => {
        const erster = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${erster.id}`);
        await schreibeDokument(request, dbName, {
            ...doc, status: 'beendet', sieger_id: doc.kaempfer1_id,
            unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 42, bearbeitet_von: 'test'
        });
        await warteLeerlauf(request);
        const sql = (await sqlKaempfe(request)).find(k => k.id === erster.id);
        expect(sql.status).toBe('beendet');
        expect(sql.sieger_id).toBe(doc.kaempfer1_id);
        expect((await ladeDokument(request, dbName, `kampf:${erster.id}`)).bearbeitet_von).toBe('server');
    });

    test('abgelehnte Änderung: Konflikt-Dokument, letzte_ablehnung, Server-Stand wiederhergestellt', async ({ request }) => {
        const matte = await ladeDokument(request, dbName, `kampfflaeche:${matId}`);
        await schreibeDokument(request, dbName, { ...matte, status: 'pausiert', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const bereit = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        const { rev } = await schreibeDokument(request, dbName, { ...doc, status: 'gestartet', bearbeitet_von: 'test' });
        await warteLeerlauf(request);

        const nachher = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        expect(nachher.status).toBe('bereit');
        expect(nachher.letzte_ablehnung.rev).toBe(rev);
        expect(nachher.letzte_ablehnung.grund).toContain('pausiert');
        const konflikte = (await alleDokumente(request, dbName)).filter(d => d.dokumenttyp === 'konflikt' && d.bezug_id === `kampf:${bereit.id}`);
        expect(konflikte).toHaveLength(1);
        expect(konflikte[0].konflikt_typ).toBe('abgelehnt');

        const m2 = await ladeDokument(request, dbName, `kampfflaeche:${matId}`);
        await schreibeDokument(request, dbName, { ...m2, status: 'frei', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const kf = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
        expect(kf[0].status).not.toBe('pausiert');
    });

    test('Forfeit per Dokument', async ({ request }) => {
        const bereit = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        await schreibeDokument(request, dbName, { ...doc, forfeit_teilnehmer_id: doc.kaempfer2_id, forfeit_art: 'disqualifiziert', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const sql = (await sqlKaempfe(request)).find(k => k.id === bereit.id);
        expect(sql.status).toBe('beendet');
        expect(sql.sieger_id).toBe(doc.kaempfer1_id);
        const nachher = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        expect(nachher.forfeit_art).toBeUndefined();
    });

    test('Neustart der Brücke wendet nichts doppelt an', async ({ request }) => {
        const vorher = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const kaempfeVorher = await sqlKaempfe(request);
        const r = await request.post('/api/sync/test/bruecke-neustart');
        expect(r.ok()).toBeTruthy();
        await warteLeerlauf(request);
        const nachher = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        expect(JSON.stringify(nachher)).toBe(JSON.stringify(vorher));
        const kern = (l) => l.map(k => [k.id, k.status, k.sieger_id, k.kaempfer1_id, k.kaempfer2_id]);
        expect(kern(await sqlKaempfe(request))).toEqual(kern(kaempfeVorher));
    });
});
