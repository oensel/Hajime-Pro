import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { pruefePauseFuerKampf } from '../../../../src/db/kaskaden/pausenPruefung.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createKaempfeRepository(db);
}

test('pruefePauseFuerKampf meldet zu kurze Pause seit dem letzten Kampf desselben Athleten', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({
        pool_id: 'pool:1', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'angelegt'
    });
    // Ein frisch erstelltes Dokument hat noch kein updated_at (nur create() stempelt
    // created_at, siehe kaempfeRepository.js) -- pausenRegel.js liest ausschließlich
    // updated_at, ohne Fallback. Der Kampf muss deshalb über update() auf 'beendet' gesetzt
    // werden, genau wie es im echten Betrieb passieren würde, damit updated_at tatsächlich
    // gesetzt ist.
    const beendeterKampf = await repo.update(kampf._id, { status: 'beendet' });
    // update() stempelt updated_at auf JETZT -- die Prüfung tut so, als wäre seitdem nur eine
    // Minute vergangen (deutlich weniger als die 6 Minuten Mindestpause für U15).
    const jetztMs = new Date(beendeterKampf.updated_at).getTime() + 60 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U15', jetztMs);

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.kaempfer.length, 1);
    assert.equal(ergebnis.kaempfer[0].id, 'teilnehmer:1');
    assert.equal(ergebnis.kaempfer[0].benoetigteSekunden, 360);
});

test('pruefePauseFuerKampf meldet ausreichende Pause nach genug verstrichener Zeit', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({
        pool_id: 'pool:1', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'angelegt'
    });
    const beendeterKampf = await repo.update(kampf._id, { status: 'beendet' });
    // 400 Sekunden seit Kampfende -- mehr als die 360 Sekunden Mindestpause für U15.
    const jetztMs = new Date(beendeterKampf.updated_at).getTime() + 400 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U15', jetztMs);

    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.kaempfer.length, 0);
});

test('pruefePauseFuerKampf erlaubt Athleten ohne vorherigen Kampf sofort', async () => {
    const repo = await neuesRepository();

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U18', Date.now());

    assert.equal(ergebnis.ok, true);
});

test('pruefePauseFuerKampf berücksichtigt Kämpfe aus anderen Pools desselben Turniers', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({
        pool_id: 'pool:andere-gewichtsklasse', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:9', status: 'angelegt'
    });
    const beendeterKampf = await repo.update(kampf._id, { status: 'beendet' });
    const jetztMs = new Date(beendeterKampf.updated_at).getTime() + 60 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U18', jetztMs);

    assert.equal(ergebnis.ok, false);
});
