import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloudUpdateMoeglich, erzeugeCloudUpdate, NEUSTART_EXITCODE } from '../../src/utils/cloudUpdate.js';
import { installiereDienstPaket, fuehreVorgemerktenAustauschAus } from '../../src/utils/dienstUpdate.js';

const stumm = { log() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-update-'));
const schreibe = (dir, datei, inhalt) => {
    fs.mkdirSync(path.dirname(path.join(dir, datei)), { recursive: true });
    fs.writeFileSync(path.join(dir, datei), inhalt);
};
const lies = (dir, datei) => fs.readFileSync(path.join(dir, datei), 'utf8');

test('cloudUpdateMoeglich: nur Cloud, mit Überwacher, nicht im Docker-Container', () => {
    const cloud = { BETRIEBSMODUS: 'cloud', HAJIME_UEBERWACHT: '1' };
    assert.equal(cloudUpdateMoeglich(cloud, { dockerErkannt: false }).moeglich, true);
    assert.equal(cloudUpdateMoeglich({ ...cloud, INVOCATION_ID: 'x', HAJIME_UEBERWACHT: '' }, { dockerErkannt: false }).moeglich, true);
    assert.equal(cloudUpdateMoeglich({ BETRIEBSMODUS: 'server', HAJIME_UEBERWACHT: '1' }, { dockerErkannt: false }).moeglich, false);
    assert.equal(cloudUpdateMoeglich({ BETRIEBSMODUS: 'cloud' }, { dockerErkannt: false }).moeglich, false);
    assert.match(cloudUpdateMoeglich(cloud, { dockerErkannt: true }).grund, /Docker/);
    assert.equal(cloudUpdateMoeglich({ ...cloud, HAJIME_CLOUD_UPDATE: 'false' }, { dockerErkannt: false }).moeglich, false);
});

// Baut ein "Paket" ohne echtes tar/npm: der falsche tar legt die Dateien der neuen Version an.
function fakeAusfuehrung(neueDateien) {
    return async (befehl, args, optionen = {}) => {
        if (befehl === 'tar') {
            const ziel = path.resolve(optionen.cwd || '.', args[args.indexOf('-C') + 1]);
            for (const [datei, inhalt] of Object.entries(neueDateien)) schreibe(ziel, datei, inhalt);
        }
    };
}
const paketDateien = (version, extra = {}) => ({
    'src/app.js': `app ${version}`, 'package.json': `{"version":"${version}"}`, 'package-lock.json': '{}', 'knexfile.cjs': '', 'node_modules/x.js': `modul ${version}`, ...extra
});

test('installiereDienstPaket tauscht sofort aus und lässt Teile stehen, die das Paket nicht mitbringt', async () => {
    const dir = tmp();
    schreibe(dir, 'src/app.js', 'app 1.0.0');
    schreibe(dir, 'node_modules/x.js', 'modul 1.0.0');
    schreibe(dir, 'scripts/cloud-lokal.mjs', 'start');
    schreibe(dir, '.env.cloud-lokal', 'GEHEIM=1');
    const ergebnis = await installiereDienstPaket({
        paket: 'p.tgz', installDir: dir, aktuelleVersion: '1.0.0', neueVersion: '1.0.1',
        fuehreAus: fakeAusfuehrung(paketDateien('1.0.1')), anzeige: { meldung() {} }
    });
    assert.equal(ergebnis.vorgemerkt, undefined);
    assert.equal(lies(dir, 'src/app.js'), 'app 1.0.1');
    assert.equal(lies(dir, 'node_modules/x.js'), 'modul 1.0.1');
    assert.equal(lies(dir, 'scripts/cloud-lokal.mjs'), 'start');   // optionaler Teil fehlt im Paket: bleibt
    assert.equal(lies(dir, '.env.cloud-lokal'), 'GEHEIM=1');
    assert.equal(lies(path.join(dir, '.update', 'alt-1.0.0'), 'src/app.js'), 'app 1.0.0');
});

test('installiereDienstPaket reicht die Migrations-Umgebung an knex weiter', async () => {
    const dir = tmp();
    const befehle = [];
    await installiereDienstPaket({
        paket: 'p.tgz', installDir: dir, aktuelleVersion: '1.0.0', neueVersion: '1.0.1', migrationsUmgebung: 'online-migration',
        fuehreAus: async (befehl, args, opt) => { befehle.push(args); await fakeAusfuehrung(paketDateien('1.0.1'))(befehl, args, opt); },
        anzeige: { meldung() {} }
    });
    const knex = befehle.find((a) => a.includes('migrate:latest'));
    assert.equal(knex[knex.indexOf('--env') + 1], 'online-migration');
});

test('installiereDienstPaket mit austausch spaeter bereitet nur vor, der Austausch folgt per fuehreVorgemerktenAustauschAus', async () => {
    const dir = tmp();
    schreibe(dir, 'src/app.js', 'app 1.0.0');
    schreibe(dir, 'node_modules/x.js', 'modul 1.0.0');
    const ergebnis = await installiereDienstPaket({
        paket: 'p.tgz', installDir: dir, aktuelleVersion: '1.0.0', neueVersion: '1.0.1', austausch: 'spaeter',
        fuehreAus: fakeAusfuehrung(paketDateien('1.0.1')), anzeige: { meldung() {} }
    });
    assert.equal(ergebnis.vorgemerkt, true);
    assert.equal(lies(dir, 'src/app.js'), 'app 1.0.0');          // noch alt

    assert.equal(fuehreVorgemerktenAustauschAus(dir, stumm), '1.0.1');
    assert.equal(lies(dir, 'src/app.js'), 'app 1.0.1');
    assert.equal(lies(dir, 'node_modules/x.js'), 'modul 1.0.1');
    assert.equal(fuehreVorgemerktenAustauschAus(dir, stumm), null);   // Vormerkung ist verbraucht
});

test('fuehreVorgemerktenAustauschAus ohne Vormerkung oder mit kaputter Vormerkung ändert nichts', () => {
    const dir = tmp();
    schreibe(dir, 'src/app.js', 'app 1.0.0');
    assert.equal(fuehreVorgemerktenAustauschAus(dir, stumm), null);
    schreibe(dir, '.update/austausch.json', '{kaputt');
    assert.equal(fuehreVorgemerktenAustauschAus(dir, stumm), null);
    assert.equal(lies(dir, 'src/app.js'), 'app 1.0.0');
    assert.equal(fs.existsSync(path.join(dir, '.update', 'austausch.json')), false);
});

function dienst(optionen = {}) {
    const dir = tmp();
    const beendet = [];
    const aufrufe = { geladen: 0, installiert: [] };
    const dst = erzeugeCloudUpdate({
        installDir: dir, aktuelleVersion: '1.0.0', env: { BETRIEBSMODUS: 'cloud' },
        moeglichkeit: { moeglich: true, grund: null }, log: stumm,
        ladeSchluessel: async () => 'schluessel', neuesteVersionFn: async () => '1.0.1',
        ladeFn: async () => { aufrufe.geladen++; return { status: 'bereit', version: '1.0.1', datei: 'p.tgz' }; },
        installiere: async (a) => { aufrufe.installiert.push(a); a.anzeige.meldung('Schritt'); return { alt: 'x' }; },
        beenden: (code) => beendet.push(code), warte: async () => {},
        ...optionen
    });
    return { dst, dir, beendet, aufrufe };
}
const warteBis = async (bedingung) => { for (let i = 0; i < 100 && !bedingung(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('Cloud-Update: Status meldet verfügbares Release', async () => {
    const { dst } = dienst();
    const st = await dst.status();
    assert.equal(st.updateVerfuegbar, true);
    assert.equal(st.neuesteVersion, '1.0.1');
    assert.equal(st.zustand, 'bereit');
});

test('Cloud-Update: Start installiert, meldet Neustart und beendet den Prozess mit dem Neustart-Code', async () => {
    const { dst, beendet, aufrufe } = dienst();
    const antwort = await dst.starte();
    assert.deepEqual(antwort, { success: true, ziel: '1.0.1' });
    await warteBis(() => beendet.length > 0);
    assert.deepEqual(beendet, [NEUSTART_EXITCODE]);
    assert.equal(aufrufe.installiert[0].neueVersion, '1.0.1');
    assert.equal(aufrufe.installiert[0].migrationsUmgebung, 'online');
    assert.equal((await dst.status()).zustand, 'neustart');
});

test('Cloud-Update: mit DB_URL_MIGRATION wird über die Migrations-Verbindung migriert', async () => {
    const { dst, beendet, aufrufe } = dienst({ env: { BETRIEBSMODUS: 'cloud', DB_URL_MIGRATION: 'postgres://x' } });
    await dst.starte();
    await warteBis(() => beendet.length > 0);
    assert.equal(aufrufe.installiert[0].migrationsUmgebung, 'online-migration');
});

test('Cloud-Update: zweiter Start während des Laufs wird abgelehnt', async () => {
    let frei;
    const { dst } = dienst({ installiere: () => new Promise((r) => { frei = () => r({ alt: 'x' }); }) });
    await dst.starte();
    await assert.rejects(() => dst.starte(), (e) => e.status === 409 && /läuft bereits/.test(e.message));
    await warteBis(() => frei);
    frei();
});

test('Cloud-Update: ohne Möglichkeit oder ohne neueres Release 409', async () => {
    const a = dienst({ moeglichkeit: { moeglich: false, grund: 'Docker' } });
    await assert.rejects(() => a.dst.starte(), (e) => e.status === 409 && e.message === 'Docker');
    const b = dienst({ neuesteVersionFn: async () => '1.0.0' });
    await assert.rejects(() => b.dst.starte(), (e) => e.status === 409);
    const c = dienst({ neuesteVersionFn: async () => null });
    await assert.rejects(() => c.dst.starte(), (e) => e.status === 409);
});

test('Cloud-Update: Fehler beim Installieren landet im Status, der Server läuft weiter', async () => {
    const { dst, beendet } = dienst({ installiere: async () => { throw new Error('npm kaputt'); } });
    await dst.starte();
    await warteBis(async () => true);
    let st;
    for (let i = 0; i < 100; i++) { st = await dst.status(); if (st.zustand === 'fehler') break; await new Promise((r) => setTimeout(r, 5)); }
    assert.equal(st.zustand, 'fehler');
    assert.match(st.fehler, /npm kaputt/);
    assert.deepEqual(beendet, []);
});

test('Cloud-Update: nicht ladbares Release (Signatur) beendet den Server nicht', async () => {
    const { dst, beendet } = dienst({ ladeFn: async () => ({ status: 'fehler', grund: 'signatur' }) });
    await dst.starte();
    let st;
    for (let i = 0; i < 100; i++) { st = await dst.status(); if (st.zustand === 'fehler') break; await new Promise((r) => setTimeout(r, 5)); }
    assert.match(st.fehler, /signatur/);
    assert.deepEqual(beendet, []);
});

test('Cloud-Update: nach dem Neustart gilt das Update als abgeschlossen', async () => {
    const { dst, dir, beendet } = dienst();
    await dst.starte();
    await warteBis(() => beendet.length > 0);
    const neu = erzeugeCloudUpdate({
        installDir: dir, aktuelleVersion: '1.0.1', env: { BETRIEBSMODUS: 'cloud' }, moeglichkeit: { moeglich: true },
        neuesteVersionFn: async () => '1.0.1', log: stumm
    });
    const st = await neu.status();
    assert.equal(st.zustand, 'bereit');
    assert.equal(st.updateVerfuegbar, false);
    assert.match(st.meldungen[0], /abgeschlossen/);
});
