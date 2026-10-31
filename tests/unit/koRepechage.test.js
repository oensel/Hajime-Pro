// KO-System mit Hoffnungsrunde (src/shared/koRepechage.js, src/services/KoRepechageManager.js): Struktur,
// vollständig durchgespielte Turniere über die Kaskade (ohne DB), Platzierungen, Moduswahl und Nachzügler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueKoRepechage, KO_REPECHAGE_FREILOS, koRepechageRunden, koRepechageKampfnamen } from '../../src/shared/koRepechage.js';
import { KoRepechageManager } from '../../src/services/KoRepechageManager.js';
import { berechneKaempferPatches } from '../../src/shared/kampfProgression.js';
import { berechnePlatzierungen } from '../../src/shared/platzierungen.js';
import { POOL_RUNDEN } from '../../src/shared/poolRunden.js';
import { bewerteEinfuegen, ermittleFreilosPlatz } from '../../src/shared/nachzueglerEinfuegen.js';
import { waehleWettkampfsystem, wettkampfsystemAlternativen } from '../../src/controllers/poolController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const teilnehmer = (n, verein = i => `V${i % 7}`) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, vorname: 'T', nachname: `N${i + 1}`, gewicht: 40 + i, verein: verein(i) }));

// Baut die Kämpfe wie KoRepechageManager.initialisierePool, nur im Speicher (Quell-Verknüpfungen über die Topologie).
function bauePool(raster, liste) {
    const manager = new KoRepechageManager(raster);
    const plan = manager.verteileAufRaster(liste);
    const { runden, topologie } = manager.struktur;
    const nummern = [...runden.flat(), 'T1', 'T2', 'T3', 'T4', 'F1'];
    const kaempfe = nummern.map((nr, i) => ({
        id: i + 1, reihenfolge_nummer: nr, status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
        unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
    }));
    runden[0].forEach((nr, i) => {
        const k = kaempfe.find(x => x.reihenfolge_nummer === nr);
        k.kaempfer1_id = plan[2 * i]?.id ?? null;
        k.kaempfer2_id = plan[2 * i + 1]?.id ?? null;
        k.status = k.kaempfer1_id && k.kaempfer2_id ? 'bereit' : 'freilos';
        if (k.status === 'freilos') k.sieger_id = k.kaempfer1_id || k.kaempfer2_id;
    });
    const idVon = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k.id]));
    for (const k of kaempfe) {
        const t = topologie[k.reihenfolge_nummer];
        if (!t) continue;
        Object.assign(k, {
            kaempfer1_quelle_kampf_id: idVon.get(t.k1[0]), kaempfer1_quelle_typ: t.k1[1],
            kaempfer2_quelle_kampf_id: idVon.get(t.k2[0]), kaempfer2_quelle_typ: t.k2[1]
        });
    }
    return { kaempfe, plan };
}

function kaskade(kaempfe) {
    for (let patches = berechneKaempferPatches(kaempfe); patches.length; patches = berechneKaempferPatches(kaempfe)) {
        for (const { id, ...p } of patches) Object.assign(kaempfe.find(k => k.id === id), p);
    }
}

// Spielt alles durch; der Kämpfer mit der kleineren Id gewinnt (Id 1 ist damit der Stärkste).
function spieleDurch(kaempfe) {
    kaskade(kaempfe);
    for (let offen = kaempfe.find(k => k.status === 'bereit'); offen; offen = kaempfe.find(k => k.status === 'bereit')) {
        Object.assign(offen, { status: 'beendet', sieger_id: Math.min(offen.kaempfer1_id, offen.kaempfer2_id), unterbewertung_kaempfer1: 10 });
        kaskade(kaempfe);
    }
}

const nr = (kaempfe, n) => kaempfe.find(k => k.reihenfolge_nummer === n);
const verlierer = k => (k.sieger_id === k.kaempfer1_id ? k.kaempfer2_id : k.kaempfer1_id);

