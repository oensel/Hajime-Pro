import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schluesselVorhanden, verschluesseleFeld, entschluesseleFeld, schluesselKennung, SCHLUESSEL_MINDESTLAENGE } from '../../src/utils/feldVerschluesselung.js';
import { FachFehler } from '../../src/utils/fachFehler.js';

const env = { ZAHLUNGSDATEN_SCHLUESSEL: 'a'.repeat(40) };

test('Feldverschlüsselung: Rundreise und Format', () => {
    const c = verschluesseleFeld('DE89370400440532013000', env);
    assert.match(c, /^z1:[0-9a-f]{8}:/);
    assert.equal(c.split(':').length, 5);
    assert.equal(entschluesseleFeld(c, env), 'DE89370400440532013000');
    assert.notEqual(verschluesseleFeld('x', env), verschluesseleFeld('x', env));
});

test('Feldverschlüsselung: Fehlerfälle', () => {
    const c = verschluesseleFeld('geheim', env);
    assert.throws(() => entschluesseleFeld(c, { ZAHLUNGSDATEN_SCHLUESSEL: 'b'.repeat(40) }), (e) => e instanceof FachFehler && e.statusCode === 500 && !e.message.includes('geheim'));
    assert.throws(() => entschluesseleFeld(c, {}), (e) => e instanceof FachFehler && e.statusCode === 503 && e.message === 'Der Schlüssel für Zahlungsdaten fehlt (ZAHLUNGSDATEN_SCHLUESSEL).');
    assert.throws(() => verschluesseleFeld('x', {}), (e) => e instanceof FachFehler && e.statusCode === 503);
    assert.throws(() => verschluesseleFeld('x', { ZAHLUNGSDATEN_SCHLUESSEL: 'kurz' }), (e) => e instanceof FachFehler && e.statusCode === 503);
    assert.throws(() => verschluesseleFeld(null, env), TypeError);
    assert.throws(() => verschluesseleFeld(undefined, env), TypeError);
    assert.equal(SCHLUESSEL_MINDESTLAENGE, 32);
    assert.equal(schluesselVorhanden({ ZAHLUNGSDATEN_SCHLUESSEL: 'kurz' }), false);
    assert.equal(schluesselVorhanden({}), false);
    assert.equal(schluesselVorhanden(env), true);
});

test('Feldverschlüsselung: Manipulation wird abgewiesen', () => {
    const teile = verschluesseleFeld('geheim', env).split(':');
    const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64'); };
    const mit = (i, wert) => { const t = [...teile]; t[i] = wert; return t.join(':'); };
    const generisch = (e) => e instanceof FachFehler && e.statusCode === 500 && e.message === 'Zahlungsdaten konnten nicht entschlüsselt werden.';
    for (const text of [
        mit(4, flip(teile[4])),
        mit(3, flip(teile[3])),
        mit(3, Buffer.from(teile[3], 'base64').subarray(0, 8).toString('base64')),
        mit(2, Buffer.alloc(16, 1).toString('base64')),
        teile.slice(0, 4).join(':'),
        teile.concat('x').join(':'),
        ''
    ]) assert.throws(() => entschluesseleFeld(text, env), generisch);
});

const ALT = 'z'.repeat(40);
const NEU = 'n'.repeat(40);

test('Schlüsselwechsel: alter Chiffretext ist mit _ALT lesbar, neue immer mit dem aktuellen Schlüssel', () => {
    const alt = verschluesseleFeld('DE89370400440532013000', { ZAHLUNGSDATEN_SCHLUESSEL: ALT });
    const envWechsel = { ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: ALT };
    assert.equal(entschluesseleFeld(alt, envWechsel), 'DE89370400440532013000');
    const neu = verschluesseleFeld('x', envWechsel);
    assert.equal(neu.split(':')[1], schluesselKennung(envWechsel).aktuell);
    assert.equal(entschluesseleFeld(neu, { ZAHLUNGSDATEN_SCHLUESSEL: NEU }), 'x');
    // ohne _ALT ist der alte Text nicht lesbar (generischer Fehler)
    assert.throws(() => entschluesseleFeld(alt, { ZAHLUNGSDATEN_SCHLUESSEL: NEU }),
        (e) => e instanceof FachFehler && e.statusCode === 500 && e.message === 'Zahlungsdaten konnten nicht entschlüsselt werden.');
    // unbekannte kid trotz _ALT
    const fremd = verschluesseleFeld('y', { ZAHLUNGSDATEN_SCHLUESSEL: 'q'.repeat(40) });
    assert.throws(() => entschluesseleFeld(fremd, envWechsel),
        (e) => e instanceof FachFehler && e.statusCode === 500 && e.message === 'Zahlungsdaten konnten nicht entschlüsselt werden.');
    // beide Schlüssel gleich: unproblematisch
    const gleich = { ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: NEU };
    assert.equal(entschluesseleFeld(verschluesseleFeld('g', gleich), gleich), 'g');
});

test('Schlüsselwechsel: _ALT braucht dieselbe Mindestlänge, schluesselKennung liefert die Kennungen', () => {
    const alt = verschluesseleFeld('a', { ZAHLUNGSDATEN_SCHLUESSEL: ALT });
    assert.throws(() => entschluesseleFeld(alt, { ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: 'kurz' }),
        (e) => e instanceof FachFehler && e.statusCode === 503 && !e.message.includes('kurz'));
    assert.deepEqual(schluesselKennung({}), { aktuell: null, alt: null });
    assert.deepEqual(schluesselKennung({ ZAHLUNGSDATEN_SCHLUESSEL: 'kurz', ZAHLUNGSDATEN_SCHLUESSEL_ALT: 'kurz' }), { aktuell: null, alt: null });
    const k = schluesselKennung({ ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: ALT });
    assert.match(k.aktuell, /^[0-9a-f]{8}$/);
    assert.match(k.alt, /^[0-9a-f]{8}$/);
    assert.notEqual(k.aktuell, k.alt);
    assert.equal(schluesselKennung({ ZAHLUNGSDATEN_SCHLUESSEL: NEU }).alt, null);
});

test('Schlüsselwechsel: ein defekter _ALT blockiert nicht das Lesen von Daten unter dem aktuellen Schlüssel', () => {
    const aktuell = verschluesseleFeld('geheim', { ZAHLUNGSDATEN_SCHLUESSEL: NEU });
    assert.equal(entschluesseleFeld(aktuell, { ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: 'kurz' }), 'geheim');
});
