import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { getLiveRoutes } from '../../src/routes/liveRoutes.js';
import { erzeugeToken } from '../../src/liveCloud/token.js';
import { erzeugeRatenbegrenzung } from '../../src/liveCloud/ratenbegrenzung.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import {
    endeDesTurniertags, CODE_MUSTER, erzeugeCode, holeOderErzeuge, erneuere, setzeGesperrt, pruefeZugang, loeseCodeAuf, loescheVerwaisteZugaenge
} from '../../src/liveCloud/zugang.js';

const paket = (turnierKey, extra = {}) => ({
    version: 1, turnierKey, name: `Turnier ${turnierKey}`, datum: '2026-10-24', stand: '2026-10-24T08:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer: [{
        key: 'a1', vorname: 'Anna', nachname: 'Muster', vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
        poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3, naechsterKampfId: 5, platz: null
    }],
    warteschlangen: [], ...extra
});

test('endeDesTurniertags: 06:00 Uhr Berliner Zeit am Folgetag, auch an den Zeitumstellungen', () => {
    // Sommerzeit (UTC+2): 06:00 Uhr = 04:00 UTC
    assert.equal(endeDesTurniertags('2026-10-23').toISOString(), '2026-10-24T04:00:00.000Z');
    // In der Nacht zum 25.10.2026 wird auf Winterzeit zurückgestellt: 06:00 Uhr am 25. ist schon UTC+1 = 05:00 UTC
    assert.equal(endeDesTurniertags('2026-10-24').toISOString(), '2026-10-25T05:00:00.000Z');
    assert.equal(endeDesTurniertags('2026-10-25').toISOString(), '2026-10-26T05:00:00.000Z');
    // Winterzeit (UTC+1)
    assert.equal(endeDesTurniertags('2026-12-05').toISOString(), '2026-12-06T05:00:00.000Z');
    // Umstellung auf Sommerzeit am 29.03.2026 (06:00 Uhr danach ist UTC+2 = 04:00 UTC)
    assert.equal(endeDesTurniertags('2026-03-28').toISOString(), '2026-03-29T04:00:00.000Z');
    assert.equal(endeDesTurniertags('2026-03-29').toISOString(), '2026-03-30T04:00:00.000Z');
    // Monats- und Jahreswechsel
    assert.equal(endeDesTurniertags('2026-12-31').toISOString(), '2027-01-01T05:00:00.000Z');
    for (const ungueltig of [null, undefined, '', 'morgen', '24.10.2026']) assert.equal(endeDesTurniertags(ungueltig), null);
});

test('Zugangscode: Format und Zufall', () => {
    const codes = new Set(Array.from({ length: 200 }, erzeugeCode));
    assert.equal(codes.size, 200);
    for (const c of codes) assert.match(c, CODE_MUSTER);
    for (const schlecht of ['', 'kurz', 'x'.repeat(23), `${'a'.repeat(21)}!`, null, 42]) assert.equal(CODE_MUSTER.test(schlecht), false);
});

let db, server, basis, token, jetztWert;
const sende = (pfad, { methode = 'GET', body, header = {} } = {}) => fetch(`${basis}${pfad}`, {
    method: methode, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...header }
});
const mitToken = (t = token) => ({ Authorization: `Bearer ${t}` });
let gebunden;

before(async () => {
    db = await starteTestPostgres();
    ({ token } = await erzeugeToken(db.knex, { name: 'ungebunden' }));
    ({ token: gebunden } = await erzeugeToken(db.knex, { name: 'ZG', turnierKey: 'ZG' }));
    jetztWert = new Date('2026-10-24T12:00:00Z');
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/live', getLiveRoutes(db.knex, {
        begrenzung: erzeugeRatenbegrenzung({ max: 500 }), fehlerBegrenzung: erzeugeRatenbegrenzung({ max: 100 }),
        zugangBegrenzung: erzeugeRatenbegrenzung({ max: 500, beiVollstand: 'sperren' }), jetzt: () => jetztWert, env: {}
    }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    basis = `http://127.0.0.1:${server.address().port}/api/live`;
    await uebernimmPaket(db.knex, paket('ZG'), { jetzt: () => jetztWert });
    await uebernimmPaket(db.knex, paket('ANDERES', { sequenz: 1 }), { jetzt: () => jetztWert });
});
after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.stoppe();
});