test('Struktur: Kampfzahl, Hoffnungsrunde aus den Viertelfinal-Verlierern, Bronze über Kreuz', () => {
    for (const [raster, gesamt] of [[16, 19], [32, 35], [64, 67]]) {
        const { runden, viertelfinale, halbfinale, topologie } = baueKoRepechage(raster);
        assert.equal(runden.flat().length + 5, gesamt);
        assert.equal(runden[0].length, raster / 2);
        assert.deepEqual(topologie.T1, { k1: [viertelfinale[0], 'verlierer'], k2: [viertelfinale[1], 'verlierer'] });
        assert.deepEqual(topologie.T2, { k1: [viertelfinale[2], 'verlierer'], k2: [viertelfinale[3], 'verlierer'] });
        assert.deepEqual(topologie.T3, { k1: ['T1', 'sieger'], k2: [halbfinale[1], 'verlierer'] });
        assert.deepEqual(topologie.T4, { k1: ['T2', 'sieger'], k2: [halbfinale[0], 'verlierer'] });
        // jeder Kampf außer der ersten Runde hat genau eine Quelle je Seite, alle Quellen existieren
        const alle = new Set([...runden.flat(), 'T1', 'T2', 'T3', 'T4', 'F1']);
        Object.values(topologie).forEach(t => { assert.ok(alle.has(t.k1[0]) && alle.has(t.k2[0])); });
        assert.equal(Object.keys(topologie).length, gesamt - raster / 2);
        assert.deepEqual(POOL_RUNDEN[`KO-Repechage-${raster}`], koRepechageRunden(raster));
    }
    assert.deepEqual(koRepechageRunden(64).winner.map(r => r.title), ['1. Runde', '2. Runde', 'Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale']);
    assert.equal(koRepechageKampfnamen(32).H25, 'VF1');
    assert.equal(koRepechageKampfnamen(64).H62, 'HF2');
});

test('Freilose: nie zwei in einer Paarung, gleich viele je Pool A-D', () => {
    for (const raster of [16, 32, 64]) {
        const f = KO_REPECHAGE_FREILOS[raster];
        assert.equal(new Set(f).size, f.length);
        assert.equal(new Set(f.map(p => Math.floor(p / 2))).size, f.length);
        // nach jeder Anzahl Freilose höchstens ein Unterschied zwischen den Pools
        for (let anzahl = 1; anzahl <= f.length; anzahl++) {
            const jePool = [0, 1, 2, 3].map(q => f.slice(0, anzahl).filter(p => Math.floor(p / (raster / 4)) === q).length);
            assert.ok(Math.max(...jePool) - Math.min(...jePool) <= 1, `${raster}er, ${anzahl} Freilose: ${jePool}`);
        }
    }
});

for (const [raster, anzahlen] of [[16, [9, 12, 16]], [32, [17, 25, 32]], [64, [33, 48, 64]]]) {
    test(`${raster}er durchgespielt (${anzahlen.join('/')} Teilnehmer): Platz 1,2,3,3,5,5,7,7 und nur VF-Verlierer in der Hoffnungsrunde`, () => {
        const { viertelfinale, halbfinale } = baueKoRepechage(raster);
        for (const n of anzahlen) {
            const liste = teilnehmer(n);
            const { kaempfe } = bauePool(raster, liste);
            spieleDurch(kaempfe);
            assert.ok(kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos'), 'alle Kämpfe entschieden');
            // die erste Runde enthält jede Person genau einmal
            const ersteRunde = kaempfe.slice(0, raster / 2).flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean);
            assert.equal(new Set(ersteRunde).size, n);

            const vfVerlierer = viertelfinale.map(v => verlierer(nr(kaempfe, v)));
            assert.deepEqual([nr(kaempfe, 'T1').kaempfer1_id, nr(kaempfe, 'T1').kaempfer2_id], vfVerlierer.slice(0, 2));
            assert.deepEqual([nr(kaempfe, 'T2').kaempfer1_id, nr(kaempfe, 'T2').kaempfer2_id], vfVerlierer.slice(2));
            assert.equal(nr(kaempfe, 'T3').kaempfer2_id, verlierer(nr(kaempfe, halbfinale[1])));
            assert.equal(nr(kaempfe, 'T4').kaempfer2_id, verlierer(nr(kaempfe, halbfinale[0])));

            const r = berechnePlatzierungen({ modus: `KO-Repechage-${raster}` }, kaempfe, liste);
            assert.equal(r.abgeschlossen, true);
            const vergeben = r.eintraege.map(e => e.platz).filter(p => p != null).sort((a, b) => a - b);
            assert.deepEqual(vergeben, [1, 2, 3, 3, 5, 5, 7, 7], `${n} Teilnehmer`);
            assert.equal(r.eintraege.find(e => e.platz === 1).teilnehmer.id, 1);
        }
    });
}

test('Vereinstrennung: vier aus einem Verein landen in vier verschiedenen Pools', () => {
    const liste = teilnehmer(16, i => (i < 4 ? 'JC Gleich' : `V${i}`));
    const plan = new KoRepechageManager(16).verteileAufRaster(liste);
    const pools = [0, 1, 2, 3].map(q => plan.slice(q * 4, q * 4 + 4).filter(t => t?.verein === 'JC Gleich').length);
    assert.deepEqual(pools, [1, 1, 1, 1]);
});

