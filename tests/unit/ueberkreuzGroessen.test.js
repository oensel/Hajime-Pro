// Gruppen-Überkreuz mit 6 bis 10 Teilnehmern (GruppenUeberKreuzManager.js, gruppenUeberkreuzProgression.js):
// Gruppengrößen, Vereinstrennung, Befüllung des Halbfinales erst nach beiden Gruppen, Platzierungen, Moduswahl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GruppenUeberKreuzManager } from '../../src/services/GruppenUeberKreuzManager.js';
import { berechnePlatzierungen } from '../../src/shared/platzierungen.js';
import { ermittleAbhaengigeKaempfe } from '../../src/shared/korrekturRegel.js';
import { waehleWettkampfsystem, wettkampfsystemAlternativen } from '../../src/controllers/poolController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const idVon = z => (typeof z === 'object' ? z.id : z);
const manager = new GruppenUeberKreuzManager();

async function bauePool(knex, anzahl, verein = i => `Verein ${i}`) {
    const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2027-01-01', ausrichter: 'A' }).returning('id');
    const [p] = await knex('pools').insert({
        turnier_id: idVon(t), bezeichnung: `U11 m ${anzahl}`, modus: 'Gruppen-Überkreuz', altersklasse: 'U11', geschlecht: 'm', gewichtsklasse: '-30'
    }).returning('id');
    const poolId = idVon(p);
    for (let i = 0; i < anzahl; i++) {
        await knex('turnier_teilnehmer').insert({
            turnier_id: idVon(t), pool_id: poolId, judopass_id: `P${poolId}-${i}`, vorname: 'V', nachname: `N${i}`, geburtsjahr: 2016,
            gewicht: 25 + i, altersklasse: 'U11', gewichtsklasse: '-30', lizenz_ablauf: '2030-01-01', geschlecht: 'm', verein: verein(i)
        });
    }
    await manager.initialisierePool(knex, poolId);
    return poolId;
}

const gruppeVon = (kaempfe, g) => new Set(kaempfe.filter(k => k.reihenfolge_nummer.startsWith(`V_${g}_`)).flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]));

// Beendet einen Kampf; Sieger ist der Kämpfer mit der kleineren Id (ergibt in jeder Gruppe eine eindeutige Rangfolge).
async function beende(knex, poolId, kampf) {
    await knex('kaempfe').where({ id: kampf.id }).update({
        status: 'beendet', sieger_id: Math.min(kampf.kaempfer1_id, kampf.kaempfer2_id), unterbewertung_kaempfer1: 10, kampfzeit_in_sekunden: 60
    });
    await manager.aktualisiereTurnier(knex, poolId);
}

test('Gruppen-Überkreuz 6 bis 10: Gruppen, Vorrunde, Halbfinale erst nach beiden Gruppen, Platzierungen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const erwartetePlaetze = {
            6: [1, 2, 3, 3, 5, 5],
            7: [1, 2, 3, 3, 5, 5, 7],
            8: [1, 2, 3, 3, 5, 5, 7, 7],
            9: [1, 2, 3, 3, 5, 5, 7, 7, 9],
            10: [1, 2, 3, 3, 5, 5, 7, 7, 9, 9]
        };
        for (const anzahl of [6, 7, 8, 9, 10]) {
            const poolId = await bauePool(knex, anzahl);
            let kaempfe = await knex('kaempfe').where({ pool_id: poolId }).orderBy('id');
            const a = Math.ceil(anzahl / 2);
            const b = Math.floor(anzahl / 2);
            assert.equal(gruppeVon(kaempfe, 'A').size, a, `${anzahl}: Gruppe A`);
            assert.equal(gruppeVon(kaempfe, 'B').size, b, `${anzahl}: Gruppe B`);
            const vorrunde = kaempfe.filter(k => k.reihenfolge_nummer.startsWith('V_'));
            assert.equal(vorrunde.length, (a * (a - 1)) / 2 + (b * (b - 1)) / 2);
            // die Gruppen wechseln sich ab, solange beide noch Kämpfe haben
            assert.deepEqual(vorrunde.slice(0, 4).map(k => k.reihenfolge_nummer), ['V_A_1', 'V_B_1', 'V_A_2', 'V_B_2']);

            // erst Gruppe A komplett: Halbfinale bleibt leer
            for (const k of vorrunde.filter(x => x.reihenfolge_nummer.startsWith('V_A_'))) await beende(knex, poolId, k);
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            assert.ok(kaempfe.filter(k => /^HF/.test(k.reihenfolge_nummer)).every(k => !k.kaempfer1_id), `${anzahl}: HF vor Gruppe B`);

            for (const k of vorrunde.filter(x => x.reihenfolge_nummer.startsWith('V_B_'))) await beende(knex, poolId, k);
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            const hf1 = kaempfe.find(k => k.reihenfolge_nummer === 'HF1');
            const hf2 = kaempfe.find(k => k.reihenfolge_nummer === 'HF2');
            const [a1, a2] = [...gruppeVon(kaempfe, 'A')].sort((x, y) => x - y);
            const [b1, b2] = [...gruppeVon(kaempfe, 'B')].sort((x, y) => x - y);
            assert.deepEqual([hf1.kaempfer1_id, hf1.kaempfer2_id, hf1.status], [a1, b2, 'bereit']);
            assert.deepEqual([hf2.kaempfer1_id, hf2.kaempfer2_id, hf2.status], [b1, a2, 'bereit']);

            await beende(knex, poolId, hf1);
            await beende(knex, poolId, hf2);
            const f1 = await knex('kaempfe').where({ pool_id: poolId, reihenfolge_nummer: 'F1' }).first();
            await beende(knex, poolId, f1);

            const pool = await knex('pools').where({ id: poolId }).first();
            assert.equal(pool.status, 'kaempfe_beendet');
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
            const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId });
            const r = berechnePlatzierungen(pool, kaempfe, teilnehmer);
            assert.equal(r.abgeschlossen, true);
            assert.deepEqual(r.eintraege.map(e => e.platz).sort((x, y) => x - y), erwartetePlaetze[anzahl], `${anzahl} Teilnehmer`);
        }
    } finally {
        await db.stoppe();
    }
});

