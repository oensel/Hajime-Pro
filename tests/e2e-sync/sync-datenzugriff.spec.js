// public/js/datenzugriff.js im echten Browser gegen den Sync-Server (Dokument-Backend), ohne an
// einer bestimmten Oberfläche zu hängen: die Seite bindet nur die beiden Skripte ein.
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin } from './helpers.js';

test.describe.serial('Datenzugriff im Browser (Dokument-Backend)', () => {
    let matId, turnierId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId } = await richteDk8TurnierEin(request, 'Sync Datenzugriff'));
        await warteLeerlauf(request);
    });

    async function ladeModul(page) {
        await page.goto('/login.html');
        await page.addScriptTag({ url: '/js/pouchdb/pouchdb.min.js' });
        await page.addScriptTag({ url: '/js/datenzugriff.js' });
        return page.evaluate(() => window.Datenzugriff.init());
    }

    test('wählt das Dokument-Backend und liefert dieselbe Mattenansicht wie REST', async ({ page, request }) => {
        expect(await ladeModul(page)).toBe('dokumente');
        const ausDokumenten = await page.evaluate((m) => window.Datenzugriff.ladeKaempfeDerMatte(m), matId);
        const ausRest = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const kern = (l) => l.map(k => [k.id, k.status, k.kaempfer1_nachname, k.kaempfer2_nachname, k.pool_bezeichnung, k.matten_reihenfolge]);
        expect(kern(ausDokumenten)).toEqual(kern(ausRest));
        const matten = await page.evaluate((t) => window.Datenzugriff.ladeKampfflaechen(t), turnierId);
        expect(matten.map(m => m.id)).toEqual([matId]);
    });

    // Nachmeldung vor dem ersten Ergebnis: danach sperrt die Fachlogik die Teilnehmerliste.
    test('Nachmeldung liefert die neue SQL-ID', async ({ page, request }) => {
        await ladeModul(page);
        const ergebnis = await page.evaluate((t) => window.Datenzugriff.speichereTeilnehmer(null, {
            turnier_id: t, vorname: 'Paul', nachname: 'Probe', verein: 'JC P', judopass_id: 'PP-1',
            geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 72, altersklasse: 'U21', gewichtsklasse: '-81kg', gewogen: true
        }), turnierId);
        expect(ergebnis.ok).toBe(true);
        expect(ergebnis.teilnehmerId).toBeGreaterThan(0);
        const t = await (await request.get(`/api/teilnehmer/${ergebnis.teilnehmerId}`)).json();
        expect(t.nachname).toBe('Probe');
    });

    test('Ergebnis speichern wartet auf die Server-Bestätigung', async ({ page, request }) => {
        await ladeModul(page);
        const bereit = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.status === 'bereit');
        const ergebnis = await page.evaluate(({ id, sieger }) => window.Datenzugriff.aktualisiereKampf(id, {
            status: 'beendet', sieger_id: sieger, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 12
        }), { id: bereit.id, sieger: bereit.kaempfer1_id });
        expect(ergebnis).toEqual({ ok: true });
        const sql = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.id === bereit.id);
        expect(sql.status).toBe('beendet');
    });

    test('abgelehnte Aktion liefert die Fehlermeldung der Fachlogik', async ({ page, request }) => {
        await ladeModul(page);
        const beendet = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.status === 'beendet');
        const ergebnis = await page.evaluate((id) => window.Datenzugriff.aktualisiereKampf(id, { status: 'gestartet' }), beendet.id);
        expect(ergebnis.ok).toBe(false);
        expect(ergebnis.fehler).toContain('beendeter Kampf');
    });

    test('Kampf zurücksetzen über die Dokument-DB: bereit an zweiter Stelle', async ({ page, request }) => {
        await ladeModul(page);
        const beendet = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.status === 'beendet');
        const ergebnis = await page.evaluate(({ id, t }) => window.Datenzugriff.setzeKampfZurueck(id, t), { id: beendet.id, t: turnierId });
        expect(ergebnis, JSON.stringify(ergebnis)).toEqual({ ok: true });
        const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        expect(kaempfe.find(k => k.id === beendet.id).status).toBe('bereit');
        expect(kaempfe.filter(k => k.status === 'bereit')[1].id).toBe(beendet.id);
    });

    test('Reihenfolge über die Dokument-DB ändern (Drag&Drop)', async ({ page, request }) => {
        await ladeModul(page);
        const bereit = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).filter(k => k.status === 'bereit');
        expect(bereit.length).toBeGreaterThan(2);
        const umgekehrt = [...bereit].reverse().map(k => k.id);
        const ergebnis = await page.evaluate(({ ids, m, t }) => window.Datenzugriff.setzeReihenfolge(m, ids, t), { ids: umgekehrt, m: matId, t: turnierId });
        expect(ergebnis, JSON.stringify(ergebnis)).toEqual({ ok: true });
        const danach = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).filter(k => k.status === 'bereit').map(k => k.id);
        expect(danach).toEqual(umgekehrt);
    });
});
