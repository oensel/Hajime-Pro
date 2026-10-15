import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import {
    ladeTurnier, sucheMannschaften, listeMannschaftsPools, ladeMannschaft, uebersichtMannschaften
} from '../../src/liveCloud/abfrage.js';
import { bedingungenFuerTeam, meldeAn, pruefeUndSende } from '../../src/liveCloud/push.js';
import { baueTeamNachricht } from '../../src/liveCloud/pushText.js';

const team = (key, bezeichnung, extra = {}) => ({
    key, bezeichnung, verein: 'JC Senden', vereinKey: 'v1', poolId: 7, poolBezeichnung: 'U15 w Team', modus: 'Jeder-gegen-Jeden',
    poolStatus: 'gestartet', altersklasse: 'U15', geschlecht: 'weiblich', matteId: 1, matteBezeichnung: 'Matte 1',
    zustand: 'in_n', abstand: 2, naechsteBegegnungId: 31, gegner: 'Team 2', siege: 1, niederlagen: 0,
    mitglieder: [{ vorname: 'Anna', nachname: 'Adler', gewichtsklasse: '-40' }, { vorname: 'Berta', nachname: 'Busch', gewichtsklasse: '+57' }],
    ...extra
});
const paket = (extra = {}) => ({
    version: 1, turnierKey: 'M', name: 'Mannschaftsturnier', datum: '2026-10-15', stand: '2026-10-15T10:00:00.000Z', sequenz: 100,
    vereine: [{ key: 'v1', name: 'JC Senden' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }], teilnehmer: [], warteschlangen: [],
    mannschaften: [team('t1', 'Team 1'), team('t2', 'Team 2', { zustand: 'laeuft', abstand: 0, naechsteBegegnungId: 30, gegner: 'Team 1' })],
    begegnungen: [
        { id: 30, poolId: 7, nr: '1', runde: 1, status: 'gestartet', matteId: 1, team1: 't2', team2: 't1', s1: 0, s2: 0, sieger: null, abstand: 0 },
        { id: 31, poolId: 7, nr: '2', runde: 2, status: 'bereit', matteId: 1, team1: 't1', team2: 't2', s1: 0, s2: 0, sieger: null, abstand: 2 },
        { id: 29, poolId: 7, nr: '0', runde: 1, status: 'beendet', matteId: 1, team1: 't1', team2: 't2', s1: 3, s2: 2, sieger: 't1', abstand: null }
    ],
    ...extra
});

let db;
before(async () => {
    db = await starteTestPostgres();
    await uebernimmPaket(db.knex, paket());
});
after(async () => { if (db) await db.stoppe(); });

test('Turnier meldet, ob es Einzel und/oder Mannschaften gibt (Umschalter)', async () => {
    const turnier = await ladeTurnier(db.knex, 'M');
    assert.equal(turnier.hatMannschaften, true);
    assert.equal(turnier.hatEinzel, false);
});

test('Suche: Team nach Name, Mitglied führt zum Team', async () => {
    const nachName = await sucheMannschaften(db.knex, 'M', 'team 1');
    assert.deepEqual(nachName.mannschaften.map(t => t.key), ['t1']);
    const nachKaempfer = await sucheMannschaften(db.knex, 'M', 'adler');
    assert.equal(nachKaempfer.mitglieder.length, 2); // Anna steht in beiden Teams
    assert.equal(nachKaempfer.mitglieder[0].mannschaft.bezeichnung, 'Team 1');
    assert.deepEqual(nachKaempfer.mannschaften, []);
});

test('Mannschafts-Pools mit Fortschritt und Matten', async () => {
    const pools = await listeMannschaftsPools(db.knex, 'M');
    assert.equal(pools.length, 1);
    assert.deepEqual([pools[0].teams, pools[0].gesamt, pools[0].beendet, pools[0].laeuft], [2, 3, 1, 1]);
    assert.deepEqual(pools[0].matten, [{ id: 1, bezeichnung: 'Matte 1' }]);
});

