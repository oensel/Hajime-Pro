import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bewerteEinfuegen, ordneNachzueglerKaempfe } from '../../src/shared/nachzueglerEinfuegen.js';
import { berechneVorschlag, listeOffenePools } from '../../src/services/nachzuegler.js';

const k = (status, n = 1) => Array.from({ length: n }, () => ({ status }));
const jgj = (teilnehmerAnzahl, kaempfe, extra = {}) => ({
    modus: 'Jeder-gegen-Jeden', poolStatus: 'matte_zugewiesen', teilnehmerAnzahl, kaempfe,
    systemNachher: teilnehmerAnzahl + 1 <= 5 ? 'Jeder-gegen-Jeden' : 'Gruppen-Überkreuz', ...extra
});

test('Pool ohne begonnene Kämpfe: Neuaufbau wie bisher, auch mit Systemwechsel', () => {
    const r = bewerteEinfuegen({ modus: 'Jeder-gegen-Jeden', poolStatus: 'matte_zugewiesen', teilnehmerAnzahl: 5, kaempfe: k('bereit', 10), systemNachher: 'Gruppen-Überkreuz' });
    assert.deepEqual(r, { art: 'neuaufbau', moeglich: true, grund: null, systemWechsel: true });
});

test('laufender Jeder-gegen-Jeden-Pool: einfügbar, solange mindestens so viele Kämpfe offen sind wie neue nötig', () => {
    // 4 Teilnehmer = 6 Kämpfe, 2 beendet -> 4 offen, der Nachzügler braucht 4
    const r = bewerteEinfuegen(jgj(4, [...k('beendet', 2), ...k('bereit', 4)]));
    assert.equal(r.art, 'einfuegen');
    assert.equal(r.moeglich, true);
    assert.equal(r.neueKaempfe, 4);
    assert.equal(r.offen, 4);
});

test('zu spät: weniger offene Kämpfe als der Nachzügler bestreiten müsste', () => {
    const r = bewerteEinfuegen(jgj(4, [...k('beendet', 3), ...k('bereit', 3)]));
    assert.equal(r.moeglich, false);
    assert.match(r.grund, /noch 3 Kämpfe offen.*müsste 4 bestreiten/);
});

test('der laufende (gestartete) Kampf zählt nicht als offen', () => {
    const r = bewerteEinfuegen(jgj(4, [...k('beendet', 1), ...k('gestartet', 1), ...k('bereit', 4)]));
    assert.equal(r.moeglich, true);
    const knapp = bewerteEinfuegen(jgj(4, [...k('beendet', 2), ...k('gestartet', 1), ...k('bereit', 3)]));
    assert.equal(knapp.moeglich, false);
});

test('Systemwechsel nach Beginn ist nie möglich und wird begründet', () => {
    const r = bewerteEinfuegen(jgj(5, [...k('beendet', 1), ...k('bereit', 9)]));
    assert.equal(r.moeglich, false);
    assert.match(r.grund, /Gruppen-Überkreuz statt Jeder-gegen-Jeden/);
    assert.match(r.grund, /Wechsel des Systems ist nach Beginn nicht möglich/);
});

test('laufender Doppel-KO-Pool und ausgekämpfter Pool sind gesperrt', () => {
    const ko = bewerteEinfuegen({ modus: 'Doppel-KO-8', poolStatus: 'matte_zugewiesen', teilnehmerAnzahl: 7, kaempfe: [...k('beendet', 1), ...k('bereit', 5)], systemNachher: 'Doppel-KO-8' });
    assert.equal(ko.moeglich, false);
    const fertig = bewerteEinfuegen(jgj(3, k('beendet', 3), { poolStatus: 'kaempfe_beendet' }));
    assert.equal(fertig.moeglich, false);
    assert.match(fertig.grund, /ausgekämpft/);
});

