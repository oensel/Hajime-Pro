import test from 'node:test';
import assert from 'node:assert/strict';
import {
    datumAlsIso, findeTerminKonflikt, ermittleAktivierbarkeit, kopiereTeilnehmerFuerNeuesTurnier
} from '../../src/shared/turnierAktivierung.js';

test('datumAlsIso nimmt Strings und lokale Date-Objekte', () => {
    assert.equal(datumAlsIso('2027-03-20'), '2027-03-20');
    assert.equal(datumAlsIso('2027-03-20T00:00:00.000Z'), '2027-03-20');
    assert.equal(datumAlsIso(new Date(2027, 2, 20)), '2027-03-20');
    assert.equal(datumAlsIso(null), null);
    assert.equal(datumAlsIso('kein datum'), null);
});

test('findeTerminKonflikt: gleicher Tag zählt, abgesagt und das eigene Turnier nicht', () => {
    const turniere = [
        { id: 1, bezeichnung: 'A', datum: new Date(2027, 2, 20), status: 'veroeffentlicht' },
        { id: 2, bezeichnung: 'B', datum: '2027-04-01', status: 'abgesagt' }
    ];
    assert.equal(findeTerminKonflikt(turniere, '2027-03-20').id, 1);
    assert.equal(findeTerminKonflikt(turniere, '2027-03-20', 1), null);
    assert.equal(findeTerminKonflikt(turniere, '2027-04-01'), null);
    assert.equal(findeTerminKonflikt(turniere, '2027-05-01'), null);
});

test('ermittleAktivierbarkeit: nur am Wettkampftag und ohne anderes aktives Turnier', () => {
    const turnier = { id: 5, bezeichnung: 'Heute', datum: '2027-03-20', status: 'entwurf', aktiv: false };
    assert.deepEqual(ermittleAktivierbarkeit({ turnier, heute: '2027-03-20' }), { moeglich: true, grund: null });

    const zuFrueh = ermittleAktivierbarkeit({ turnier, heute: '2027-03-19' });
    assert.equal(zuFrueh.moeglich, false);
    assert.match(zuFrueh.grund, /Wettkampftag/);

    const belegt = ermittleAktivierbarkeit({ turnier, aktivesTurnier: { id: 4, bezeichnung: 'Läuft' }, heute: '2027-03-20' });
    assert.equal(belegt.moeglich, false);
    assert.match(belegt.grund, /Läuft/);

    assert.equal(ermittleAktivierbarkeit({ turnier: { ...turnier, status: 'abgeschlossen' }, heute: '2027-03-20' }).moeglich, false);
    assert.equal(ermittleAktivierbarkeit({ turnier: { ...turnier, status: 'abgesagt' }, heute: '2027-03-20' }).moeglich, false);
    assert.equal(ermittleAktivierbarkeit({ turnier: { ...turnier, aktiv: true }, heute: '2027-03-20' }).moeglich, false);
});

test('kopiereTeilnehmerFuerNeuesTurnier behält Gewicht und Lizenzdatum, setzt Wettkampftagsdaten zurück', () => {
    const quelle = {
        id: 9, turnier_id: 1, pool_id: 4, judopass_id: 'DE123', vorname: 'Anna', nachname: 'Adler',
        geburtsjahr: 2010, lizenz_ablauf: '2030-12-31', geschlecht: 'weiblich', verein: 'JC Alpha',
        gewicht: 41.5, altersklasse: 'U15', gewichtsklasse: '-44kg', startgeld_bezahlt: true,
        graduierung: '3. Kyu', status: 'kampfbereit', gewogen: true, dokument_id: 'teilnehmer:u-1',
        created_at: 'x', updated_at: 'y'
    };
    const kopie = kopiereTeilnehmerFuerNeuesTurnier(quelle, 77);
    assert.equal(kopie.turnier_id, 77);
    assert.equal(kopie.gewicht, 41.5);
    assert.equal(kopie.lizenz_ablauf, '2030-12-31');
    assert.equal(kopie.judopass_id, 'DE123');
    assert.equal(kopie.pool_id, null);
    assert.equal(kopie.gewogen, false);
    assert.equal(kopie.startgeld_bezahlt, false);
    assert.equal(kopie.status, 'angemeldet');
    for (const feld of ['id', 'dokument_id', 'created_at', 'updated_at']) assert.equal(feld in kopie, false, feld);
});
