import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereName, ermittleJahrAusWert, findeTeilnehmerZuPass } from '../../src/shared/passAbgleich.js';

test('normalisiereName', () => {
    assert.equal(normalisiereName('  Müller '), 'mueller');
    assert.equal(normalisiereName('Mueller'), 'mueller');
    assert.equal(normalisiereName('José'), 'jose');
    assert.equal(normalisiereName('Anna-Maria  Groß'), 'anna maria gross');
    assert.equal(normalisiereName(null), '');
});

test('ermittleJahrAusWert', () => {
    assert.equal(ermittleJahrAusWert('2012'), '2012');
    assert.equal(ermittleJahrAusWert('2012-05-01'), '2012');
    assert.equal(ermittleJahrAusWert('01.05.2012'), '2012');
    assert.equal(ermittleJahrAusWert('1.5.2012'), '2012');
    assert.equal(ermittleJahrAusWert(2012), '2012');
    assert.equal(ermittleJahrAusWert(''), '');
    assert.equal(ermittleJahrAusWert(undefined), '');
});

const liste = [
    { id: 1, vorname: 'Anna', nachname: 'Müller', geburtsjahr: 2012, judopass_id: null },
    { id: 2, vorname: 'Ben', nachname: 'Schulz', geburtsjahr: 2010, judopass_id: '123' },
    { id: 3, vorname: 'Anna', nachname: 'Müller', geburtsjahr: 2012, judopass_id: 'X9' },
];

test('Treffer über Judopass-Nr. (auch numerisch)', () => {
    const r = findeTeilnehmerZuPass(liste, { judopassId: 123, vorname: 'x', nachname: 'y', geburtsjahr: '1999' });
    assert.equal(r.teilnehmer.id, 2);
    assert.equal(r.ueber, 'judopass');
});

test('ohne hinterlegte IDs: Treffer über Name und Geburtsjahr', () => {
    const ohneIds = liste.map(t => ({ ...t, judopass_id: null }));
    const r = findeTeilnehmerZuPass(ohneIds, { judopassId: '777', vorname: 'ben', nachname: 'SCHULZ', geburtsjahr: '2010' });
    assert.equal(r.teilnehmer.id, 2);
    assert.equal(r.ueber, 'name');
});

test('Namenstreffer bevorzugt Teilnehmer ohne Judopass-Nr.', () => {
    const r = findeTeilnehmerZuPass(liste, { judopassId: '777', vorname: 'Anna', nachname: 'Mueller', geburtsjahr: '2012' });
    assert.equal(r.teilnehmer.id, 1);
});

test('kein Treffer bei abweichendem Geburtsjahr oder fehlenden Angaben', () => {
    assert.equal(findeTeilnehmerZuPass(liste, { judopassId: '', vorname: 'Ben', nachname: 'Schulz', geburtsjahr: '2011' }), null);
    assert.equal(findeTeilnehmerZuPass(liste, { judopassId: '', vorname: 'Ben', nachname: 'Schulz', geburtsjahr: '' }), null);
    assert.equal(findeTeilnehmerZuPass(null, { judopassId: '1' }), null);
});