test('Zugang verwalten: nur mit dem an das Turnier gebundenen Token', async () => {
    assert.equal((await sende('/zugang')).status, 401, 'ohne Token');
    assert.equal((await sende('/zugang', { header: mitToken('hjl_falsch') })).status, 401);
    assert.equal((await sende('/zugang', { header: mitToken(token) })).status, 401, 'ein Token für alle Turniere darf keinen Code verwalten');

    const erster = await (await sende('/zugang', { header: mitToken(gebunden) })).json();
    assert.match(erster.code, CODE_MUSTER);
    assert.equal(erster.gesperrt, false);
    assert.equal(erster.gueltigBis, '2026-10-25T05:00:00.000Z', 'Ende des Turniertags (24.10.), 06:00 Uhr Berliner Zeit des Folgetags (Winterzeit)');
    assert.ok(erster.erzeugtAm);
    assert.deepEqual(await (await sende('/zugang', { header: mitToken(gebunden) })).json(), erster, 'derselbe Code beim zweiten Abruf');

    const neu = await (await sende('/zugang/erneuern', { methode: 'POST', header: mitToken(gebunden) })).json();
    assert.notEqual(neu.code, erster.code);
    assert.match(neu.code, CODE_MUSTER);
    assert.equal((await sende('/zugang/erneuern', { methode: 'POST', header: mitToken(token) })).status, 401);

    const gesperrt = await (await sende('/zugang/sperren', { methode: 'POST', body: { gesperrt: true }, header: mitToken(gebunden) })).json();
    assert.equal(gesperrt.gesperrt, true);
    assert.equal(gesperrt.code, neu.code, 'Sperren ändert den Code nicht');
    const frei = await (await sende('/zugang/sperren', { methode: 'POST', body: { gesperrt: false }, header: mitToken(gebunden) })).json();
    assert.equal(frei.gesperrt, false);
});

test('Turnierdaten nur mit dem richtigen Code: kein Hinweis auf bestehende Turniere', async () => {
    const { code } = await holeOderErzeuge(db.knex, 'ZG');
    const mit = (c) => ({ 'X-Live-Zugang': c });
    const alle = ['/turniere/ZG', '/turniere/ZG/suche?q=an', '/turniere/ZG/pools', '/turniere/ZG/dashboard', '/turniere/ZG/mannschaften', '/turniere/ZG/vereine/v1', '/turniere/ZG/pools/10'];
    for (const pfad of alle) {
        assert.equal((await sende(pfad)).status, 401, `${pfad} ohne Code`);
        assert.equal((await sende(pfad, { header: mit('x'.repeat(22)) })).status, 401, `${pfad} mit falschem Code`);
    }
    assert.equal((await sende('/turniere/ZG/uebersicht', { methode: 'POST', body: { teilnehmer: ['a1'] } })).status, 401);
    assert.equal((await sende('/turniere/ZG/push', { methode: 'PUT', body: {} })).status, 401);
    assert.equal((await sende('/turniere/ZG/push', { methode: 'DELETE', body: {} })).status, 401);

    // mit Code: 200, und der Inhalt stimmt
    const turnier = await sende('/turniere/ZG', { header: mit(code) });
    assert.equal(turnier.status, 200);
    assert.equal((await turnier.json()).name, 'Turnier ZG');
    assert.equal((await (await sende('/turniere/ZG/suche?q=anna', { header: mit(code) })).json()).treffer.length, 1);

    // der Code eines Turniers öffnet nie ein anderes
    assert.equal((await sende('/turniere/ANDERES', { header: mit(code) })).status, 401);
    // unbekanntes Turnier und falscher Code sind nicht zu unterscheiden
    const unbekannt = await sende('/turniere/gibtsnicht', { header: mit(code) });
    const falsch = await sende('/turniere/ZG', { header: mit('y'.repeat(22)) });
    assert.equal(unbekannt.status, falsch.status);
    assert.deepEqual(await unbekannt.json(), await falsch.json());
    // keine Liste aller Turniere
    assert.equal((await sende('/turniere')).status, 404);
    assert.equal((await sende('/turniere', { header: mit(code) })).status, 404);
    // der öffentliche Push-Schlüssel bleibt erreichbar (kein Turnierbezug); ohne Konfiguration 503
    assert.notEqual((await sende('/push/schluessel')).status, 401);
});

