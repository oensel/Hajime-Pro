// Entscheidung eines Gleichstands auf relevanten Plätzen (Pool 1-3, Überkreuz-Gruppe 1-2, siehe src/shared/gleichstand.js):
// nach Siegzeit oder durch Stichkämpfe. Läuft am Hallen-Server; Client-Geräte stellen einen Antrag am Pool-Dokument,
// den die Sync-Brücke hier ausführt (src/sync/bruecke.js).
import { FachFehler } from '../utils/fachFehler.js';
import {
    pruefeGleichstand, entscheideNachSiegzeit, leseEntscheidung, RELEVANT_BIS_POOL, RELEVANT_BIS_GRUPPE
} from '../shared/gleichstand.js';
import { triggerPoolUpdate, reiheKampfPausenkonformEin } from '../controllers/kampfController.js';

const istJgj = modus => /^Jeder[- ]gegen[- ]Jeden$/.test(modus || '');
const nachNummer = (a, b) => String(a.reihenfolge_nummer).localeCompare(String(b.reihenfolge_nummer), 'de', { numeric: true });

// Die Gleichstands-Kontexte eines Pools: 'pool' im Jeder-gegen-Jeden, 'A' und 'B' (Vorrundengruppen) im Gruppen-Überkreuz.
async function ladeKontexte(knex, pool) {
    const kaempfe = await knex('kaempfe').where({ pool_id: pool.id });
    if (istJgj(pool.modus)) {
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: pool.id }).orderBy('gewicht', 'asc').orderBy('id', 'asc');
        return [{ schluessel: 'pool', ids: teilnehmer.map(t => t.id), kaempfe, bis: RELEVANT_BIS_POOL }];
    }
    if (pool.modus === 'Gruppen-Überkreuz') {
        const hf1 = kaempfe.find(k => k.reihenfolge_nummer === 'HF1');
        if (!hf1 || hf1.kaempfer1_id) return []; // Halbfinale schon besetzt: nichts mehr zu entscheiden
        return ['A', 'B'].map(g => {
            const gruppe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith(`V_${g}_`)).sort(nachNummer);
            const ids = [...new Set(gruppe.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean))];
            return { schluessel: g, ids, kaempfe: gruppe, bis: RELEVANT_BIS_GRUPPE };
        });
    }
    throw new FachFehler(409, 'Ein Gleichstand wird nur im Jeder-gegen-Jeden und im Gruppen-Überkreuz entschieden.');
}

async function ladeOffenenKontext(knex, poolId, schluessel) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (!pool) throw new FachFehler(404, 'Pool nicht gefunden.');
    if (pool.typ === 'mannschaft') throw new FachFehler(409, 'Für Mannschafts-Pools gibt es keine Gleichstands-Entscheidung.');
    const kontexte = await ladeKontexte(knex, pool);
    if (kontexte.length === 0) throw new FachFehler(409, 'Es gibt keinen offenen Gleichstand.');
    const kontext = kontexte.find(k => k.schluessel === schluessel);
    if (!kontext) throw new FachFehler(400, 'Unbekannte Gruppe für diesen Pool.');
    const entscheidung = leseEntscheidung(pool.gleichstand_entscheidung);
    const pruefung = pruefeGleichstand(kontext.ids, kontext.kaempfe, { bis: kontext.bis, entscheidung: entscheidung[schluessel] });
    if (!pruefung.bereit) throw new FachFehler(409, 'Es sind noch nicht alle Kämpfe beendet.');
    if (!pruefung.offen) throw new FachFehler(409, 'Es gibt keinen offenen Gleichstand.');
    return { pool, kontext, pruefung, entscheidung };
}

