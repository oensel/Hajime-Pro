// Gruppen-Vorrunde mit KO-Endrunde (GruppenUeberKreuzManager mit GRUPPEN_KO): vier Gruppen à 3 bis 5, Erste und
// Zweite ins Viertelfinale (A1-B2, C1-D2, B1-A2, D1-C2), danach KO ohne kleines Finale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GruppenUeberKreuzManager, GRUPPEN_KO } from '../../src/services/GruppenUeberKreuzManager.js';
import { berechnePlatzierungen } from '../../src/shared/platzierungen.js';
import { ermittleAbhaengigeKaempfe } from '../../src/shared/korrekturRegel.js';
import { legeStichkaempfeAn } from '../../src/services/gleichstandService.js';
import { waehleWettkampfsystem, wettkampfsystemAlternativen } from '../../src/controllers/poolController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const idVon = z => (typeof z === 'object' ? z.id : z);
const manager = new GruppenUeberKreuzManager(GRUPPEN_KO);

async function bauePool(knex, anzahl) {
    const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2027-01-01', ausrichter: 'A' }).returning('id');
    const [m] = await knex('kampfflaechen').insert({ turnier_id: idVon(t), bezeichnung: 'Matte 1' }).returning('id');
    const [p] = await knex('pools').insert({
        turnier_id: idVon(t), kampfflaeche_id: idVon(m), bezeichnung: `U11 m ${anzahl}`, modus: 'Gruppen-KO', altersklasse: 'U11',
        geschlecht: 'm', gewichtsklasse: '-30'
    }).returning('id');
    const poolId = idVon(p);
    for (let i = 0; i < anzahl; i++) {
        await knex('turnier_teilnehmer').insert({
            turnier_id: idVon(t), pool_id: poolId, judopass_id: `K${poolId}-${i}`, vorname: 'V', nachname: `N${i}`, geburtsjahr: 2016,
            gewicht: 25 + i / 2, altersklasse: 'U11', gewichtsklasse: '-30', lizenz_ablauf: '2030-01-01', geschlecht: 'm', verein: `Verein ${i}`
        });
    }
    await manager.initialisierePool(knex, poolId);
    return poolId;
}

const mitglieder = (kaempfe, g) => [...new Set(kaempfe.filter(k => k.reihenfolge_nummer.startsWith(`V_${g}_`)).flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]))]
    .sort((x, y) => x - y);
const nr = (kaempfe, n) => kaempfe.find(k => k.reihenfolge_nummer === n);

async function beende(knex, poolId, kampf, sieger = Math.min(kampf.kaempfer1_id, kampf.kaempfer2_id), zeit = 60) {
    // Wertungspunkte beim Sieger (zählen für die Rangliste)
    const k1Siegt = sieger === kampf.kaempfer1_id;
    await knex('kaempfe').where({ id: kampf.id }).update({
        status: 'beendet', sieger_id: sieger, unterbewertung_kaempfer1: k1Siegt ? 10 : 0, unterbewertung_kaempfer2: k1Siegt ? 0 : 10, kampfzeit_in_sekunden: zeit
    });
    await manager.aktualisiereTurnier(knex, poolId);
}

async function spieleGruppe(knex, poolId, g) {
    const kaempfe = await knex('kaempfe').where({ pool_id: poolId }).where('reihenfolge_nummer', 'like', `V_${g}_%`);
    for (const k of kaempfe) await beende(knex, poolId, k);
}

test('Gruppen-KO 12 bis 20: Gruppen, Viertelfinale je Gruppenpaar, KO-Endrunde, Platzierungen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        for (const anzahl of [12, 13, 16, 19, 20]) {
            const poolId = await bauePool(knex, anzahl);
            let kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            const groessen = ['A', 'B', 'C', 'D'].map(g => mitglieder(kaempfe, g).length);
            assert.equal(groessen.reduce((s, n) => s + n, 0), anzahl);
            assert.ok(Math.max(...groessen) - Math.min(...groessen) <= 1, `${anzahl}: ${groessen}`);
            assert.deepEqual(['VF1', 'VF2', 'VF3', 'VF4', 'HF1', 'HF2', 'F1'].map(n => nr(kaempfe, n)?.status), Array(7).fill('angelegt'));

            // A und B fertig: VF1 (A1-B2) und VF3 (B1-A2) stehen, VF2/VF4 warten auf C und D
            await spieleGruppe(knex, poolId, 'A');
            await spieleGruppe(knex, poolId, 'B');
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            const [a1, a2] = mitglieder(kaempfe, 'A');
            const [b1, b2] = mitglieder(kaempfe, 'B');
            assert.deepEqual([nr(kaempfe, 'VF1').kaempfer1_id, nr(kaempfe, 'VF1').kaempfer2_id, nr(kaempfe, 'VF1').status], [a1, b2, 'bereit']);
            assert.deepEqual([nr(kaempfe, 'VF3').kaempfer1_id, nr(kaempfe, 'VF3').kaempfer2_id], [b1, a2]);
            assert.equal(nr(kaempfe, 'VF2').kaempfer1_id, null);

            await spieleGruppe(knex, poolId, 'C');
            await spieleGruppe(knex, poolId, 'D');
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            const [c1, c2] = mitglieder(kaempfe, 'C');
            const [d1, d2] = mitglieder(kaempfe, 'D');
            assert.deepEqual([nr(kaempfe, 'VF2').kaempfer1_id, nr(kaempfe, 'VF2').kaempfer2_id], [c1, d2]);
            assert.deepEqual([nr(kaempfe, 'VF4').kaempfer1_id, nr(kaempfe, 'VF4').kaempfer2_id], [d1, c2]);

            for (const n of ['VF1', 'VF2', 'VF3', 'VF4', 'HF1', 'HF2', 'F1']) {
                await beende(knex, poolId, nr(await knex('kaempfe').where({ pool_id: poolId }), n));
            }
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            // Halbfinale: Sieger VF1 gegen Sieger VF2, Sieger VF3 gegen Sieger VF4
            assert.deepEqual([nr(kaempfe, 'HF1').kaempfer1_id, nr(kaempfe, 'HF1').kaempfer2_id], [nr(kaempfe, 'VF1').sieger_id, nr(kaempfe, 'VF2').sieger_id]);
            const pool = await knex('pools').where({ id: poolId }).first();
            assert.equal(pool.status, 'kaempfe_beendet');

            const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId });
            const r = berechnePlatzierungen(pool, kaempfe, teilnehmer);
            assert.equal(r.abgeschlossen, true);
            const plaetze = r.eintraege.map(e => e.platz).sort((x, y) => x - y);
            const dritte = groessen.filter(n => n >= 3).length;
            const vierte = groessen.filter(n => n >= 4).length;
            const fuenfte = groessen.filter(n => n >= 5).length;
            assert.deepEqual(plaetze, [1, 2, 3, 3, 5, 5, 5, 5, ...Array(dritte).fill(9), ...Array(vierte).fill(13), ...Array(fuenfte).fill(17)], `${anzahl}`);
        }
    } finally {
        await db.stoppe();
    }
});

