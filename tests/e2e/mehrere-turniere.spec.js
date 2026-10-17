// End-to-End: mehrere Turniere am Hallen-Server — Aktivieren nur am Wettkampftag, höchstens ein aktives
// Turnier, Duplizieren (optional mit Teilnehmern). Die Terminüberschneidung wird nur mit Sync geprüft
// und ist in tests/e2e-sync/sync-grundlagen.spec.js abgedeckt.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

function heute() {
    const j = new Date();
    return `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, '0')}-${String(j.getDate()).padStart(2, '0')}`;
}

async function legeTurnierAn(request, bezeichnung, datum, extra = {}) {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum, ausrichter: 'JC Mehrere', anzahl_kampfflaechen: 2, ...extra }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).turnierId;
}

async function liste(request) {
    const resp = await request.get('/api/turniere');
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

test.describe.configure({ mode: 'serial' });

test('Aktivieren geht nur am Wettkampftag und nur für ein Turnier gleichzeitig', async ({ request }) => {
    const zukunft = await legeTurnierAn(request, `Mehrere Zukunft ${Date.now()}`, '2031-06-01');
    const erstes = await legeTurnierAn(request, `Mehrere Heute A ${Date.now()}`, heute());
    const zweites = await legeTurnierAn(request, `Mehrere Heute B ${Date.now()}`, heute());

    let turniere = await liste(request);
    const finde = (id) => turniere.find(t => t.id === id);
    expect(finde(zukunft).aktivierbar).toBe(false);
    expect(finde(zukunft).aktivierbar_grund).toMatch(/Wettkampftag/);
    expect(finde(erstes).aktivierbar).toBe(true);

    const zuFrueh = await request.post(`/api/turniere/${zukunft}/aktivieren`, { data: {} });
    expect(zuFrueh.status()).toBe(409);

    const ok = await request.post(`/api/turniere/${erstes}/aktivieren`, { data: {} });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    turniere = await liste(request);
    expect(finde(erstes).aktiv).toBe(true);
    expect(finde(erstes).status).toBe('veroeffentlicht'); // ein Entwurf wird mit dem Aktivieren veröffentlicht
    expect(finde(zweites).aktivierbar).toBe(false);
    expect(finde(zweites).aktivierbar_grund).toMatch(/noch aktiv/);

    const belegt = await request.post(`/api/turniere/${zweites}/aktivieren`, { data: {} });
    expect(belegt.status()).toBe(409);

    // das aktive Turnier (in Durchführung) lässt sich nicht löschen; nach "Durchführung beenden" ist der Platz frei
    expect((await request.delete(`/api/turniere/${erstes}`)).status()).toBe(403);
    const beendet = await request.post(`/api/turniere/${erstes}/durchfuehrung-beenden`);
    expect(beendet.ok(), await beendet.text()).toBeTruthy();
    turniere = await liste(request);
    expect(finde(erstes).aktiv).toBe(false);
    expect(finde(erstes).status).toBe('abgeschlossen');
    expect(finde(zweites).aktivierbar).toBe(true);

    // aufräumen: zweites aktivieren und beenden, damit kein aktives Turnier in der gemeinsamen DB bleibt
    expect((await request.post(`/api/turniere/${zweites}/aktivieren`, { data: {} })).ok()).toBeTruthy();
    expect((await request.post(`/api/turniere/${zweites}/durchfuehrung-beenden`)).ok()).toBeTruthy();
    expect((await liste(request)).some(t => t.aktiv)).toBe(false);
});

test('Duplizieren: Stammdaten und Matten, Teilnehmer nur auf Wunsch mit Gewicht, ohne Gewogen und Startgeld', async ({ request }) => {
    const quelle = await legeTurnierAn(request, `Mehrere Quelle ${Date.now()}`, '2031-07-01', { startgeld: 5, iban: 'DE12345678901234567890', kontoinhaber: 'JC', verwendungszweck: 'Startgeld' });

    const tn = await request.post('/api/teilnehmer', {
        data: {
            turnier_id: quelle, vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', geburtsjahr: 2010,
            geschlecht: 'weiblich', gewicht: 41.5, altersklasse: 'U15', gewichtsklasse: '-44kg', lizenz_ablauf: '2035-01-01'
        }
    });
    expect(tn.ok(), await tn.text()).toBeTruthy();

    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turnier_teilnehmer').where({ turnier_id: quelle }).update({ gewogen: true, startgeld_bezahlt: true });

        const ohne = await request.post(`/api/turniere/${quelle}/duplizieren`, { data: { datum: '2031-07-02', teilnehmerUebernehmen: false } });
        expect(ohne.status(), await ohne.text()).toBe(201);
        const ohneId = (await ohne.json()).turnierId;
        const ohneTurnier = await (await request.get(`/api/turniere/${ohneId}`)).json();
        expect(ohneTurnier.status).toBe('entwurf');
        expect(ohneTurnier.aktiv).toBe(false);
        expect(String(ohneTurnier.datum).slice(0, 10)).toBe('2031-07-02');
        expect(ohneTurnier.anzahl_kampfflaechen).toBe(2);
        expect(ohneTurnier.teilnehmer_anzahl).toBe(0);
        expect(await db('kampfflaechen').where({ turnier_id: ohneId }).count('* as n').first().then(r => Number(r.n))).toBe(2);

        const mit = await request.post(`/api/turniere/${quelle}/duplizieren`, { data: { datum: '2031-07-03', teilnehmerUebernehmen: true } });
        expect(mit.status(), await mit.text()).toBe(201);
        const mitId = (await mit.json()).turnierId;
        const kopien = await db('turnier_teilnehmer').where({ turnier_id: mitId });
        expect(kopien).toHaveLength(1);
        expect(Number(kopien[0].gewicht)).toBe(41.5);
        expect(kopien[0].nachname).toBe('Adler');
        expect(kopien[0].gewogen).toBe(false);
        expect(kopien[0].startgeld_bezahlt).toBe(false);
        expect(kopien[0].pool_id).toBeNull();
        expect(kopien[0].status).toBe('angemeldet');
        expect(String(kopien[0].lizenz_ablauf)).toContain('2035');

        // das Original bleibt unverändert
        const original = await db('turnier_teilnehmer').where({ turnier_id: quelle }).first();
        expect(original.gewogen).toBe(true);
        expect(original.startgeld_bezahlt).toBe(true);

        const ohneDatum = await request.post(`/api/turniere/${quelle}/duplizieren`, { data: {} });
        expect(ohneDatum.status()).toBe(400);
    } finally {
        await db.destroy();
    }
});

