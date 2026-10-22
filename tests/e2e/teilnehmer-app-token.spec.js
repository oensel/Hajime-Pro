// End-to-End: Live-Token und Geheimnis eines aus der Cloud geholten Turniers (Teilnehmer-App-Schalter,
// docs/specs/2026-10-22-teilnehmer-app-schalter-design.md): der Import speichert sie, nach außen kommen sie nie.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

const TOKEN = 'hjl_testtoken123456';

async function leseDb(id) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        return await db('turniere').where({ id }).first();
    } finally {
        await db.destroy();
    }
}

async function setzeInDb(id, werte) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id }).update(werte);
    } finally {
        await db.destroy();
    }
}

async function importiere(request, datum, live) {
    const daten = {
        exportiert_am: new Date().toISOString(),
        turnier: {
            id: 9001, bezeichnung: `Token-Import ${datum}`, ort: 'Cloudstadt', datum, ausrichter: 'JC Token',
            nutze_gewichtsklassen: 1, anzahl_kampfflaechen: 1, altersklassen: [], mannschafts_altersklassen: [],
            status: 'veroeffentlicht'
        },
        kampfflaechen: [], pools: [], teilnehmer: [], kaempfe: [], mannschaften: [], mannschaft_mitglieder: []
    };
    if (live) daten.live = live;
    const inhalt = Buffer.from(JSON.stringify(daten), 'utf-8').toString('base64');
    const r = await request.post('/api/turniere/import', { data: { contentBase64: inhalt } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).turnierId;
}

test('Import speichert Token und erzeugt ein Geheimnis, das Turnier startet ausgeschaltet', async ({ request }) => {
    const id = await importiere(request, '2031-03-01', { token: TOKEN });
    const zeile = await leseDb(id);
    expect(zeile.live_token).toBe(TOKEN);
    expect(zeile.live_geheimnis).toMatch(/^[0-9a-f]{64}$/);
    expect(zeile.live_freigabe).toBe(false);
    expect(zeile.live_ruecknahme).toBe(false);
});

test('Import ohne Live-Abschnitt oder mit ungültigem Token lässt beide Spalten leer', async ({ request }) => {
    const ohne = await leseDb(await importiere(request, '2031-03-02', null));
    expect(ohne.live_token).toBeNull();
    expect(ohne.live_geheimnis).toBeNull();
    const kurz = await leseDb(await importiere(request, '2031-03-03', { token: 'x' }));
    expect(kurz.live_token).toBeNull();
    expect(kurz.live_geheimnis).toBeNull();
});

test('Token, Geheimnis und Rücknahme-Merker kommen in keiner Antwort und keinem Export vor', async ({ request }) => {
    const id = await importiere(request, '2031-03-04', { token: TOKEN });
    await setzeInDb(id, { status: 'veroeffentlicht', live_ruecknahme: true });
    const geheimnis = (await leseDb(id)).live_geheimnis;

    const antworten = [
        await (await request.get('/api/turniere')).text(),
        await (await request.get(`/api/turniere/${id}`)).text(),
        await (await request.get(`/api/turniere/${id}/export`)).text()
    ];
    for (const text of antworten) {
        expect(text).not.toContain('live_token');
        expect(text).not.toContain('live_geheimnis');
        expect(text).not.toContain('live_ruecknahme');
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(geheimnis);
    }
});