test('Nachzügler-Kämpfe werden gleichmäßig zwischen die übrigen verteilt, nie ans Ende', () => {
    const regulaer = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, nachzuegler: false }));
    const neu = ['x', 'y', 'z'].map(id => ({ id, nachzuegler: true }));
    const ids = ordneNachzueglerKaempfe([...regulaer, ...neu]).map(e => e.id);
    assert.deepEqual(ids, ['A', 'x', 'B', 'y', 'C', 'z', 'D', 'E']);
    assert.notEqual(ids[ids.length - 1], 'z');
});

test('genau so viele offene wie neue Kämpfe: abwechselnd, der letzte reguläre Kampf bleibt hinten', () => {
    const regulaer = ['A', 'B', 'C', 'D'].map(id => ({ id, nachzuegler: false }));
    const neu = ['w', 'x', 'y', 'z'].map(id => ({ id, nachzuegler: true }));
    const ids = ordneNachzueglerKaempfe([...regulaer, ...neu]).map(e => e.id);
    assert.deepEqual(ids, ['w', 'A', 'x', 'B', 'y', 'C', 'z', 'D']);
});

test('ohne Nachzügler-Kämpfe bleibt die Reihenfolge unverändert', () => {
    const liste = [{ id: 1 }, { id: 2 }, { id: 3 }];
    assert.equal(ordneNachzueglerKaempfe(liste), liste);
});

test('Vorschlag und Liste: laufender Pool nur mit Begründung, wenn er nicht mehr aufnimmt', () => {
    const waehleSystem = (n) => (n <= 5 ? 'Jeder-gegen-Jeden' : 'Gruppen-Überkreuz');
    const pruefeSpanne = () => ({ zulaessig: true });
    const nz = { id: 9, altersklasse: 'U13', geschlecht: 'männlich', gewicht: 38, gewichtsklasse: '-40' };
    const voll = {
        id: 1, bezeichnung: 'U13 -40', altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', modus: 'Jeder-gegen-Jeden',
        status: 'matte_zugewiesen', kampfflaeche_id: 1,
        teilnehmer: [{ gewicht: 36 }, { gewicht: 37 }, { gewicht: 38 }, { gewicht: 39 }, { gewicht: 40 }],
        kaempfe: [...k('beendet', 1), ...k('bereit', 9)]
    };
    assert.equal(berechneVorschlag(nz, [voll], { pruefeSpanne, waehleSystem }), null);
    const liste = listeOffenePools(nz, [voll], { pruefeSpanne, waehleSystem });
    assert.equal(liste.length, 1);
    assert.equal(liste[0].moeglich, false);
    assert.equal(liste[0].laeuft, true);
    assert.match(liste[0].grund, /Wechsel des Systems/);

    // 3 Teilnehmer = 3 Kämpfe, 1 beendet, 2 offen: der Nachzügler braucht 3 -> zu spät
    const knapp = { ...voll, teilnehmer: voll.teilnehmer.slice(0, 3), kaempfe: [...k('beendet', 1), ...k('bereit', 2)] };
    assert.equal(listeOffenePools(nz, [knapp], { pruefeSpanne, waehleSystem })[0].moeglich, false);

    // 3 Teilnehmer, keiner beendet, 1 läuft, 3 offen -> einfügbar, 3 neue Kämpfe, Vorschlag möglich
    const frei = { ...voll, teilnehmer: voll.teilnehmer.slice(0, 3), kaempfe: [...k('gestartet', 1), ...k('bereit', 3)] };
    const eintrag = listeOffenePools(nz, [frei], { pruefeSpanne, waehleSystem })[0];
    assert.deepEqual([eintrag.moeglich, eintrag.art, eintrag.neueKaempfe], [true, 'einfuegen', 3]);
    assert.equal(berechneVorschlag(nz, [frei], { pruefeSpanne, waehleSystem }).poolId, 1);
});

// ---------- Doppel-KO: Nachzügler nimmt den nächsten Freilos-Platz ----------
import { ermittleFreilosPlatz, ermittleAbhaengige, pruefeBaumEinfuegen } from '../../src/shared/nachzueglerEinfuegen.js';
import { DOPPEL_KO_8_TOPOLOGIE, DOPPEL_KO_16_TOPOLOGIE } from '../../src/shared/bracketTopologie.js';