test('turniere.html: Aktivieren und Duplizieren erscheinen, abgeschlossene Turniere sind kompakt', async ({ page, request }) => {
    const bez = `Mehrere Liste ${Date.now()}`;
    const heutiges = await legeTurnierAn(request, bez, heute());
    const fertigName = `Mehrere Fertig ${Date.now()}`;
    const fertig = await legeTurnierAn(request, fertigName, heute());
    expect((await request.post(`/api/turniere/${fertig}/aktivieren`, { data: {} })).ok()).toBeTruthy();
    expect((await request.post(`/api/turniere/${fertig}/durchfuehrung-beenden`)).ok()).toBeTruthy();

    await page.goto('/turniere.html');
    const karte = page.locator('.tournament-card').filter({ hasText: bez });
    await expect(karte.getByRole('button', { name: 'Aktivieren' })).toBeVisible();
    await expect(karte.getByRole('button', { name: 'Duplizieren' })).toBeVisible();
    // nur das Kopieren-Icon, die Beschriftung steht als Tooltip
    const dupKnopf = karte.getByRole('button', { name: 'Duplizieren' });
    await expect(dupKnopf).toHaveAttribute('data-tooltip', 'Duplizieren');
    await expect(dupKnopf.locator('.material-icons')).toHaveText('content_copy');
    await expect(dupKnopf).toHaveText('content_copy');
    // gleiche Höhe wie die übrigen Knöpfe der Karte
    const hoehen = await karte.locator('.card-actions .btn').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(hoehen).size).toBe(1);
    await expect(karte.locator('.status-badge')).toHaveText('Entwurf');

    const zeile = page.locator('.abgeschlossen-zeile').filter({ hasText: fertigName });
    await expect(zeile).toBeVisible();
    await expect(zeile.locator('[data-aktion="duplizieren"]')).toHaveAttribute('data-tooltip', 'Duplizieren');

    // Duplizieren-Dialog
    await karte.getByRole('button', { name: 'Duplizieren' }).click();
    await expect(page.locator('#turnierDuplizierenModal')).toBeVisible();
    await page.locator('#duplizierenDatum').fill('2031-08-01');
    const antwort = page.waitForResponse(r => r.url().includes('/duplizieren') && r.request().method() === 'POST');
    await page.locator('#duplizierenOkBtn').click();
    expect((await antwort).status()).toBe(201);

    // aufräumen: das heutige Turnier aktivieren und beenden (kein aktives Turnier zurücklassen)
    expect((await request.post(`/api/turniere/${heutiges}/aktivieren`, { data: {} })).ok()).toBeTruthy();
    expect((await request.post(`/api/turniere/${heutiges}/durchfuehrung-beenden`)).ok()).toBeTruthy();
});

