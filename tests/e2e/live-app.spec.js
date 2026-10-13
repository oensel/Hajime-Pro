// End-to-End: Teilnehmer-App Phase 2 — Ingest, Suche mit Autovervollständigung, Pool-Ansicht, Stern, Übersicht.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

// Eindeutig je Test: eine Rücknahme setzt die Sequenz hoch, spätere Pakete desselben Turniers würden sonst verworfen.
let KEY = '';
let zaehler = 0;
test.beforeEach(() => { KEY = `E2E-LIVE-${Date.now()}-${zaehler++}`; });
const TOKEN = 'hjl_e2e_token_0123456789abcdef0123456789abcdef';
const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 2', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (sequenz, extra = {}) => ({
    version: 1, turnierKey: KEY, name: 'Live-E2E-Turnier', datum: new Date().toISOString().slice(0, 10),
    stand: new Date().toISOString(), sequenz,
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Beispiel' }], matten: [{ id: 1, bezeichnung: 'Matte 2' }],
    teilnehmer: [
        t('a1', 'Anna', 'Muster'),
        t('a2', 'Mia', 'Mustermann', { zustand: 'laeuft', abstand: null }),
        t('b1', 'Ben', 'Beispiel', { vereinKey: 'v2', verein: 'TV Beispiel', poolId: 11, poolBezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', zustand: 'abgeschlossen', abstand: null, platz: 3 })
    ],
    pools: [
        { id: 10, bezeichnung: 'U15 w -44', modus: 'Doppel-KO-8', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' },
        { id: 11, bezeichnung: 'U15 m -50', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', farbe2: 'blau' }
    ],
    kaempfe: [
        { id: 1, poolId: 10, nr: 'H1', status: 'beendet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: 'a1', p1: 7, p2: 0 },
        { id: 2, poolId: 10, nr: 'H2', status: 'gestartet', reihenfolge: 2, k1: 'a1', k2: 'a2', sieger: null, p1: 0, p2: 0 }
    ],
    warteschlangen: [], ...extra
});

test.beforeAll(async () => {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('live_ingest_tokens').where({ name: 'e2e' }).del();
        await db('live_ingest_tokens').insert({ name: 'e2e', token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex') });
        await db('live_turniere').where('turnier_key', 'like', 'E2E-LIVE-%').del();
    } finally {
        await db.destroy();
    }
});

async function sende(request, daten) {
    const r = await request.post('/api/live/ingest', { data: daten, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status(), await r.text()).toBe(204);
}

test('Ingest → Suche → Pool → Stern → Übersicht', async ({ page, request }) => {
    await sende(request, paket(Date.now()));

    await page.goto('/live/');
    await page.getByTestId(`turnier-${KEY}`).click();

    await page.getByTestId('suchfeld').fill('mus');
    await expect(page.getByTestId('treffer-a1')).toContainText('Anna Muster');
    await expect(page.getByTestId('treffer-a1')).toContainText('JC Muster');
    await expect(page.getByTestId('treffer-a1')).toContainText('nächster Kampf: in 3 Kämpfen');
    await page.getByTestId('treffer-a1').click();

    await expect(page.getByTestId('kachel-a2')).toContainText('Mia Mustermann');
    await expect(page.getByTestId('kachel-a2')).toContainText('läuft jetzt');
    await expect(page.getByTestId('kachel-a1')).toContainText('U15 w −44 kg · Matte 2');
    await page.getByTestId('stern-a1').click();
    await expect(page.getByTestId('stern-a1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('glocke-a1')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('tab-uebersicht').click();
    await expect(page.getByTestId('kachel-a1')).toContainText('nächster Kampf: in 3 Kämpfen');
    await expect(page.getByTestId('kachel-a2')).toHaveCount(0);
    await expect(page.getByTestId('statuszeile')).toContainText('Stand von');
});

test('Verein verfolgen zeigt alle seine Teilnehmer, Abschluss mit Platz, ohne Netz der letzte Stand', async ({ page, request, context }) => {
    await sende(request, paket(Date.now() + 1000));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('verein-v2').click();
    await page.getByTestId('verein-stern').click();
    await page.getByTestId('tab-uebersicht').click();
    // kachel-b1 gibt es schon auf der Vereinsseite: erst die Statuszeile belegt, dass die Übersicht geladen und gemerkt ist.
    await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    await expect(page.getByTestId('statuszeile')).toContainText('Stand von');
    await expect(page.getByTestId('kachel-b1')).toContainText('Abgeschlossen · Platz 3');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('statuszeile')).toContainText('Keine Verbindung');
    await expect(page.getByTestId('kachel-b1')).toContainText('Abgeschlossen · Platz 3');
});

test('Zurückgezogenes Turnier ist nicht mehr auswählbar', async ({ page, request }) => {
    await sende(request, { version: 1, turnierKey: KEY, zurueckgezogen: true, stand: new Date().toISOString(), sequenz: Date.now() + 100000 });
    await page.goto('/live/');
    await expect(page.getByTestId(`turnier-${KEY}`)).toHaveCount(0);
});

test('Offline-Start: die Startseite bietet die zuletzt geladene Übersicht an', async ({ page, request, context }) => {
    await sende(request, paket(Date.now() + 2000));
    await page.goto(`/live/#/t/${KEY}/pool/10/teilnehmer`);
    await page.getByTestId('stern-a1').click();
    await page.getByTestId('tab-uebersicht').click();
    await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();
    await expect(page.getByTestId('statuszeile')).toContainText('Stand von');
    // Startseite einmal online besuchen, damit der Service Worker die Hülle hat und die Turnierliste gemerkt ist.
    await page.goto('/live/#/');
    await expect(page.getByTestId(`turnier-${KEY}`)).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId(`zuletzt-${KEY}`)).toContainText('Live-E2E-Turnier');
    await page.getByTestId(`zuletzt-${KEY}`).click();
    await expect(page.getByTestId('kachel-a1')).toContainText('nächster Kampf: in 3 Kämpfen');
    await expect(page.getByTestId('statuszeile')).toContainText('Keine Verbindung');
});

test('Zurückgezogenes Turnier: die Übersicht zeigt keine alten Namen mehr und räumt den Merkzettel auf', async ({ page, request }) => {
    await sende(request, paket(Date.now() + 3000));
    await page.goto(`/live/#/t/${KEY}/pool/10/teilnehmer`);
    await page.getByTestId('stern-a1').click();
    await page.getByTestId('tab-uebersicht').click();
    await expect(page.getByTestId('statuszeile')).toContainText('Stand von');

    await sende(request, { version: 1, turnierKey: KEY, zurueckgezogen: true, stand: new Date().toISOString(), sequenz: Date.now() + 200000 });
    await page.reload();
    await expect(page.getByText('nicht mehr verfügbar')).toBeVisible();
    await expect(page.getByTestId('kachel-a1')).toHaveCount(0);
    await expect(page.getByTestId('statuszeile')).not.toContainText('Keine Verbindung');
    const gemerkt = await page.evaluate((k) => localStorage.getItem(`hajime-live:cache:${k}`), KEY);
    expect(gemerkt).toBeNull();
});

test('Startbildschirm: Vereine direkt, Klassen darunter, Klick auf Gewichtsklasse öffnet den Pool', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await expect(page.getByTestId('verein-v1')).toContainText('JC Muster');
    await expect(page.getByTestId('verein-v2')).toContainText('TV Beispiel');
    await page.getByTestId('klasse-U15-w').click();
    await page.getByTestId('gewicht-10').click();
    await expect(page).toHaveURL(new RegExp(`#/t/${KEY}/pool/10/teilnehmer`));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('verein-v2').click();
    await expect(page).toHaveURL(new RegExp(`#/t/${KEY}/verein/v2`));
});

test('Pools: Liste, Baum, Kampfliste und Teilnehmer eines Pools', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('tab-pools').click();
    await expect(page.getByTestId('pool-10')).toContainText('U15 w -44');
    await page.getByTestId('pool-10').click();
    await expect(page.getByTestId('reiter-baum')).toHaveClass(/aktiv/);
    await expect(page.getByTestId('kampf-1')).toContainText('Anna Muster');
    await page.getByTestId('reiter-kaempfe').click();
    await expect(page.getByTestId('baum-oeffnen')).toBeVisible();
    await page.getByTestId('reiter-teilnehmer').click();
    await expect(page.getByTestId('kachel-a1')).toContainText('Anna Muster');
    await page.goto(`/live/#/t/${KEY}/pool/999/baum`);
    await expect(page.getByText('Pool nicht gefunden')).toBeVisible();
});

test('Turnier: Matte mit laufendem Kampf, Klick öffnet die Kampfliste, von dort der Baum', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('tab-turnier').click();
    await expect(page.getByTestId('matte-1')).toHaveClass(/an/);
    await expect(page.getByTestId('laufend-1')).toContainText('Laufender Kampf');
    await page.getByTestId('laufend-1').click();
    await expect(page).toHaveURL(new RegExp('/pool/10/kaempfe/'));
    await expect(page.getByTestId('reiter-kaempfe')).toHaveClass(/aktiv/);
    await page.getByTestId('baum-oeffnen').click();
    await expect(page.getByTestId('reiter-baum')).toHaveClass(/aktiv/);
});