// baut die Kämpfe eines Doppel-KO-Baums (Nummer -> Zeile) mit Quelle-Verknüpfungen nach der Topologie
function baum(topologie, ersteRunde, staten = {}) {
    const zeilen = new Map();
    let id = 1;
    for (const [nr, daten] of Object.entries(ersteRunde)) {
        zeilen.set(nr, { id: id++, reihenfolge_nummer: nr, status: 'bereit', kaempfer1_id: null, kaempfer2_id: null, ...daten });
    }
    for (const nr of Object.keys(topologie)) {
        zeilen.set(nr, { id: id++, reihenfolge_nummer: nr, status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null });
    }
    for (const [nr, t] of Object.entries(topologie)) {
        const z = zeilen.get(nr);
        z.kaempfer1_quelle_kampf_id = zeilen.get(t.k1[0]).id;
        z.kaempfer2_quelle_kampf_id = zeilen.get(t.k2[0]).id;
    }
    for (const [nr, status] of Object.entries(staten)) zeilen.get(nr).status = status;
    return [...zeilen.values()];
}

// 7 Teilnehmer im 8er-Raster: Freilos auf Platz 8 (Index 7) = zweiter Platz von H4
const dk8Runde1 = {
    H1: { kaempfer1_id: 1, kaempfer2_id: 2 }, H2: { kaempfer1_id: 3, kaempfer2_id: 4 },
    H3: { kaempfer1_id: 5, kaempfer2_id: 6 },
    H4: { kaempfer1_id: 7, kaempfer2_id: null, status: 'freilos', sieger_id: 7 }
};

test('Freilos-Platz: der nächste freie Rasterplatz je System in der DJB-Reihenfolge', () => {
    assert.deepEqual(ermittleFreilosPlatz('Doppel-KO-8', 7), { kampfNr: 'H4', seite: 'kaempfer2_id' });
    assert.deepEqual(ermittleFreilosPlatz('Doppel-KO-8', 6), { kampfNr: 'H1', seite: 'kaempfer1_id' });
    assert.deepEqual(ermittleFreilosPlatz('Doppel-KO-16', 15), { kampfNr: 'H8', seite: 'kaempfer2_id' });
    assert.deepEqual(ermittleFreilosPlatz('Doppel-KO-16', 9), { kampfNr: 'H7', seite: 'kaempfer1_id' });
    assert.deepEqual(ermittleFreilosPlatz('Doppel-KO-32', 31), { kampfNr: 'H1', seite: 'kaempfer2_id' });
    assert.equal(ermittleFreilosPlatz('Doppel-KO-8', 8), null); // voll: wäre schon ein anderes System
    assert.equal(ermittleFreilosPlatz('Jeder-gegen-Jeden', 4), null);
});

test('Doppel-KO-8: Freilos-Platz frei, solange nichts von H4 Abhängiges begonnen hat', () => {
    const kaempfe = baum(DOPPEL_KO_8_TOPOLOGIE, dk8Runde1, { H1: 'beendet', H2: 'beendet', H5: 'bereit' });
    const r = pruefeBaumEinfuegen({ modus: 'Doppel-KO-8', teilnehmerAnzahl: 7, kaempfe });
    assert.equal(r.moeglich, true);
    assert.equal(r.kampfNr, 'H4');
    assert.equal(r.seite, 'kaempfer2_id');
    const nummern = ermittleAbhaengige(kaempfe, r.kampfId).map(k => k.reihenfolge_nummer).sort();
    // H6 (Sieger H4), T2 (Verlierer H4) und was daraus folgt
    assert.deepEqual(nummern, ['F', 'H6', 'T2', 'T3', 'T4'].sort());
});

