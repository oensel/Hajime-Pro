// Die Lese-API eines Client-Geräts (Node-Client und Android-App) als reine Funktion über Dokumente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { beantworteClientAnfrage } from '../../src/shared/clientAntworten.js';

const sha256Hex = async (text) => createHash('sha256').update(text).digest('hex');

function fakeDb(dokumente) {
    const nachId = new Map(dokumente.map(d => [d._id, d]));
    return {
        allDocs: async () => ({ rows: dokumente.map(doc => ({ id: doc._id, doc })) }),
        get: async (id) => {
            if (!nachId.has(id)) throw Object.assign(new Error('missing'), { status: 404 });
            return nachId.get(id);
        }
    };
}

const DOKUMENTE = [
    { _id: 'turnier:1', _rev: '1-a', dokumenttyp: 'turnier', id: 1, bezeichnung: 'Test-Cup', altersklassen: '["U15","U18"]', sql_id: 1, bearbeitet_von: 'server' },
    { _id: 'kampfflaeche:1', dokumenttyp: 'kampfflaeche', id: 1, turnier_id: 1, bezeichnung: 'Matte 1' },
    { _id: 'kampfflaeche:2', dokumenttyp: 'kampfflaeche', id: 2, turnier_id: 1, bezeichnung: 'Matte 2' },
    { _id: 'teilnehmer:1', dokumenttyp: 'teilnehmer', id: 1, turnier_id: 1, nachname: 'Zander', vorname: 'Zoe', sql_id: 1 },
    { _id: 'teilnehmer:2', dokumenttyp: 'teilnehmer', id: 2, turnier_id: 1, nachname: 'Adler', vorname: 'Anna', sql_id: 2 },
    { _id: 'teilnehmer:3', dokumenttyp: 'teilnehmer', id: 3, turnier_id: 1, nachname: 'Dublette', vorname: 'Anna', dublette_von: 2, sql_id: 3 },
    { _id: 'konfig:steuerung', dokumenttyp: 'konfig', steuerung_passwort_sha256: createHash('sha256').update('geheim').digest('hex') }
];
const anfrage = (methode, pfad, extra = {}) => beantworteClientAnfrage({ methode, pfad, ...extra }, { db: fakeDb(DOKUMENTE), sha256Hex });

test('Turniere und Turnier-Details tragen keine Sync-Metadaten und haben geparste Listen', async () => {
    const liste = await anfrage('GET', '/turniere');
    assert.equal(liste.status, 200);
    assert.deepEqual(liste.body[0].altersklassen, ['U15', 'U18']);
    assert.equal(liste.body[0].teilnehmer_anzahl, 3);
    for (const verboten of ['_id', '_rev', 'dokumenttyp', 'sql_id', 'bearbeitet_von']) assert.ok(!(verboten in liste.body[0]), verboten);
    assert.equal((await anfrage('GET', '/turniere/1')).body.bezeichnung, 'Test-Cup');
    assert.equal((await anfrage('GET', '/turniere/99')).status, 404);
});

test('Matten und Teilnehmer: nach Turnier gefiltert, Dubletten ausgeblendet, nach Nachname sortiert', async () => {
    const matten = await anfrage('GET', '/kampfflaechen', { query: { turnierId: '1' } });
    assert.deepEqual(matten.body.map(m => m.bezeichnung), ['Matte 1', 'Matte 2']);
    const teilnehmer = await anfrage('GET', '/teilnehmer', { query: { turnierId: '1' } });
    assert.deepEqual(teilnehmer.body.map(t => t.nachname), ['Adler', 'Zander']);
    assert.equal((await anfrage('GET', '/teilnehmer/2')).body.vorname, 'Anna');
    assert.equal((await anfrage('GET', '/teilnehmer/77')).status, 404);
});

test('Steuerungs-Passwort wird gegen den replizierten Hash geprüft', async () => {
    assert.deepEqual((await anfrage('GET', '/auth/mode')).body, { passwordRequired: true });
    assert.equal((await anfrage('POST', '/auth/verify', { kopfzeilen: { 'x-steuerung-password': 'geheim' } })).status, 200);
    assert.equal((await anfrage('POST', '/auth/verify', { body: { password: 'geheim' } })).status, 200);
    assert.equal((await anfrage('POST', '/auth/verify', { body: { password: 'falsch' } })).status, 401);
});

test('Nur Lesezugriffe der Client-Seiten: alles andere gibt es nur am Hallen-Server', async () => {
    assert.equal((await anfrage('GET', '/pools/details')).status, 404);
    assert.equal((await anfrage('POST', '/teilnehmer', { body: {} })).status, 403);
    assert.equal((await anfrage('DELETE', '/turniere/1')).status, 403);
    assert.equal((await anfrage('GET', '/kaempfe')).status, 400);
    assert.deepEqual((await anfrage('GET', '/mannschaften')).body, []);
    assert.deepEqual((await anfrage('GET', '/pools/vorhanden', { query: { turnierId: '1' } })).body, { gesperrt: false });
});
