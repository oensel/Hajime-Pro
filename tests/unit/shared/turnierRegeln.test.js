import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    berechneAnmeldefrist,
    istAnmeldefristAbgelaufen,
    ermittleEffektivenStatus,
    validiereZahlungsdaten
} from '../../../src/shared/turnierRegeln.js';

test('berechneAnmeldefrist setzt bei reinem Datum 23:59:59.999 Ortszeit an', () => {
    const frist = berechneAnmeldefrist('2026-05-10');
    assert.equal(frist.getHours(), 23);
    assert.equal(frist.getMinutes(), 59);
});

test('istAnmeldefristAbgelaufen ist ohne hinterlegte Frist false', () => {
    assert.equal(istAnmeldefristAbgelaufen({ anmeldeschluss: null }), false);
});

test('istAnmeldefristAbgelaufen ist bei einer Frist in der Vergangenheit true', () => {
    assert.equal(istAnmeldefristAbgelaufen({ anmeldeschluss: '2000-01-01' }), true);
});

test('ermittleEffektivenStatus gibt Nicht-veroeffentlicht-Status unverändert zurück', () => {
    assert.equal(ermittleEffektivenStatus({ status: 'entwurf' }), 'entwurf');
    assert.equal(ermittleEffektivenStatus({ status: 'abgesagt' }), 'abgesagt');
});

test('ermittleEffektivenStatus leitet in_durchfuehrung ab, wenn der Wettkampftag erreicht ist', () => {
    const heuteStr = new Date().toISOString().slice(0, 10);
    assert.equal(ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: heuteStr }), 'in_durchfuehrung');
});

test('ermittleEffektivenStatus leitet in_durchfuehrung ab, wenn bereits echte Kämpfe existieren', () => {
    const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal(
        ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: morgen }, { hatEchteKaempfe: true }),
        'in_durchfuehrung'
    );
});

test('ermittleEffektivenStatus leitet anmeldung_geschlossen ab, wenn die Frist abgelaufen ist', () => {
    const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal(
        ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: morgen, anmeldeschluss: '2000-01-01' }),
        'anmeldung_geschlossen'
    );
});

test('validiereZahlungsdaten verlangt IBAN/Kontoinhaber/Verwendungszweck bei Startgeld > 0', () => {
    assert.ok(validiereZahlungsdaten('10', '', 'Max Mustermann', 'Startgeld'));
    assert.equal(validiereZahlungsdaten('10', 'DE123', 'Max Mustermann', 'Startgeld'), null);
});

test('validiereZahlungsdaten ist ohne Startgeld immer gültig', () => {
    assert.equal(validiereZahlungsdaten(undefined, '', '', ''), null);
    assert.equal(validiereZahlungsdaten('0', '', '', ''), null);
});