test('Doppel-KO-8: ein bereits begonnener Folgekampf sperrt den Platz mit Nennung des Kampfes', () => {
    const kaempfe = baum(DOPPEL_KO_8_TOPOLOGIE, dk8Runde1, { H1: 'beendet', H2: 'beendet', H3: 'beendet', H6: 'gestartet' });
    const r = pruefeBaumEinfuegen({ modus: 'Doppel-KO-8', teilnehmerAnzahl: 7, kaempfe });
    assert.equal(r.moeglich, false);
    assert.match(r.grund, /H4.*Kampf H6 hat bereits begonnen/);
    const beendet = baum(DOPPEL_KO_8_TOPOLOGIE, dk8Runde1, { H3: 'beendet', H6: 'beendet' });
    assert.equal(pruefeBaumEinfuegen({ modus: 'Doppel-KO-8', teilnehmerAnzahl: 7, kaempfe: beendet }).moeglich, false);
});

test('Doppel-KO-8: ein ausgetragener Kampf ohne Bezug zum freien Platz sperrt nicht', () => {
    // H1..H3 und H5 sind unabhängig von H4; nur H6 und die Trostrunde über H4 zählen
    const kaempfe = baum(DOPPEL_KO_8_TOPOLOGIE, dk8Runde1, { H1: 'beendet', H2: 'beendet', H5: 'beendet', T1: 'beendet' });
    assert.equal(pruefeBaumEinfuegen({ modus: 'Doppel-KO-8', teilnehmerAnzahl: 7, kaempfe }).moeglich, true);
});

test('Doppel-KO-16: Platz H7 bei 9 Teilnehmern, Sperre über die Trostrunde', () => {
    const runde1 = {};
    let spieler = 1;
    for (let i = 1; i <= 8; i++) runde1[`H${i}`] = { kaempfer1_id: spieler++, kaempfer2_id: spieler++ };
    // 9 Teilnehmer: 7 Freilose; zwischen den Spielen H7 (Index 12/13) bleibt nur der erste Platz belegt
    for (const nr of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H8']) {
        runde1[nr] = { kaempfer1_id: spieler++, kaempfer2_id: null, status: 'freilos', sieger_id: spieler - 1 };
    }
    runde1.H7 = { kaempfer1_id: null, kaempfer2_id: 99, status: 'freilos', sieger_id: 99 };
    const frei = baum(DOPPEL_KO_16_TOPOLOGIE, runde1);
    // Index 12 -> H7, seite kaempfer1_id (für 9 Teilnehmer)
    const r = pruefeBaumEinfuegen({ modus: 'Doppel-KO-16', teilnehmerAnzahl: 9, kaempfe: frei });
    assert.equal(r.moeglich, true);
    assert.equal(r.kampfNr, 'H7');
    const gesperrt = baum(DOPPEL_KO_16_TOPOLOGIE, runde1, { H12: 'beendet' });
    const g = pruefeBaumEinfuegen({ modus: 'Doppel-KO-16', teilnehmerAnzahl: 9, kaempfe: gesperrt });
    assert.equal(g.moeglich, false);
    assert.match(g.grund, /Kampf H12/);
});

test('bewerteEinfuegen: laufender Doppel-KO-Pool nimmt auf, mit Hinweistext, sonst Begründung', () => {
    const kaempfe = baum(DOPPEL_KO_8_TOPOLOGIE, dk8Runde1, { H1: 'beendet' });
    const ok = bewerteEinfuegen({ modus: 'Doppel-KO-8', poolStatus: 'matte_zugewiesen', teilnehmerAnzahl: 7, kaempfe, systemNachher: 'Doppel-KO-8' });
    assert.equal(ok.art, 'einfuegen');
    assert.equal(ok.neueKaempfe, 1);
    assert.match(ok.hinweis, /Platz H4 im Turnierbaum/);
    // 8 Teilnehmer + 1 wäre Doppel-KO-16: Systemwechsel nach Beginn nicht möglich
    const wechsel = bewerteEinfuegen({ modus: 'Doppel-KO-8', poolStatus: 'matte_zugewiesen', teilnehmerAnzahl: 8, kaempfe, systemNachher: 'Doppel-KO-16' });
    assert.equal(wechsel.moeglich, false);
    assert.match(wechsel.grund, /Doppel-KO-16 statt Doppel-KO-8/);
});
