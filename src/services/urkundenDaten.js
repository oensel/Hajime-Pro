// Liefert die Urkunden-Datensätze eines Turniers: Platzierungen je Pool (shared/platzierungen.js),
// gefiltert nach Platzbereich und Pools, sortiert nach Pool und gewählter Reihenfolge.
import { berechnePlatzierungen, berechneMannschaftsPlatzierungen } from '../shared/platzierungen.js';
import { platzierungsText, geschlechtText } from '../shared/urkundenText.js';

const BEISPIEL = {
    Name: 'Maximilian Mustermann', Verein: 'Judo-Club Musterstadt', Platzierung: '1. Platz',
    Altersklasse: 'U15', Geschlecht: 'männlich', Gewichtsklasse: '-50 kg', Mannschaft: ''
};

// "-44" / "-44 kg" / "+90" → sortierbarer Wert, "+"-Klassen hinter alle anderen
function gewichtsWert(g) {
    if (!g) return 0;
    const zahl = parseFloat(String(g).replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    return String(g).trim().startsWith('+') ? zahl + 10000 : zahl;
}

function vergleichePools(a, b) {
    const typ = (a.typ === 'mannschaft') - (b.typ === 'mannschaft');
    return typ
        || String(a.altersklasse || '').localeCompare(String(b.altersklasse || ''), 'de', { numeric: true })
        || String(a.geschlecht || '').localeCompare(String(b.geschlecht || ''), 'de')
        || gewichtsWert(a.gewichtsklasse) - gewichtsWert(b.gewichtsklasse)
        || a.id - b.id;
}

function poolFelder(pool) {
    return { Altersklasse: pool.altersklasse ?? '', Geschlecht: geschlechtText(pool.geschlecht) };
}

async function ladeEinzelPool(knex, pool) {
    const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: pool.id });
    const kaempfe = await knex('kaempfe').where({ pool_id: pool.id });
    const { abgeschlossen, eintraege } = berechnePlatzierungen(pool, kaempfe, teilnehmer);
    const datensaetze = eintraege.map(({ platz, teilnehmer: t }) => ({
        Name: `${t.vorname ?? ''} ${t.nachname ?? ''}`.trim(),
        Verein: t.verein ?? '',
        Platzierung: platzierungsText(platz),
        ...poolFelder(pool),
        Gewichtsklasse: pool.gewichtsklasse ?? '',
        Mannschaft: '',
        _platz: platz,
        _sortierung: [String(t.nachname ?? ''), String(t.vorname ?? '')]
    }));
    return { abgeschlossen, datensaetze };
}

async function ladeMannschaftsPool(knex, pool) {
    const mannschaften = await knex('mannschaften').where({ pool_id: pool.id });
    const begegnungen = await knex('mannschaftskaempfe').where({ pool_id: pool.id });
    const mitglieder = mannschaften.length === 0 ? [] : await knex('mannschaft_mitglieder as mm')
        .join('turnier_teilnehmer as t', 't.id', 'mm.turnier_teilnehmer_id')
        .whereIn('mm.mannschaft_id', mannschaften.map(m => m.id))
        .select('mm.mannschaft_id', 'mm.gewichtsklasse as position', 't.vorname', 't.nachname', 't.verein');
    let positionen = [];
    try { positionen = JSON.parse(pool.mannschafts_gewichtsklassen || '[]'); } catch { positionen = []; }
    const positionIndex = p => {
        const i = positionen.indexOf(p);
        return i === -1 ? positionen.length : i;
    };

    const { abgeschlossen, eintraege } = berechneMannschaftsPlatzierungen(pool, begegnungen, mannschaften);
    const datensaetze = eintraege.flatMap(({ platz, mannschaft }) => mitglieder
        .filter(m => m.mannschaft_id === mannschaft.id)
        .map(m => ({
            Name: `${m.vorname ?? ''} ${m.nachname ?? ''}`.trim(),
            Verein: m.verein || mannschaft.verein || '',
            Platzierung: platzierungsText(platz),
            ...poolFelder(pool),
            Gewichtsklasse: m.position ?? '',
            Mannschaft: mannschaft.bezeichnung ?? '',
            _platz: platz,
            _sortierung: [String(mannschaft.bezeichnung ?? ''), String(positionIndex(m.position)).padStart(4, '0')]
        })));
    return { abgeschlossen, datensaetze };
}

async function ladePools(knex, turnierId, poolIds) {
    let abfrage = knex('pools').where({ turnier_id: turnierId });
    if (poolIds) abfrage = abfrage.whereIn('id', poolIds);
    const pools = (await abfrage).sort(vergleichePools);
    const ergebnis = [];
    for (const pool of pools) {
        const daten = pool.typ === 'mannschaft' ? await ladeMannschaftsPool(knex, pool) : await ladeEinzelPool(knex, pool);
        ergebnis.push({ pool, ...daten });
    }
    return ergebnis;
}

const imBereich = (platzbereich, platz) => platzbereich === 'alle' || (platz !== null && platz <= Number(platzbereich));

function sortiere(datensaetze, reihenfolge) {
    const platzWert = d => (d._platz === null ? Infinity : d._platz);
    return [...datensaetze].sort((a, b) => {
        const platz = reihenfolge === 'aufsteigend' ? platzWert(a) - platzWert(b) : platzWert(b) - platzWert(a);
        if (platz) return platz;
        return a._sortierung[0].localeCompare(b._sortierung[0], 'de') || a._sortierung[1].localeCompare(b._sortierung[1], 'de');
    });
}

function ohneIntern({ _platz, _sortierung, ...rest }) {
    return rest;
}

export async function ladeUrkundenDaten(knex, turnierId, { platzbereich, poolIds, reihenfolge }) {
    const pools = await ladePools(knex, turnierId, poolIds);
    return pools.flatMap(({ datensaetze }) =>
        sortiere(datensaetze.filter(d => imBereich(platzbereich, d._platz)), reihenfolge).map(ohneIntern));
}

export async function ladeUebersicht(knex, turnierId) {
    const pools = await ladePools(knex, turnierId, null);
    const alle = pools.flatMap(p => p.datensaetze);
    const laengster = feld => alle.reduce((best, d) => (d[feld].length > best.length ? d[feld] : best), '');
    const beispiel = alle.length === 0 ? BEISPIEL : {
        ...ohneIntern(alle[0]),
        Name: laengster('Name') || BEISPIEL.Name,
        Verein: laengster('Verein') || BEISPIEL.Verein,
        Platzierung: '1. Platz'
    };
    return {
        pools: pools.map(({ pool, abgeschlossen, datensaetze }) => ({
            id: pool.id,
            bezeichnung: pool.bezeichnung,
            typ: pool.typ === 'mannschaft' ? 'mannschaft' : 'einzel',
            status: pool.status,
            abgeschlossen,
            anzahl: Object.fromEntries(['3', '5', '7', 'alle'].map(b => [b, datensaetze.filter(d => imBereich(b, d._platz)).length]))
        })),
        beispiel
    };
}
