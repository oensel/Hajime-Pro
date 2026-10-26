import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ZAHLWEGE, ABRECHNUNGSBASEN, parseAngeboteneZahlwege, startgeldVerlangt,
    startgeldErfuellt, istZahlwegGesichert, pruefeZahlwegEingabe,
} from '../../src/shared/zahlweg.js';

const gueltig = {
    zahlweg: ' bar ',
    rechnung_email: ' kasse@verein.de ',
    rechnung_ansprechperson: ' Max Muster ',
    rechnung_anschrift: ' Weg 1, 50667 Köln ',
};

test('Konstanten', () => {
    assert.deepEqual(ZAHLWEGE, ['ueberweisung', 'bar', 'lastschrift']);
    assert.deepEqual(ABRECHNUNGSBASEN, ['gemeldet', 'teilnahme_waage']);
});

test('startgeldVerlangt', () => {
    assert.equal(startgeldVerlangt({ startgeld: 8 }), true);
    assert.equal(startgeldVerlangt({ startgeld: '8.00' }), true);
    assert.equal(startgeldVerlangt({ startgeld: 0 }), false);
    assert.equal(startgeldVerlangt({ startgeld: null }), false);
    assert.equal(startgeldVerlangt({}), false);
});

test('startgeldErfuellt', () => {
    assert.equal(startgeldErfuellt({ startgeld: 0 }, {}), true);
    assert.equal(startgeldErfuellt({ startgeld: 8 }, {}), false);
    assert.equal(startgeldErfuellt({ startgeld: 8 }, { startgeld_zahlweg_gesichert: true }), true);
    assert.equal(startgeldErfuellt({ startgeld: 8 }, { startgeld_bezahlt: 1 }), true);
});

test('istZahlwegGesichert: Überweisung und Lastschrift mit gültigem Mandat', () => {
    assert.equal(istZahlwegGesichert({ zahlweg: 'ueberweisung' }), true);
    assert.equal(istZahlwegGesichert({ zahlweg: 'bar' }), false);
    assert.equal(istZahlwegGesichert(null), false);
    assert.equal(istZahlwegGesichert({ zahlweg: 'lastschrift', mandat_gueltig: false }), false);
    assert.equal(istZahlwegGesichert({ zahlweg: 'lastschrift', mandat_gueltig: true }), true);
});

test('parseAngeboteneZahlwege', () => {
    assert.deepEqual(parseAngeboteneZahlwege(null), ['ueberweisung', 'bar']);
    assert.deepEqual(parseAngeboteneZahlwege(undefined), ['ueberweisung', 'bar']);
    assert.deepEqual(parseAngeboteneZahlwege('bar,wero'), ['bar']);
    assert.deepEqual(parseAngeboteneZahlwege('ueberweisung, bar'), ['ueberweisung', 'bar']);
});

test('pruefeZahlwegEingabe: gültig, getrimmt', () => {
    const r = pruefeZahlwegEingabe(gueltig, ['ueberweisung', 'bar']);
    assert.equal(r.fehler, null);
    assert.deepEqual(r.werte, {
        zahlweg: 'bar',
        rechnung_email: 'kasse@verein.de',
        rechnung_ansprechperson: 'Max Muster',
        rechnung_anschrift: 'Weg 1, 50667 Köln',
    });
});

test('pruefeZahlwegEingabe: Fehlerfälle', () => {
    const angeboten = ['ueberweisung', 'bar'];
    for (const abweichung of [
        { rechnung_email: '  ' },
        { rechnung_email: 'keine-mail' },
        { rechnung_ansprechperson: '' },
        { rechnung_anschrift: '' },
        { zahlweg: 'lastschrift' },
        { zahlweg: undefined },
    ]) {
        const r = pruefeZahlwegEingabe({ ...gueltig, ...abweichung }, angeboten);
        assert.ok(r.fehler, JSON.stringify(abweichung));
        assert.equal(r.werte, null);
    }
    assert.ok(pruefeZahlwegEingabe(null, angeboten).fehler);
});

test('sollVorOrtFragen: nur Cloud-Herkunft, Startgeld, Verein ohne Zahlweg und nicht zurückgestellt', async () => {
    const { sollVorOrtFragen, vorOrtSchluessel } = await import('../../src/shared/zahlweg.js');
    const ok = { cloudHerkunft: true, startgeld: 8, vereinHatZahlweg: false, spaeterGemerkt: false };
    assert.equal(sollVorOrtFragen(ok), true);
    assert.equal(sollVorOrtFragen({ ...ok, cloudHerkunft: false }), false);
    assert.equal(sollVorOrtFragen({ ...ok, startgeld: 0 }), false);
    assert.equal(sollVorOrtFragen({ ...ok, vereinHatZahlweg: true }), false);
    assert.equal(sollVorOrtFragen({ ...ok, spaeterGemerkt: true }), false);
    assert.equal(vorOrtSchluessel(5, '  JC X '), vorOrtSchluessel(5, 'jc x'));
    assert.notEqual(vorOrtSchluessel(5, 'jc x'), vorOrtSchluessel(6, 'jc x'));
});