test('Team-Ansicht: Begegnungen mit Ergebnis aus Sicht des Teams, Aufstellung', async () => {
    const t1 = await ladeMannschaft(db.knex, 'M', 't1');
    assert.equal(t1.mannschaft.bezeichnung, 'Team 1');
    assert.equal(t1.mitglieder.length, 2);
    const beendet = t1.begegnungen.find(b => b.id === 29);
    assert.deepEqual([beendet.eigene, beendet.fremde, beendet.gewonnen, beendet.gegner], [3, 2, true, 'Team 2']);
    assert.equal(t1.begegnungen.find(b => b.id === 31).gewonnen, null);
    assert.equal(await ladeMannschaft(db.knex, 'M', 'gibtsnicht'), null);
});

test('Übersicht liefert verfolgte Teams', async () => {
    const liste = await uebersichtMannschaften(db.knex, 'M', { mannschaften: ['t2', 'unbekannt'] });
    assert.deepEqual(liste.map(t => t.key), ['t2']);
    assert.deepEqual(await uebersichtMannschaften(db.knex, 'M', {}), []);
});

test('Push-Bedingung: nur innerhalb der Schwelle, mit Begegnung als Bezug', () => {
    assert.deepEqual(bedingungenFuerTeam({ zustand: 'in_n', abstand: 2, naechste_begegnung_id: 31 }), [{ art: 'begegnung', bezug: 31, abstand: 2 }]);
    assert.deepEqual(bedingungenFuerTeam({ zustand: 'in_n', abstand: 4, naechste_begegnung_id: 31 }), []);
    assert.deepEqual(bedingungenFuerTeam({ zustand: 'laeuft', abstand: 0, naechste_begegnung_id: 30 }), [{ art: 'begegnung', bezug: 30, abstand: 0 }]);
    assert.deepEqual(bedingungenFuerTeam({ zustand: 'wartet', abstand: null, naechste_begegnung_id: 31 }), []);
});

test('Push-Text für Teams', () => {
    const n = baueTeamNachricht({ turnierKey: 'M', turnierName: 'Cup', team: 'Team 1', gegner: 'Team 2', matte: 'Matte 1', abstand: 2 });
    assert.match(n.text, /Team 1 gegen Team 2: Begegnung in 2 Begegnungen \(Matte 1\)/);
    assert.match(baueTeamNachricht({ turnierKey: 'M', turnierName: 'Cup', team: 'Team 1', gegner: '', matte: '', abstand: 0 }).text, /Begegnung als Nächstes/);
});

test('Glocke am Team: Anmeldung und genau eine Nachricht je Begegnung', async () => {
    const konfig = { maxAbos: 10, tage: 3 };
    const abo = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };
    // Neues Paket: Team 1 rückt in die Schwelle (abstand 1, neue Begegnung 40), Anmeldung davor
    await meldeAn(db.knex, 'M', { abo, glocken: { teilnehmer: ['t1'], vereine: [], ausnahmen: [] } }, { konfig });
    await uebernimmPaket(db.knex, paket({
        sequenz: 200,
        mannschaften: [team('t1', 'Team 1', { zustand: 'als_naechstes', abstand: 0, naechsteBegegnungId: 40, gegner: 'Team 3' }), team('t2', 'Team 2')],
        begegnungen: [{ id: 40, poolId: 7, nr: '3', runde: 3, status: 'bereit', matteId: 1, team1: 't1', team2: 't2', s1: 0, s2: 0, sieger: null, abstand: 0 }]
    }));
    const gesendet = [];
    const sender = async (a, nachricht) => { gesendet.push(nachricht); };
    const erstes = await pruefeUndSende(db.knex, 'M', { sender });
    assert.equal(erstes.gesendet, 1);
    assert.match(gesendet[0].text, /Team 1 gegen Team 3/);
    const zweites = await pruefeUndSende(db.knex, 'M', { sender });
    assert.equal(zweites.gesendet, 0);
});
