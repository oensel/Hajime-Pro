// End-to-End: Teilnehmer-App mit Mannschaften — Suche (Team und Mitglied), Umschalter nur bei beidem,
// Team-Ansicht, Stern/Glocke nur am Team, Übersicht.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

let KEY = '';
let zaehler = 0;
test.beforeEach(() => { KEY = `E2E-LIVE-TEAM-${Date.now()}-${zaehler++}`; });
const TOKEN = 'hjl_e2e_team_token_0123456789abcdef0123456789abcdef';

const team = (key, bezeichnung, extra = {}) => ({
    key, bezeichnung, verein: 'JC Senden', vereinKey: 'v1', poolId: 7, poolBezeichnung: 'U15 w Team', modus: 'Jeder-gegen-Jeden',
    poolStatus: 'gestartet', altersklasse: 'U15', geschlecht: 'weiblich', matteId: 1, matteBezeichnung: 'Matte 2',
    zustand: 'in_n', abstand: 2, naechsteBegegnungId: 31, gegner: 'Team 2', siege: 1, niederlagen: 0,
    mitglieder: [{ vorname: 'Anna', nachname: 'Adler', gewichtsklasse: '-40' }, { vorname: 'Berta', nachname: 'Busch', gewichtsklasse: '+57' }],
    ...extra
});
const paket = (sequenz, extra = {}) => ({
    version: 1, turnierKey: KEY, name: 'Team-E2E-Turnier', datum: new Date().toISOString().slice(0, 10),
    stand: new Date().toISOString(), sequenz,
    vereine: [{ key: 'v1', name: 'JC Senden' }], matten: [{ id: 1, bezeichnung: 'Matte 2' }],
    teilnehmer: [], warteschlangen: [],
    mannschaften: [team('t1', 'Team 1'), team('t2', 'Team 2', { zustand: 'laeuft', abstand: 0, naechsteBegegnungId: 30, gegner: 'Team 1' })],
    begegnungen: [
        { id: 29, poolId: 7, nr: '1', runde: 1, status: 'beendet', matteId: 1, team1: 't1', team2: 't2', s1: 3, s2: 2, sieger: 't1', abstand: null },
        { id: 31, poolId: 7, nr: '2', runde: 2, status: 'bereit', matteId: 1, team1: 't1', team2: 't2', s1: 0, s2: 0, sieger: null, abstand: 2 }
    ],
    ...extra
});

test.beforeAll(async () => {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('live_ingest_tokens').where({ name: 'e2e-team' }).del();
        await db('live_ingest_tokens').insert({ name: 'e2e-team', token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex') });
        await db('live_turniere').where('turnier_key', 'like', 'E2E-LIVE-TEAM-%').del();
    } finally {
        await db.destroy();
    }
});

async function sende(request, daten) {
    const r = await request.post('/api/live/ingest', { data: daten, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status(), await r.text()).toBe(204);
}

test('Suche: Team und Kämpfer führen zum Team, Stern und Glocke nur am Team, Übersicht', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);

    // Suche nach dem Teamnamen: Team mit Stern und Glocke
    await page.getByTestId('suchfeld').fill('team 1');
    await expect(page.getByTestId('team-t1')).toContainText('Team 1');
    await expect(page.getByTestId('team-t1')).toContainText('In 2 Begegnungen');

    // Suche nach einem Kämpfer: Zeile führt zum Team, ohne eigenen Stern
    await page.getByTestId('suchfeld').fill('adler');
    const zeile = page.getByTestId('mitglied-t1');
    await expect(zeile).toContainText('Adler, Anna');
    await expect(zeile).toContainText('Mannschaft Team 1');
    await expect(page.locator('[data-testid^="stern-"]')).toHaveCount(0);
    await zeile.click();

    // Team-Ansicht
    await expect(page.getByRole('heading', { name: 'Team 1' })).toBeVisible();
    await expect(page.getByTestId('team-begegnungen')).toContainText('gewonnen 3:2');
    await expect(page.getByTestId('team-begegnungen')).toContainText('in 2 Begegnungen');
    await expect(page.getByTestId('team-aufstellung')).toContainText('−40 kg · Adler, Anna');
    await expect(page.getByTestId('team-aufstellung').locator('button')).toHaveCount(0);

    await page.getByTestId('team-stern').click();
    await expect(page.getByTestId('team-stern')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('team-glocke')).toBeVisible();

    // Übersicht zeigt das verfolgte Team
    await page.getByTestId('tab-uebersicht').click();
    await expect(page.getByTestId('team-t1')).toContainText('Team 1');
    await expect(page.getByTestId('team-t1')).toContainText('In 2 Begegnungen');
    await expect(page.getByTestId('team-t2')).toHaveCount(0);
});

test('Pools: nur Mannschaften ohne Umschalter; mit Einzel-Pools erscheint der Umschalter', async ({ page, request }) => {
    await sende(request, paket(Date.now() + 1000));
    await page.goto(`/live/#/t/${KEY}/pools`);
    await expect(page.getByTestId('pools-umschalter')).toHaveCount(0);
    await expect(page.getByTestId('mannschaftspool-7')).toContainText('U15 weiblich · Team');
    await expect(page.getByTestId('mannschaftspool-7')).toContainText('2 Teams');
    await page.getByTestId('mannschaftspool-7').click();
    await expect(page.getByTestId('mannschaftspool-teams')).toContainText('Team 2');
    await page.getByTestId('team-t2').click();
    await expect(page.getByRole('heading', { name: 'Team 2' })).toBeVisible();

    // Zusätzlich ein Einzel-Pool: jetzt gibt es beides
    await sende(request, paket(Date.now() + 2000, {
        teilnehmer: [{
            key: 'a1', vorname: 'Anna', nachname: 'Muster', vereinKey: 'v1', verein: 'JC Senden', altersklasse: 'U13', gewichtsklasse: '-34',
            geschlecht: 'w', poolId: 10, poolBezeichnung: 'U13 w -34', matteId: 1, matteBezeichnung: 'Matte 2', zustand: 'in_n', abstand: 3,
            naechsterKampfId: 5, platz: null
        }],
        pools: [{ id: 10, bezeichnung: 'U13 w -34', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U13', geschlecht: 'w', gewichtsklasse: '-34', farbe2: 'blau' }]
    }));
    await page.goto(`/live/#/t/${KEY}/pools`);
    await expect(page.getByTestId('pools-umschalter')).toBeVisible();
    await expect(page.getByTestId('pool-10')).toBeVisible();
    await page.getByTestId('pools-umschalter').getByText('Mannschaften').click();
    await expect(page.getByTestId('mannschaftspool-7')).toBeVisible();
});
