import test from 'node:test';
import assert from 'node:assert/strict';
import { baueSnapshot } from '../../src/live/snapshot.js';
import { pruefePaket } from '../../src/liveCloud/ingest.js';

const turnier = { urspruengliche_id: 'T-1', bezeichnung: 'Cup', datum: '2026-10-15', farbe_kaempfer2: 'blau' };
const eingang = {
    turnier,
    kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }],
    pools: [{ id: 5, typ: 'mannschaft', verspaetet: false, bezeichnung: 'U15 w Team', modus: 'Jeder-gegen-Jeden', status: 'gestartet', kampfflaeche_id: 1, altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: null }],
    teilnehmer: [
        { id: 1, vorname: 'Anna', nachname: 'Adler', verein: 'JC Senden', geschlecht: 'weiblich', altersklasse: 'U15', gewichtsklasse: '-40', status: 'kampfbereit', pool_id: null, passnummer_hash: 'h1', gewicht_rang: 1, nur_mannschaft: true }
    ],
    mannschaften: [
        { id: 10, turnier_id: 1, pool_id: 5, verein: 'JC Senden', bezeichnung: 'Team 1' },
        { id: 11, turnier_id: 1, pool_id: 5, verein: 'JC Münster', bezeichnung: 'Team 2' }
    ],
    mitglieder: [{ mannschaft_id: 10, turnier_teilnehmer_id: 1, gewichtsklasse: '-40' }],
    begegnungen: [{ id: 1, pool_id: 5, mannschaft1_id: 10, mannschaft2_id: 11, status: 'bereit', reihenfolge_nummer: '1', runde: 1, kampfflaeche_id: 2, siegpunkte_mannschaft1: 0, siegpunkte_mannschaft2: 0 }],
    kaempfe: [{ id: 1, pool_id: 5, status: 'bereit', matten_reihenfolge: 0, mannschaftskampf_id: 1, kampfflaeche_id: 2, kaempfer1_id: 1, kaempfer2_id: null, sieger_id: null, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 }]
};

test('Snapshot enthält Teams und Begegnungen, Mitglieder ohne Einzelstart nur im Team', () => {
    const s = baueSnapshot(eingang, { geheimnis: 'g' });
    assert.equal(s.mannschaften.length, 2);
    const t1 = s.mannschaften.find(t => t.bezeichnung === 'Team 1');
    assert.equal(t1.mitglieder.length, 1);
    assert.equal(t1.matteBezeichnung, 'Matte 2'); // eigene Matte der Begegnung
    assert.equal(t1.zustand, 'als_naechstes');
    assert.equal(s.teilnehmer.length, 0); // nur_mannschaft: keine Einzelkachel
    assert.equal(s.begegnungen[0].matteId, 2);
    assert.ok(s.vereine.some(v => v.name === 'JC Senden'));
});

test('Schlüssel sind stabil und das Paket besteht die Prüfung der Cloud', () => {
    const a = baueSnapshot(eingang, { geheimnis: 'g' });
    const b = baueSnapshot(eingang, { geheimnis: 'g' });
    assert.deepEqual(a.mannschaften.map(t => t.key), b.mannschaften.map(t => t.key));
    assert.notDeepEqual(a.mannschaften.map(t => t.key), baueSnapshot(eingang, { geheimnis: 'x' }).mannschaften.map(t => t.key));
    assert.equal(pruefePaket({ ...a, sequenz: 1, stand: new Date().toISOString() }), null);
});
