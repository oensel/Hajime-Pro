import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
    FAKADE_PFAD, ermittleReleaseQuelle, leseCodeAusDateiname, liesCloudUrl, liesGeraeteSchluessel, loeseEinloesecodeEin, speichereGeraeteSchluessel
} from '../../src/utils/releaseQuelle.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'hajime-quelle-'));

test('Einlösecode steht vor der Endung des Dateinamens', () => {
    assert.equal(leseCodeAusDateiname('Hajime-Pro-Server-1.2.3-win-x64.k7Hq9x2Lm4Ab3Cd5.exe'), 'k7Hq9x2Lm4Ab3Cd5');
    assert.equal(leseCodeAusDateiname('Hajime-Pro-Server-1.2.3-linux-x86_64.AbCdEfGh23456789.AppImage'), 'AbCdEfGh23456789');
    assert.equal(leseCodeAusDateiname('Hajime-Pro-Server-1.2.3-win-x64.exe'), null, 'Versionsnummer ist kein Code');
    assert.equal(leseCodeAusDateiname('Hajime-Pro-Server-1.2.3-win-x64 (1).exe'), null);
    assert.equal(leseCodeAusDateiname('x.kurz.exe'), null);
    assert.equal(leseCodeAusDateiname(''), null);
});

test('Quelle: ohne Geräteschlüssel GitHub, mit Schlüssel und Cloud-Adresse die Cloud', () => {
    const dir = tmp();
    try {
        const ohne = ermittleReleaseQuelle({ env: {}, datenDir: dir });
        assert.equal(ohne.art, 'github');
        assert.equal(ohne.apiBasis, undefined);
        assert.equal(ohne.repo, 'oensel/Hajime-Pro-Releases');

        // Schlüssel ohne Adresse: weiter GitHub
        speichereGeraeteSchluessel(dir, 'hjg_abc');
        assert.equal(liesGeraeteSchluessel({ env: {}, datenDir: dir }), 'hjg_abc');
        assert.equal(ermittleReleaseQuelle({ env: {}, datenDir: dir }).art, 'github');

        const mit = ermittleReleaseQuelle({ env: { CLOUD_URL: 'https://cloud.example.de/' }, datenDir: dir });
        assert.deepEqual(mit, { art: 'cloud', repo: 'cloud', token: 'hjg_abc', apiBasis: `https://cloud.example.de${FAKADE_PFAD}` });

        // RELEASE_SCHLUESSEL aus der Umgebung gewinnt gegen die Datei
        assert.equal(ermittleReleaseQuelle({ env: { CLOUD_URL: 'https://c.de', RELEASE_SCHLUESSEL: 'hjg_env' }, datenDir: dir }).token, 'hjg_env');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Cloud-Adresse: Umgebung vor update.json vor Standarddatei, nur http(s)', () => {
    const dir = tmp();
    try {
        const standard = path.join(dir, 'cloud-url.txt');
        writeFileSync(standard, 'https://standard.example.de\n');
        assert.equal(liesCloudUrl({ env: {}, datenDir: dir, standardDatei: standard }), 'https://standard.example.de');
        writeFileSync(path.join(dir, 'update.json'), JSON.stringify({ cloudUrl: 'https://konfig.example.de/pfad/' }));
        assert.equal(liesCloudUrl({ env: {}, datenDir: dir, standardDatei: standard }), 'https://konfig.example.de/pfad');
        assert.equal(liesCloudUrl({ env: { CLOUD_URL: 'https://env.example.de' }, datenDir: dir, standardDatei: standard }), 'https://env.example.de');
        assert.equal(liesCloudUrl({ env: { CLOUD_URL: 'ftp://x' }, datenDir: '', standardDatei: '' }), null);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Einlösen: Schlüssel wird gespeichert; abgelehnter Code endgültig, Netzfehler nicht', async () => {
    const dir = tmp();
    try {
        let anfragen = 0;
        const gut = async (url, opt) => {
            anfragen++;
            assert.equal(url, 'https://cloud.example.de/api/downloads/einloesen');
            assert.equal(JSON.parse(opt.body).code, 'k7Hq9x2Lm4Ab3Cd5');
            return new Response(JSON.stringify({ success: true, schluessel: 'hjg_neu' }), { status: 200 });
        };
        assert.deepEqual(await loeseEinloesecodeEin({ code: null, datenDir: dir, cloudUrl: 'https://x', fetchFn: gut }), { status: 'kein-code' });
        assert.equal((await loeseEinloesecodeEin({ code: 'k7Hq9x2Lm4Ab3Cd5', datenDir: dir, cloudUrl: null, fetchFn: gut })).status, 'fehler');

        let abgelehnt = 0;
        const abgelehntFn = async () => new Response('{}', { status: 403 });
        const a = await loeseEinloesecodeEin({ code: 'k7Hq9x2Lm4Ab3Cd5', datenDir: dir, cloudUrl: 'https://cloud.example.de', fetchFn: abgelehntFn, beiAbgelehnt: () => { abgelehnt++; } });
        assert.equal(a.endgueltig, true);
        assert.equal(abgelehnt, 1);
        const netz = await loeseEinloesecodeEin({ code: 'k7Hq9x2Lm4Ab3Cd5', datenDir: dir, cloudUrl: 'https://cloud.example.de', fetchFn: async () => { throw new Error('offline'); }, beiAbgelehnt: () => { abgelehnt++; } });
        assert.equal(netz.status, 'fehler');
        assert.notEqual(netz.endgueltig, true);
        assert.equal(abgelehnt, 1, 'Netzfehler verwirft den Code nicht');
        assert.equal(existsSync(path.join(dir, 'release-schluessel')), false);

        assert.deepEqual(await loeseEinloesecodeEin({ code: 'k7Hq9x2Lm4Ab3Cd5', datenDir: dir, cloudUrl: 'https://cloud.example.de', fetchFn: gut }), { status: 'eingeloest' });
        assert.equal(readFileSync(path.join(dir, 'release-schluessel'), 'utf8').trim(), 'hjg_neu');
        // zweiter Start: es gibt schon einen Schlüssel, die Cloud wird nicht erneut gefragt
        assert.deepEqual(await loeseEinloesecodeEin({ code: 'k7Hq9x2Lm4Ab3Cd5', datenDir: dir, cloudUrl: 'https://cloud.example.de', fetchFn: gut }), { status: 'vorhanden' });
        assert.equal(anfragen, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
