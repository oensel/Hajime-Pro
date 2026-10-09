// Konfliktfälle am Hallen-Server (Spec Abschnitt 10): CouchDB-Konflikt zweier Wiegungen,
// Klärungsfall (Ergebnis mit abweichender Paarung) und die Konfliktliste in sync-konflikte.html.
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, ladeDokument, schreibeDokument, alleDokumente, DK8_TEILNEHMER } from './helpers.js';

test.describe.serial('Konflikte', () => {
    let dbName, matId, turnierId, teilnehmerIds, finaleId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId, teilnehmerIds } = await richteDk8TurnierEin(request, 'Sync Konflikte'));
        await warteLeerlauf(request);
        dbName = (await syncStatus(request)).db_name;
    });

    test('zwei Wiegungen desselben Judoka: die jüngere gewinnt (nicht die von CouchDB gewählte)', async ({ request }) => {
        const docId = `teilnehmer:${teilnehmerIds[0]}`;
        const doc = await ladeDokument(request, dbName, docId);
        const [nr, hash] = doc._rev.split('-');
        const kind = (revHash, gewicht, gewogenAm) => {
            const { _rev, ...rest } = doc;
            return {
                ...rest, _rev: `${Number(nr) + 1}-${revHash}`,
                _revisions: { start: Number(nr) + 1, ids: [revHash, hash] },
                gewicht, gewogen: true, gewogen_am: gewogenAm, bearbeitet_von: 'browser'
            };
        };
        // CouchDB wählt den Gewinner nach dem Revisions-Hash ('bbbb' > 'aaaa') — das ist hier die
        // ÄLTERE Wiegung. Die Brücke muss trotzdem die jüngere (aaaa) übernehmen.
        const resp = await request.post(`/db/${dbName}/_bulk_docs`, {
            data: { new_edits: false, docs: [kind('aaaa', 71.5, '2027-03-20T09:00:00.000Z'), kind('bbbb', 70.5, '2027-03-20T08:00:00.000Z')] }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        await warteLeerlauf(request);

        const t = await (await request.get(`/api/teilnehmer/${teilnehmerIds[0]}`)).json();
        expect(parseFloat(t.gewicht)).toBe(71.5);
        const nachher = await (await request.get(`/db/${dbName}/${encodeURIComponent(docId)}?conflicts=true`)).json();
        expect(nachher._conflicts).toBeUndefined();
    });

    test('Ergebnis mit abweichender Paarung wird zum Klärungsfall', async ({ request }) => {
        const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const finale = kaempfe.find(k => k.reihenfolge_nummer === 'F');
        finaleId = finale.id;
        const doc = await ladeDokument(request, dbName, `kampf:${finale.id}`);
        // Ein Gerät meldet ein Finale mit einer Paarung, die der Server (noch ohne Vorkampf-
        // Ergebnisse) so nie berechnet hat — und es kommen auch keine Vorkampf-Ergebnisse nach.
        await schreibeDokument(request, dbName, {
            ...doc, kaempfer1_id: teilnehmerIds[0], kaempfer2_id: teilnehmerIds[1], status: 'beendet',
            sieger_id: teilnehmerIds[0], unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, bearbeitet_von: 'browser'
        });
        await warteLeerlauf(request);

        const sql = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.id === finale.id);
        expect(sql.status).toBe('klaerung');
        expect(sql.sieger_id).toBeNull();
        const konflikte = (await alleDokumente(request, dbName)).filter(d => d.dokumenttyp === 'konflikt' && d.konflikt_typ === 'klaerung');
        expect(konflikte).toHaveLength(1);
        expect(konflikte[0].prioritaet).toBe('hoch');
    });

    // Gerät meldet das Finale mit einer Paarung, die der Server so nicht berechnet hat.
    async function erzeugeKlaerungsfall(request) {
        const doc = await ladeDokument(request, dbName, `kampf:${finaleId}`);
        await schreibeDokument(request, dbName, {
            ...doc, kaempfer1_id: teilnehmerIds[0], kaempfer2_id: teilnehmerIds[1], status: 'beendet',
            sieger_id: teilnehmerIds[0], unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, bearbeitet_von: 'browser'
        });
        await warteLeerlauf(request);
    }
    const finaleZeile = async (request) => (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.id === finaleId);

    test('Konfliktliste in sync-konflikte.html: Menüpunkt mit Zähler, Gegenüberstellung, "Server-Paarung behalten"', async ({ page, request }) => {
        await page.goto(`/sync-konflikte.html?turnierId=${turnierId}`);
        await expect(page.locator('#nav-sync-konflikte-badge')).toBeVisible();
        await expect(page.locator('#nav-sync-konflikte-badge')).toHaveClass(/hoch/);
        const erster = page.locator('.sync-konflikt').first();
        await expect(erster).toHaveAttribute('data-typ', 'klaerung');
        await expect(erster).toContainText('Klärung nötig');
        await expect(erster.locator('.konflikt-vergleich')).toBeVisible();
        // Kämpfer erscheinen mit Namen, nicht als nackte IDs
        await expect(erster.locator('.konflikt-vergleich')).toContainText(DK8_TEILNEHMER[0].vorname);

        await erster.locator('.konflikt-server').click();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('.sync-konflikt[data-typ="klaerung"]')).toHaveCount(0);
        await expect(page.locator('#nav-sync-konflikte-badge')).toBeHidden();

        const zeile = await finaleZeile(request);
        expect(zeile.status).not.toBe('klaerung');
        expect(zeile.status).not.toBe('beendet');
        expect(zeile.sieger_id).toBeNull();
    });

    test('"Ergebnis der Matte übernehmen" beendet den Kampf mit der Paarung des Geräts', async ({ request }) => {
        await erzeugeKlaerungsfall(request);
        expect((await finaleZeile(request)).status).toBe('klaerung');
        const konflikt = (await (await request.get('/api/sync/konflikte')).json()).find(k => k.konflikt_typ === 'klaerung');
        expect(konflikt).toBeTruthy();

        const antwort = await request.post(`/api/sync/konflikte/${encodeURIComponent(konflikt._id)}/entscheiden`, { data: { entscheidung: 'geraet' } });
        expect(antwort.ok(), await antwort.text()).toBeTruthy();
        await warteLeerlauf(request);

        const zeile = await finaleZeile(request);
        expect(zeile.status).toBe('beendet');
        expect(zeile.sieger_id).toBe(teilnehmerIds[0]);
        expect(zeile.kaempfer1_id).toBe(teilnehmerIds[0]);
        expect(zeile.kaempfer2_id).toBe(teilnehmerIds[1]);
        expect((await (await request.get('/api/sync/konflikte')).json()).filter(k => k.konflikt_typ === 'klaerung')).toHaveLength(0);

        // Erneute Entscheidung zum selben Konflikt wird abgewiesen
        const nochmal = await request.post(`/api/sync/konflikte/${encodeURIComponent(konflikt._id)}/entscheiden`, { data: { entscheidung: 'server' } });
        expect(nochmal.status()).toBe(409);
    });

    test('ungültige Entscheidung wird abgewiesen', async ({ request }) => {
        const antwort = await request.post('/api/sync/konflikte/konflikt:gibt-es-nicht/entscheiden', { data: { entscheidung: 'egal' } });
        expect(antwort.status()).toBe(400);
    });
});