test('Code auflösen (Start der App nach dem Scannen)', async () => {
    const { code } = await holeOderErzeuge(db.knex, 'ZG');
    const ok = await sende('/zugang/aufloesen', { methode: 'POST', body: { code } });
    assert.equal(ok.status, 200);
    const daten = await ok.json();
    assert.deepEqual([daten.key, daten.name, daten.datum], ['ZG', 'Turnier ZG', '2026-10-24']);
    assert.equal(daten.serverzeit, '2026-10-24T12:00:00.000Z');
    assert.equal('code' in daten, false, 'der Code wird nicht zurückgegeben');
    for (const body of [{}, { code: '' }, { code: 'zu kurz' }, { code: 42 }]) {
        assert.equal((await sende('/zugang/aufloesen', { methode: 'POST', body })).status, 401, JSON.stringify(body));
    }
    assert.equal((await sende('/zugang/aufloesen', { methode: 'POST', body: { code: erzeugeCode() } })).status, 401);
});

test('Gesperrt, erneuert, abgelaufen und zurückgezogen', async () => {
    const { code } = await holeOderErzeuge(db.knex, 'ZG');
    const mit = (c) => ({ 'X-Live-Zugang': c });

    await setzeGesperrt(db.knex, 'ZG', true);
    for (const r of [await sende('/turniere/ZG', { header: mit(code) }), await sende('/zugang/aufloesen', { methode: 'POST', body: { code } })]) {
        assert.equal(r.status, 403);
        assert.equal((await r.json()).code, 'gesperrt');
    }
    await setzeGesperrt(db.knex, 'ZG', false);
    assert.equal((await sende('/turniere/ZG', { header: mit(code) })).status, 200);

    // erneuern: der alte Code ist sofort ungültig, der neue gilt
    const neu = (await erneuere(db.knex, 'ZG')).code;
    assert.equal((await sende('/turniere/ZG', { header: mit(code) })).status, 401);
    assert.equal((await sende('/turniere/ZG', { header: mit(neu) })).status, 200);

    // abgelaufen: nach 06:00 Uhr (Berlin) des Folgetags
    const vorher = jetztWert;
    try {
        jetztWert = new Date('2026-10-25T04:59:59Z');
        assert.equal((await sende('/turniere/ZG', { header: mit(neu) })).status, 200, 'eine Sekunde vor dem Ende');
        jetztWert = new Date('2026-10-25T05:00:00Z');
        const abgelaufen = await sende('/turniere/ZG', { header: mit(neu) });
        assert.equal(abgelaufen.status, 403);
        assert.deepEqual(await abgelaufen.json(), { error: 'Der Zugang ist abgelaufen', code: 'abgelaufen' });
        assert.equal((await sende('/zugang/aufloesen', { methode: 'POST', body: { code: neu } })).status, 403);
    } finally {
        jetztWert = vorher;
    }

    // Freigabe zurückgenommen: der Zugang endet sofort; eine Wiederfreigabe öffnet ihn wieder
    await uebernimmPaket(db.knex, { version: 1, turnierKey: 'ZG', zurueckgezogen: true, stand: '2026-10-24T12:00:00Z', sequenz: 2000 }, { jetzt: () => jetztWert });
    const zurueck = await sende('/turniere/ZG', { header: mit(neu) });
    assert.equal(zurueck.status, 403);
    assert.equal((await zurueck.json()).code, 'abgelaufen');
    await uebernimmPaket(db.knex, paket('ZG', { sequenz: 3000 }), { jetzt: () => jetztWert });
    assert.equal((await sende('/turniere/ZG', { header: mit(neu) })).status, 200);

    // manuell verlängerte Gültigkeit überstimmt das Ende des Turniertags
    await db.knex('live_zugang').where({ turnier_key: 'ZG' }).update({ gueltig_bis: new Date('2026-10-27T00:00:00Z') });
    jetztWert = new Date('2026-10-26T12:00:00Z');
    try {
        assert.equal((await sende('/turniere/ZG', { header: mit(neu) })).status, 200);
        assert.equal((await holeOderErzeuge(db.knex, 'ZG')).gueltigBis, '2026-10-27T00:00:00.000Z');
    } finally {
        jetztWert = vorher;
        await db.knex('live_zugang').where({ turnier_key: 'ZG' }).update({ gueltig_bis: null });
    }
});

