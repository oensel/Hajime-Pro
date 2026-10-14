import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istVersion, vergleicheVersionen, entscheideUpdate, entscheidePartnerUpdate } from '../../src/cluster/updateLogik.js';

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

// ---------- Master stößt das Update des Secondary an (über die VIP) ----------
const teil = (extra = {}) => entscheidePartnerUpdate({
    eigeneVersion: '1.0.19', rolle: 'master', neuesteVersion: '1.0.21',
    partner: { rolle: 'secondary', version: '1.0.19', updateLaeuft: false }, ...extra
});

test('Partner-Update: der Master darf den gleich alten Secondary anstoßen', () => {
    assert.deepEqual(teil(), { knopf: true, aktion: 'partner', ziel: '1.0.21', grund: null });
});

test('Partner-Update: nur vom Master, nur bei erreichbarem Secondary', () => {
    assert.equal(teil({ rolle: 'secondary' }).knopf, false);
    assert.match(teil({ partner: null }).grund, /nicht erreichbar/);
    assert.match(teil({ partner: { rolle: 'master', version: '1.0.19' } }).grund, /nicht Secondary/);
    assert.match(teil({ partner: { rolle: 'secondary', version: null } }).grund, /nicht bekannt/);
});

test('Partner-Update: kein Knopf bei neuestem Stand, laufendem Update oder neuerem Secondary', () => {
    assert.match(teil({ partner: { rolle: 'secondary', version: '1.0.21' } }).grund, /neuesten Stand/);
    assert.match(teil({ partner: { rolle: 'secondary', version: '1.0.19', updateLaeuft: true } }).grund, /läuft bereits/);
    const neuer = teil({ partner: { rolle: 'secondary', version: '1.0.20' }, eigeneVersion: '1.0.19' });
    assert.equal(neuer.knopf, false);
    assert.match(neuer.grund, /Secondary ist neuer als der Master/);
    assert.match(teil({ neuesteVersion: null }).grund, /nicht prüfbar/);
});

test('Partner-Update: ein Secondary hinter dem Master wird aktualisiert, der Master selbst nie ohne Übergabe', () => {
    const r = teil({ eigeneVersion: '1.0.21', partner: { rolle: 'secondary', version: '1.0.19', updateLaeuft: false } });
    assert.equal(r.knopf, true);
    assert.equal(r.ziel, '1.0.21');
    // Master schon über dem bekannten Release: kein Downgrade des Secondary
    assert.match(teil({ eigeneVersion: '1.0.22' }).grund, /neuere Version als das bekannte Release/);
});
