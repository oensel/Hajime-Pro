import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereIban, pruefeIban, maskiereIban, formatiereIban, IBAN_MUSTER } from '../../src/shared/iban.js';
import { baueGiroCodePayload } from '../../src/shared/girocode.js';

test('IBAN: normalisieren und prüfen', () => {
    assert.equal(normalisiereIban('de89 3704-0044.0532 0130 00'), 'DE89370400440532013000');
    const ok = pruefeIban('DE89 3704 0044 0532 0130 00');
    assert.deepEqual(ok, { ok: true, iban: 'DE89370400440532013000', fehler: null });
    assert.equal(pruefeIban('DE89370400440532013001').ok, false);
    const kurz = pruefeIban('DE8937040044');
    assert.equal(kurz.ok, false);
    assert.match(kurz.fehler, /Länge/);
    assert.equal(pruefeIban('').ok, false);
    assert.equal(pruefeIban('AT611904300234573201').ok, true);
});

test('IBAN: maskieren und formatieren', () => {
    assert.equal(maskiereIban('DE89370400440532013000'), 'DE89 **** **** **** **** 00');
    assert.equal(formatiereIban('DE89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
});

test('IBAN: Muster findet IBANs in Freitext', () => {
    const a = 'IBAN DE89 3704 0044 0532 0130 00 ok'.match(IBAN_MUSTER);
    const b = 'IBAN DE89370400440532013000 ok'.match(IBAN_MUSTER);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal('Rechnung JCK-00001'.match(IBAN_MUSTER), null);
});

test('Girocode: EPC-Payload', () => {
    const z = baueGiroCodePayload({ name: 'JC A', iban: 'DE89 3704 0044 0532 0130 00', betrag: 24, verwendungszweck: 'x'.repeat(200) }).split('\n');
    assert.equal(z.length, 11);
    assert.equal(z[6], 'DE89370400440532013000');
    assert.equal(z[7], 'EUR24.00');
    assert.equal(z[10].length, 140);
});