test('Fehlversuche mit ungültigem Code werden begrenzt, richtige Codes nicht beeinträchtigt', async () => {
    const { code } = await holeOderErzeuge(db.knex, 'ZG');
    // eigener Server mit engem Limit (5 je Minute und Absender)
    const app = express();
    app.use(express.json());
    app.use('/api/live', getLiveRoutes(db.knex, {
        begrenzung: erzeugeRatenbegrenzung({ max: 500 }), fehlerBegrenzung: erzeugeRatenbegrenzung({ max: 100 }),
        zugangBegrenzung: erzeugeRatenbegrenzung({ max: 5, beiVollstand: 'sperren' }), jetzt: () => jetztWert, env: {}
    }));
    const eng = http.createServer(app);
    await new Promise((r) => eng.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${eng.address().port}/api/live`;
    try {
        const stati = [];
        for (let i = 0; i < 9; i += 1) stati.push((await fetch(`${b}/turniere/ZG`, { headers: { 'X-Live-Zugang': erzeugeCode() } })).status);
        assert.deepEqual(stati.slice(0, 5), [401, 401, 401, 401, 401]);
        assert.ok(stati.slice(5).every((st) => st === 429), `danach 429, Stati ${stati}`);
        // ein richtiger Code zählt nicht als Fehlversuch und kommt weiter durch
        assert.equal((await fetch(`${b}/turniere/ZG`, { headers: { 'X-Live-Zugang': code } })).status, 200);
        // auch die Auflösung des Codes ist begrenzt
        assert.equal((await fetch(`${b}/zugang/aufloesen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: erzeugeCode() }) })).status, 429);
    } finally {
        await new Promise((r) => eng.close(r));
    }
});

test('Service: pruefeZugang und loeseCodeAuf direkt, verwaiste Zugänge werden gelöscht', async () => {
    const { knex } = db;
    const jetzt = () => new Date('2026-10-24T12:00:00Z');
    const { code } = await holeOderErzeuge(knex, 'ZG');
    assert.deepEqual(await pruefeZugang(knex, 'ZG', code, { jetzt }), { ok: true });
    assert.deepEqual(await pruefeZugang(knex, 'ZG', 'kaputt', { jetzt }), { ok: false, grund: 'ungueltig' });
    assert.deepEqual(await pruefeZugang(knex, 'NIE', code, { jetzt }), { ok: false, grund: 'ungueltig' });
    assert.equal((await loeseCodeAuf(knex, code, { jetzt })).ok, true);
    assert.deepEqual(await loeseCodeAuf(knex, erzeugeCode(), { jetzt }), { ok: false, grund: 'ungueltig' });

    // Zugang ohne Turnier in der Cloud und älter als 14 Tage: wird gelöscht; ein junger bleibt
    await holeOderErzeuge(knex, 'WEG');
    await knex('live_zugang').where({ turnier_key: 'WEG' }).update({ erzeugt_am: new Date('2026-09-01T00:00:00Z') });
    await holeOderErzeuge(knex, 'JUNG');
    assert.equal(await loescheVerwaisteZugaenge(knex, { jetzt }), 1);
    assert.equal(await knex('live_zugang').where({ turnier_key: 'WEG' }).first(), undefined);
    assert.ok(await knex('live_zugang').where({ turnier_key: 'JUNG' }).first());
    assert.ok(await knex('live_zugang').where({ turnier_key: 'ZG' }).first(), 'Zugang eines vorhandenen Turniers bleibt');
});