test('turniere.html: aktives Turnier mit rotem Rahmen, abgeschlossene Turniere ganz unten, volle Breite', async ({ page, request }) => {
    const aktivName = `Layout Aktiv ${Date.now()}`;
    const geplantName = `Layout Geplant ${Date.now()}`;
    const fertigName = `Layout Fertig ${Date.now()}`;
    const aktiv = await legeTurnierAn(request, aktivName, heute());
    await legeTurnierAn(request, geplantName, '2031-09-01');
    const fertig = await legeTurnierAn(request, fertigName, heute());
    expect((await request.post(`/api/turniere/${fertig}/aktivieren`, { data: {} })).ok()).toBeTruthy();
    expect((await request.post(`/api/turniere/${fertig}/durchfuehrung-beenden`)).ok()).toBeTruthy();
    expect((await request.post(`/api/turniere/${aktiv}/aktivieren`, { data: {} })).ok()).toBeTruthy();

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/turniere.html');
    const aktivKarte = page.locator('.tournament-card').filter({ hasText: aktivName });
    const geplantKarte = page.locator('.tournament-card').filter({ hasText: geplantName });
    await expect(aktivKarte).toHaveClass(/aktiv/);
    expect(await aktivKarte.evaluate(e => getComputedStyle(e).borderTopColor)).toBe('rgb(198, 40, 40)');
    // das aktive Turnier steht vor den anderen lokalen Turnieren, nebeneinander im selben Raster
    const karten = page.locator('.lokal-grid .tournament-card');
    await expect(karten.first()).toHaveClass(/aktiv/);
    const [a, zweite] = [await karten.nth(0).boundingBox(), await karten.nth(1).boundingBox()];
    expect(Math.abs(a.y - zweite.y)).toBeLessThan(2);
    expect(zweite.x).toBeGreaterThan(a.x);
    await expect(geplantKarte).toBeVisible();
    // kein "Bearbeiten" mehr, das Bearbeiten läuft über Auswählen und das Menü
    await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);

    // abgeschlossene Turniere ganz unten (unter dem Cloud-Bereich bzw. unter den lokalen Karten)
    const zeile = page.locator('.abgeschlossen-zeile').filter({ hasText: fertigName });
    await expect(zeile).toBeVisible();
    expect((await zeile.boundingBox()).y).toBeGreaterThan((await geplantKarte.boundingBox()).y);
    const letzte = await page.evaluate(() => {
        const bereich = document.getElementById('abgeschlossenBereich');
        const cloud = document.getElementById('cloudBereich');
        return !!(cloud.compareDocumentPosition(bereich) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(letzte).toBeTruthy();

    // volle Breite: die Hauptkarte füllt den Platz neben dem Menü (keine feste Höchstbreite von 1100 px)
    const breite = await page.locator('.mdc-card').filter({ has: page.locator('#tournamentsContainer') }).evaluate(e => e.getBoundingClientRect().width);
    expect(breite).toBeGreaterThan(1200);
});

