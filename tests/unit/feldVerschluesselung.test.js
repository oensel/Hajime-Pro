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
    assert.throws(() => entschluesseleFeld(c, {}), (e) => e instanceof FachFehler && e.statusCode === 503);
    assert.throws(() => verschluesseleFeld('x', {}), (e) => e instanceof FachFehler && e.statusCode === 503);
    assert.equal(SCHLUESSEL_MINDESTLAENGE, 32);
    assert.equal(schluesselVorhanden({ ZAHLUNGSDATEN_SCHLUESSEL: 'kurz' }), false);
    assert.equal(schluesselVorhanden({}), false);
    assert.equal(schluesselVorhanden(env), true);
});
