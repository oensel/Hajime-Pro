import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schluesselVorhanden, verschluesseleFeld, entschluesseleFeld, SCHLUESSEL_MINDESTLAENGE } from '../../src/utils/feldVerschluesselung.js';
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