// Entscheidet den offenen Gleichstand nach der Gesamtzeit der Siege (nur, wenn die Zeit ihn auflöst).
export async function entscheideNachSiegzeitAm(knex, poolId, schluessel) {
    await knex.transaction(async (trx) => {
        // gesperrt wie legeStichkaempfeAn: ein gleichzeitiger Stichkampf-Antrag kommt erst danach und findet nichts Offenes
        await trx('pools').where({ id: poolId }).forUpdate().first();
        const { pruefung, entscheidung } = await ladeOffenenKontext(trx, poolId, schluessel);
        const blockOrdnungen = entscheideNachSiegzeit(pruefung);
        if (!blockOrdnungen) throw new FachFehler(409, 'Die Siegzeit entscheidet hier nicht. Bitte Stichkämpfe ansetzen.');
        // frühere Entscheidungen derselben Gruppe bleiben erhalten, solange sie andere Blöcke betreffen
        const alt = (entscheidung[schluessel] || []).filter(e => !blockOrdnungen.some(n => n.length === e.length && n.every(id => e.includes(id))));
        const neu = { ...entscheidung, [schluessel]: [...alt, ...blockOrdnungen] };
        await trx('pools').where({ id: poolId }).update({ gleichstand_entscheidung: JSON.stringify(neu) });
    });
    await triggerPoolUpdate(knex, poolId);
    return poolId;
}

// Legt die Stichkämpfe aller offenen Blöcke an (jeder gegen jeden unter den Betroffenen) und sortiert sie pausenkonform ein.
export async function legeStichkaempfeAn(knex, poolId, schluessel) {
    let pool;
    const neue = [];
    await knex.transaction(async (trx) => {
        // Pool-Zeile sperren: zwei gleichzeitige Anträge (zwei Geräte, Doppelklick) legen die Stichkämpfe nur einmal an,
        // der zweite findet danach offene Stichkämpfe und wird abgelehnt.
        await trx('pools').where({ id: poolId }).forUpdate().first();
        const kontext = await ladeOffenenKontext(trx, poolId, schluessel);
        pool = kontext.pool;
        if (pool.status === 'abgeschlossen') throw new FachFehler(409, 'Der Pool ist schon abgeschlossen.');
        const paarungen = kontext.pruefung.bloecke.flatMap(b => b.paarungen);
        const ueberkreuz = !istJgj(pool.modus);

        const alleKaempfe = await trx('kaempfe').where({ pool_id: poolId });
        let nummer = ueberkreuz
            ? alleKaempfe.filter(k => k.reihenfolge_nummer?.startsWith(`V_${schluessel}_S`)).length
            : alleKaempfe.reduce((m, k) => Math.max(m, parseInt(k.reihenfolge_nummer, 10) || 0), 0);

        for (const [id1, id2] of paarungen) {
            nummer += 1;
            const [zeile] = await trx('kaempfe').insert({
                pool_id: poolId,
                status: 'bereit',
                reihenfolge_nummer: ueberkreuz ? `V_${schluessel}_S${nummer}` : nummer,
                kaempfer1_id: id1,
                kaempfer2_id: id2,
                sieger_id: null,
                kampfzeit_in_sekunden: 0,
                unterbewertung_kaempfer1: 0,
                unterbewertung_kaempfer2: 0,
                reihenfolge_manuell: true
            }).returning('id');
            neue.push(await trx('kaempfe').where({ id: typeof zeile === 'object' ? zeile.id : zeile }).first());
        }
        // Im Jeder-gegen-Jeden ist der Pool wieder in Betrieb und wird nach dem letzten Stichkampf erneut zum Pool in Prüfung.
        if (!ueberkreuz) await trx('pools').where({ id: poolId }).update({ status: 'gestartet' });
    });
    for (const kampf of neue) await reiheKampfPausenkonformEin(knex, pool, kampf);
    return neue.map(k => k.id);
}

// Antrag eines Client-Geräts am Pool-Dokument: { schluessel, regel: 'siegzeit' | 'stichkampf' }.
export async function fuehreGleichstandAntragAus(knex, poolId, antrag) {
    if (!antrag || typeof antrag !== 'object') throw new FachFehler(400, 'Ungültiger Antrag.');
    if (antrag.regel === 'siegzeit') return entscheideNachSiegzeitAm(knex, poolId, antrag.schluessel);
    if (antrag.regel === 'stichkampf') return legeStichkaempfeAn(knex, poolId, antrag.schluessel);
    throw new FachFehler(400, 'Unbekannte Entscheidung.');
}

export async function gleichstandRoute(knex, req, res) {
    try {
        const poolId = parseInt(req.params.id, 10);
        const { schluessel, regel } = req.body || {};
        const ergebnis = await fuehreGleichstandAntragAus(knex, poolId, { schluessel, regel });
        return res.json({ success: true, ergebnis });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}