test('Vereinstrennung: Vereinskameraden in verschiedenen Gruppen, ohne Konflikt abwechselnd nach Gewicht', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        // 6 ohne Vereinskonflikt: wie bisher 1., 3., 5. → A, 2., 4., 6. → B
        let poolId = await bauePool(knex, 6);
        let kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        const tn = (await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('gewicht')).map(t => t.id);
        assert.deepEqual([...gruppeVon(kaempfe, 'A')].sort((x, y) => x - y), [tn[0], tn[2], tn[4]]);

        // 8, davon die beiden Leichtesten (nach Gewicht aufeinanderfolgend → sonst A und B) und zwei weitere aus einem Verein
        poolId = await bauePool(knex, 8, i => ([0, 2, 4, 6].includes(i) ? 'JC Gleich' : `Verein ${i}`));
        kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        const gleich = (await knex('turnier_teilnehmer').where({ pool_id: poolId, verein: 'JC Gleich' })).map(t => t.id);
        const inA = gleich.filter(id => gruppeVon(kaempfe, 'A').has(id)).length;
        assert.equal(inA, 2, 'je zwei aus dem Verein in A und B');
    } finally {
        await db.stoppe();
    }
});

test('Korrektur: ein Vorrundenkampf hängt am Halbfinale', () => {
    const kaempfe = [
        { id: 1, reihenfolge_nummer: 'V_A_1' }, { id: 2, reihenfolge_nummer: 'V_B_4' },
        { id: 3, reihenfolge_nummer: 'HF1' }, { id: 4, reihenfolge_nummer: 'HF2' }, { id: 5, reihenfolge_nummer: 'F1', kaempfer1_quelle_kampf_id: 3 }
    ];
    assert.deepEqual(ermittleAbhaengigeKaempfe(kaempfe[1], kaempfe).map(k => k.reihenfolge_nummer).sort(), ['HF1', 'HF2']);
});

test('Moduswahl: Überkreuz bei 7-10 wählbar, ein Überkreuz-Pool bleibt dabei', () => {
    assert.equal(waehleWettkampfsystem(8), 'Doppel-KO-8');
    assert.equal(waehleWettkampfsystem(8, 'Gruppen-Überkreuz'), 'Gruppen-Überkreuz');
    assert.equal(waehleWettkampfsystem(10, 'Gruppen-Überkreuz'), 'Gruppen-Überkreuz');
    assert.equal(waehleWettkampfsystem(11, 'Gruppen-Überkreuz'), 'Doppel-KO-16');
    assert.equal(waehleWettkampfsystem(5, 'Gruppen-Überkreuz'), 'Jeder-gegen-Jeden');
    assert.deepEqual(wettkampfsystemAlternativen(7), ['Doppel-KO-8', 'Gruppen-Überkreuz']);
    assert.deepEqual(wettkampfsystemAlternativen(10), ['Doppel-KO-16', 'KO-Repechage-16', 'Gruppen-Überkreuz']);
    assert.deepEqual(wettkampfsystemAlternativen(11), ['Doppel-KO-16', 'KO-Repechage-16']);
});
