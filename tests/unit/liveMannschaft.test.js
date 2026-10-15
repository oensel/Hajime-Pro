import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneMannschaften } from '../../src/shared/liveMannschaft.js';

const pools = [
    { id: 1, typ: 'mannschaft', verspaetet: false, bezeichnung: 'U15 w Team', modus: 'Jeder-gegen-Jeden', status: 'gestartet', kampfflaeche_id: 1, altersklasse: 'U15', geschlecht: 'weiblich' }
];
const mannschaften = [
    { id: 10, pool_id: 1, verein: 'JC A', bezeichnung: 'Team 1' },
    { id: 11, pool_id: 1, verein: 'JC B', bezeichnung: 'Team 2' },
    { id: 12, pool_id: 1, verein: 'JC C', bezeichnung: 'Team 3' }
];
const teilnehmer = [
    { id: 100, vorname: 'Anna', nachname: 'Adler', status: 'kampfbereit' },
    { id: 101, vorname: 'Berta', nachname: 'Busch', status: 'kampfbereit' }
];
const mitglieder = [
    { mannschaft_id: 10, turnier_teilnehmer_id: 101, gewichtsklasse: '+57' },
    { mannschaft_id: 10, turnier_teilnehmer_id: 100, gewichtsklasse: '-40' }
];
const optionen = { schluesselVon: (m) => `k${m.id}`, matteName: (id) => `Matte ${id}` };
const kampf = (id, begegnung, status, reihenfolge, extra = {}) => ({ id, pool_id: 1, mannschaftskampf_id: begegnung, status, matten_reihenfolge: reihenfolge, ...extra });

test('Team mit laufender Begegnung: laeuft, Gegner und Matte', () => {
    const begegnungen = [
        { id: 1, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: 11, status: 'gestartet', reihenfolge_nummer: '1', runde: 1 },
        { id: 2, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: 12, status: 'bereit', reihenfolge_nummer: '2', runde: 2 }
    ];
    const kaempfe = [kampf(1, 1, 'gestartet', 0), kampf(2, 2, 'bereit', 1)];
    const { teams } = berechneMannschaften({ pools, mannschaften, mitglieder, begegnungen, kaempfe, teilnehmer }, optionen);
    const t1 = teams.find(t => t.key === 'k10');
    assert.equal(t1.zustand, 'laeuft');
    assert.equal(t1.gegner, 'Team 2');
    assert.equal(t1.matteBezeichnung, 'Matte 1');
    // Kader nach Gewichtsklasse, +X zuletzt
    assert.deepEqual(t1.mitglieder.map(m => m.gewichtsklasse), ['-40', '+57']);
    const t3 = teams.find(t => t.key === 'k12');
    assert.equal(t3.zustand, 'in_n');
    assert.equal(t3.abstand, 1);
});

test('Abstand zählt Begegnungen vor dem Team auf derselben Matte, eigene Matte der Begegnung gilt', () => {
    const begegnungen = [
        { id: 1, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: 11, status: 'bereit', runde: 1 },
        { id: 2, pool_id: 1, mannschaft1_id: 11, mannschaft2_id: 12, status: 'bereit', runde: 1, kampfflaeche_id: 2 },
        { id: 3, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: 12, status: 'bereit', runde: 2 }
    ];
    const kaempfe = [kampf(1, 1, 'bereit', 0), kampf(2, 1, 'bereit', 1), kampf(3, 2, 'bereit', 0, { kampfflaeche_id: 2 }), kampf(4, 3, 'bereit', 2)];
    const { teams, begegnungen: ausgabe } = berechneMannschaften({ pools, mannschaften, mitglieder, begegnungen, kaempfe, teilnehmer }, optionen);
    assert.equal(ausgabe.find(b => b.id === 2).matteId, 2);
    assert.equal(ausgabe.find(b => b.id === 1).abstand, 0);
    assert.equal(ausgabe.find(b => b.id === 3).abstand, 1); // hinter Begegnung 1 auf Matte 1
    assert.equal(teams.find(t => t.key === 'k10').zustand, 'als_naechstes');
    assert.equal(teams.find(t => t.key === 'k12').zustand, 'als_naechstes'); // Begegnung 2 ist auf Matte 2 vorn
});

test('Ergebnis: Siege/Niederlagen, abgeschlossen ohne offene Begegnung, Freilose zählen nicht', () => {
    const begegnungen = [
        { id: 1, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: 11, status: 'beendet', sieger_mannschaft_id: 10, siegpunkte_mannschaft1: 3, siegpunkte_mannschaft2: 2 },
        { id: 2, pool_id: 1, mannschaft1_id: 10, mannschaft2_id: null, status: 'freilos', sieger_mannschaft_id: 10 }
    ];
    const { teams, begegnungen: ausgabe } = berechneMannschaften({ pools, mannschaften, mitglieder, begegnungen, kaempfe: [], teilnehmer }, optionen);
    assert.equal(ausgabe.length, 1);
    assert.deepEqual([ausgabe[0].s1, ausgabe[0].s2, ausgabe[0].sieger], [3, 2, 'k10']);
    const t1 = teams.find(t => t.key === 'k10');
    assert.equal(t1.siege, 1);
    assert.equal(teams.find(t => t.key === 'k11').niederlagen, 1);
    assert.equal(t1.zustand, 'abgeschlossen');
});

test('Einzel-Pools und Sammelpool zählen nicht als Mannschaften', () => {
    const gemischt = [...pools, { id: 2, typ: 'einzel', verspaetet: false, kampfflaeche_id: 1 }, { id: 3, typ: 'mannschaft', verspaetet: true, kampfflaeche_id: null }];
    const m = [...mannschaften, { id: 20, pool_id: 2, verein: 'X', bezeichnung: 'Einzel' }, { id: 21, pool_id: 3, verein: 'Y', bezeichnung: 'Spät' }];
    const { teams } = berechneMannschaften({ pools: gemischt, mannschaften: m, mitglieder: [], begegnungen: [], kaempfe: [], teilnehmer }, optionen);
    assert.deepEqual(teams.map(t => t.key).sort(), ['k10', 'k11', 'k12']);
});