test('Moduswahl: ab 33 automatisch KO-Repechage-64, ein KO-Repechage-Pool bleibt beim System', () => {
    assert.equal(waehleWettkampfsystem(32), 'Doppel-KO-32');
    assert.equal(waehleWettkampfsystem(33), 'KO-Repechage-64');
    assert.equal(waehleWettkampfsystem(64), 'KO-Repechage-64');
    assert.throws(() => waehleWettkampfsystem(65));
    assert.equal(waehleWettkampfsystem(12, 'KO-Repechage-16'), 'KO-Repechage-16');
    assert.equal(waehleWettkampfsystem(17, 'KO-Repechage-16'), 'KO-Repechage-32');
    assert.equal(waehleWettkampfsystem(30, 'KO-Repechage-64'), 'KO-Repechage-32');
    assert.equal(waehleWettkampfsystem(8, 'KO-Repechage-16'), 'Doppel-KO-8');
    assert.equal(waehleWettkampfsystem(12, 'Doppel-KO-16'), 'Doppel-KO-16');
    assert.deepEqual(wettkampfsystemAlternativen(12), ['Doppel-KO-16', 'KO-Repechage-16']);
    assert.deepEqual(wettkampfsystemAlternativen(20), ['Doppel-KO-32', 'KO-Repechage-32']);
    assert.deepEqual(wettkampfsystemAlternativen(5), []);
    assert.deepEqual(wettkampfsystemAlternativen(40), []);
});

test('Nachzügler im laufenden KO-Repechage-64: nimmt den nächsten Freilos-Platz, das System bleibt', () => {
    const liste = teilnehmer(40);
    const { kaempfe } = bauePool(64, liste);
    kaskade(kaempfe);
    const ersterEchter = kaempfe.find(k => k.status === 'bereit');
    Object.assign(ersterEchter, { status: 'beendet', sieger_id: ersterEchter.kaempfer1_id });
    kaskade(kaempfe);

    const platz = ermittleFreilosPlatz('KO-Repechage-64', 40);
    const freilosNr = KO_REPECHAGE_FREILOS[64][64 - 40 - 1];
    assert.equal(platz.kampfNr, `H${Math.floor(freilosNr / 2) + 1}`);
    const bewertung = bewerteEinfuegen({
        modus: 'KO-Repechage-64', poolStatus: 'gestartet', teilnehmerAnzahl: 40, kaempfe,
        systemNachher: waehleWettkampfsystem(41, 'KO-Repechage-64')
    });
    assert.equal(bewertung.art, 'einfuegen', bewertung.grund);
    assert.equal(bewertung.kampfNr, platz.kampfNr);
});

test('DB: 33 Teilnehmer werden zu KO-Repechage-64 mit 67 Kämpfen, Freilos-Sieger rücken sofort nach', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const idVon = z => (typeof z === 'object' ? z.id : z);
        const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2027-01-01', ausrichter: 'A' }).returning('id');
        const [p] = await knex('pools').insert({
            turnier_id: idVon(t), bezeichnung: 'Männer -81', modus: 'KO-Repechage-64', altersklasse: 'Männer', geschlecht: 'm', gewichtsklasse: '-81'
        }).returning('id');
        const poolId = idVon(p);
        for (let i = 0; i < 33; i++) {
            await knex('turnier_teilnehmer').insert({
                turnier_id: idVon(t), pool_id: poolId, judopass_id: `P${i}`, vorname: 'V', nachname: `N${i}`, geburtsjahr: 1995, gewicht: 75 + i / 10,
                altersklasse: 'Männer', gewichtsklasse: '-81', lizenz_ablauf: '2030-01-01', geschlecht: 'm', verein: `Verein ${i % 9}`
            });
        }
        const { KO_REPECHAGE_MANAGER } = await import('../../src/services/KoRepechageManager.js');
        await KO_REPECHAGE_MANAGER['KO-Repechage-64'].initialisierePool(knex, poolId);

        const kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        assert.equal(kaempfe.length, 67);
        assert.equal(kaempfe.filter(k => k.status === 'freilos').length, 31);
        const ersteRunde = kaempfe.filter(k => /^H([1-9]|[12]\d|3[0-2])$/.test(k.reihenfolge_nummer));
        assert.equal(ersteRunde.length, 32);
        assert.equal(ersteRunde.filter(k => k.status === 'bereit').length, 1, 'nur ein echter Kampf in der ersten Runde');
        // die 31 Freilos-Sieger stehen schon in der 2. Runde (H33-H48), dort ist nur ein Platz offen
        const zweiteRunde = kaempfe.filter(k => /^H(3[3-9]|4[0-8])$/.test(k.reihenfolge_nummer));
        assert.equal(zweiteRunde.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean).length, 31);
        const t3 = kaempfe.find(k => k.reihenfolge_nummer === 'T3');
        assert.ok(t3.kaempfer1_quelle_kampf_id && t3.kaempfer2_quelle_kampf_id, 'Bronzekampf ist verknüpft');
    } finally {
        await db.stoppe();
    }
});
