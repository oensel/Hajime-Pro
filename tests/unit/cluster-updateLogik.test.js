import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istVersion, vergleicheVersionen, entscheideUpdate } from '../../src/cluster/updateLogik.js';

test('Versionen: Format und Vergleich (numerisch, nicht textuell)', () => {
    assert.equal(istVersion('1.0.18'), true);
    for (const v of ['abc', '1.0', '', null, undefined, '1.0.18-beta', 'v1.0.18']) assert.equal(istVersion(v), false);
    assert.equal(vergleicheVersionen('1.0.9', '1.0.10'), -1);
    assert.equal(vergleicheVersionen('1.0.18', '1.0.18'), 0);
    assert.equal(vergleicheVersionen('2.0.0', '1.9.9'), 1);
    assert.equal(vergleicheVersionen('x', '1.0.0'), null);
});

const e = (extra) => entscheideUpdate({ eigeneVersion: '1.0.17', partnerVersion: '1.0.17', neuesteVersion: '1.0.18', rolle: 'secondary', laeuft: false, ...extra });

test('Beide gleich alt, Release neuer: nur der Secondary bekommt den Knopf', () => {
    assert.deepEqual(e({}), { knopf: true, aktion: 'direkt', ziel: '1.0.18', grund: null });
    const master = e({ rolle: 'master' });
    assert.equal(master.knopf, false);
    assert.match(master.grund, /Secondary/);
});

test('Secondary ist neuer als der Master: nur der Master bekommt den Knopf (nach Übergabe)', () => {
    const master = e({ rolle: 'master', partnerVersion: '1.0.18' });
    assert.deepEqual(master, { knopf: true, aktion: 'nach_uebergabe', ziel: '1.0.18', grund: null });
    const secondary = e({ rolle: 'secondary', eigeneVersion: '1.0.18', partnerVersion: '1.0.17', neuesteVersion: '1.0.18' });
    assert.equal(secondary.knopf, false);
});

test('Secondary ist älter als der Master (nach einer Übergabe): Secondary bekommt den Knopf', () => {
    const r = e({ rolle: 'secondary', partnerVersion: '1.0.18' });
    assert.deepEqual(r, { knopf: true, aktion: 'direkt', ziel: '1.0.18', grund: null });
});

test('Kein Knopf: aktuell, Release/Partner unbekannt, laufendes Update, ungültige Version', () => {
    assert.equal(e({ eigeneVersion: '1.0.18', partnerVersion: '1.0.18' }).knopf, false);
    assert.match(e({ neuesteVersion: null }).grund, /Release/);
    assert.match(e({ partnerVersion: null }).grund, /Partner/);
    assert.match(e({ laeuft: true }).grund, /läuft/);
    assert.equal(e({ eigeneVersion: 'abc' }).knopf, false);
    assert.equal(e({ neuesteVersion: '1.0.17' }).knopf, false); // kein Downgrade, nichts Neueres
    assert.equal(e({ partnerVersion: '1.0.19' }).knopf, false); // Partner schon über dem bekannten Release hinaus
});