test('Gleichstand in Gruppe C: Stichkämpfe V_C_S*, VF2/VF4 warten, VF1/VF3 nicht', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const poolId = await bauePool(knex, 12); // vier Dreiergruppen
        await spieleGruppe(knex, poolId, 'A');
        await spieleGruppe(knex, poolId, 'B');
        await spieleGruppe(knex, poolId, 'D');
        // Gruppe C als Dreierkreis mit gleichen Zeiten: Platz 1 und 2 offen
        const c = await knex('kaempfe').where({ pool_id: poolId }).where('reihenfolge_nummer', 'like', 'V_C_%').orderBy('reihenfolge_nummer');
        const [x, y, z] = [...new Set(c.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]))].sort((p, q) => p - q);
        const sieger = { [`${x}-${y}`]: x, [`${x}-${z}`]: z, [`${y}-${z}`]: y };
        for (const k of c) {
            const schluessel = [k.kaempfer1_id, k.kaempfer2_id].sort((p, q) => p - q).join('-');
            await beende(knex, poolId, k, sieger[schluessel]);
        }
        let kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        assert.ok(nr(kaempfe, 'VF1').kaempfer1_id && nr(kaempfe, 'VF3').kaempfer1_id, 'A/B unabhängig von C');
        assert.equal(nr(kaempfe, 'VF2').kaempfer1_id, null);
        assert.equal(nr(kaempfe, 'VF4').kaempfer1_id, null);

        const neue = await legeStichkaempfeAn(knex, poolId, 'C');
        assert.equal(neue.length, 3);
        kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        assert.deepEqual(kaempfe.filter(k => /^V_C_S/.test(k.reihenfolge_nummer)).map(k => k.reihenfolge_nummer).sort(), ['V_C_S1', 'V_C_S2', 'V_C_S3']);
        // Stichkämpfe: x gewinnt alle
        for (const k of kaempfe.filter(k => /^V_C_S/.test(k.reihenfolge_nummer))) {
            await beende(knex, poolId, k, k.kaempfer1_id === x || k.kaempfer2_id === x ? x : Math.min(k.kaempfer1_id, k.kaempfer2_id));
        }
        kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        assert.equal(nr(kaempfe, 'VF2').kaempfer1_id, x, 'C1 nach den Stichkämpfen');
    } finally {
        await db.stoppe();
    }
});

test('Korrektur und Moduswahl', () => {
    const kaempfe = [
        { id: 1, reihenfolge_nummer: 'V_C_2' }, { id: 2, reihenfolge_nummer: 'VF1' }, { id: 3, reihenfolge_nummer: 'VF2' },
        { id: 4, reihenfolge_nummer: 'VF3' }, { id: 5, reihenfolge_nummer: 'VF4' }, { id: 6, reihenfolge_nummer: 'HF1', kaempfer1_quelle_kampf_id: 2 }
    ];
    assert.deepEqual(ermittleAbhaengigeKaempfe(kaempfe[0], kaempfe).map(k => k.reihenfolge_nummer).sort(), ['VF2', 'VF4']);

    assert.equal(waehleWettkampfsystem(14), 'Doppel-KO-16');
    assert.equal(waehleWettkampfsystem(14, 'Gruppen-KO'), 'Gruppen-KO');
    assert.equal(waehleWettkampfsystem(21, 'Gruppen-KO'), 'Doppel-KO-32');
    assert.equal(waehleWettkampfsystem(11, 'Gruppen-KO'), 'Doppel-KO-16');
    assert.deepEqual(wettkampfsystemAlternativen(12), ['Doppel-KO-16', 'KO-Repechage-16', 'Gruppen-KO']);
    assert.deepEqual(wettkampfsystemAlternativen(20), ['Doppel-KO-32', 'KO-Repechage-32', 'Gruppen-KO']);
    assert.deepEqual(wettkampfsystemAlternativen(21), ['Doppel-KO-32', 'KO-Repechage-32']);
});
