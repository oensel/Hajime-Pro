import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dokumentIdFuer, mitServerStand, unterscheidetSichVomServerStand, geaenderteFelder, gleicheWerte, LIVE_PRAEFIXE
} from '../../src/shared/dokumentAbbildung.js';

test('Dokument-IDs', () => {
    assert.equal(dokumentIdFuer('kaempfe', { id: 7 }), 'kampf:7');
    assert.equal(dokumentIdFuer('turnier_teilnehmer', { id: 3 }), 'teilnehmer:3');
    assert.equal(dokumentIdFuer('turnier_teilnehmer', { id: 3, dokument_id: 'teilnehmer:u-abc' }), 'teilnehmer:u-abc');
    assert.ok(LIVE_PRAEFIXE.includes('mannschaftskampf:'));
});

test('mitServerStand übernimmt Spalten, _rev und Nur-Dokument-Felder, entfernt Forfeit-Absicht', () => {
    const alt = { _id: 'kampf:7', _rev: '3-x', status: 'bereit', live_farbe: 'red', forfeit_teilnehmer_id: 4, forfeit_art: 'disqualifiziert', bearbeitet_von: 'browser' };
    const datum = new Date('2026-09-25T10:00:00Z');
    const neu = mitServerStand(alt, 'kaempfe', { id: 7, status: 'beendet', sieger_id: 5, updated_at: datum });
    assert.equal(neu._id, 'kampf:7');
    assert.equal(neu._rev, '3-x');
    assert.equal(neu.typ, 'kampf');
    assert.equal(neu.sql_id, 7);
    assert.equal(neu.status, 'beendet');
    assert.equal(neu.updated_at, '2026-09-25T10:00:00.000Z');
    assert.equal(neu.live_farbe, 'red');
    assert.equal(neu.bearbeitet_von, 'server');
    assert.equal('forfeit_teilnehmer_id' in neu, false);
    assert.equal('forfeit_art' in neu, false);
});

test('Vergleich toleriert SQLite/PostgreSQL-Darstellungen', () => {
    assert.equal(gleicheWerte(1, true), true);
    assert.equal(gleicheWerte(0, false), true);
    assert.equal(gleicheWerte('60.00', 60), true);
    assert.equal(gleicheWerte(null, undefined), true);
    assert.equal(gleicheWerte('U18', 'U18'), true);
    assert.equal(gleicheWerte(5, 6), false);
});

test('unterscheidetSichVomServerStand', () => {
    const zeile = { id: 7, status: 'bereit' };
    const doc = mitServerStand(null, 'kaempfe', zeile);
    assert.equal(unterscheidetSichVomServerStand(doc, 'kaempfe', zeile), false);
    assert.equal(unterscheidetSichVomServerStand(doc, 'kaempfe', { id: 7, status: 'beendet' }), true);
    assert.equal(unterscheidetSichVomServerStand({ ...doc, bearbeitet_von: 'browser' }, 'kaempfe', zeile), true);
    assert.equal(unterscheidetSichVomServerStand(null, 'kaempfe', zeile), true);
});

test('geaenderteFelder liefert nur abweichende Felder mit Dokumentwert', () => {
    const diff = geaenderteFelder(
        { status: 'beendet', sieger_id: 5, unterbewertung_kaempfer1: 10 },
        { status: 'gestartet', sieger_id: null, unterbewertung_kaempfer1: 10 },
        ['status', 'sieger_id', 'unterbewertung_kaempfer1']
    );
    assert.deepEqual(diff, { status: 'beendet', sieger_id: 5 });
});
