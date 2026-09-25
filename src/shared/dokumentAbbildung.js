/**
 * Reine Abbildung zwischen Zeilen der relationalen Live-Tabellen und Dokumenten der Sync-DB
 * (CouchDB-Umbau). Server- und clientseitig identisch nutzbar — keine Abhängigkeit von knex/DOM.
 *
 * Grundregel: ein Dokument spiegelt genau eine Tabellenzeile, Feldnamen = Spaltennamen, damit
 * die übrige src/shared/-Logik (kampfProgression.js, pausenRegel.js, mattenAnsicht.js) Dokumente
 * und DB-Zeilen gleich verarbeiten kann. Zusätzlich gibt es Felder, die NUR im Dokument
 * existieren (Absichten der Matte/Waage und Rückmeldungen der Brücke) — sie überleben jeden
 * Abgleich mit dem Server-Stand.
 *
 * Jedes Dokument trägt seinen Typ in `dokumenttyp` (kampf, pool, teilnehmer, ...), nicht in `typ` —
 * das ist eine echte Spalte von pools.
 */

export const LIVE_TABELLEN = {
    kampfflaechen: 'kampfflaeche',
    pools: 'pool',
    turnier_teilnehmer: 'teilnehmer',
    kaempfe: 'kampf',
    mannschaften: 'mannschaft',
    mannschaftskaempfe: 'mannschaftskampf'
};

export const LIVE_PRAEFIXE = Object.values(LIVE_TABELLEN).map(typ => `${typ}:`);

// Absichten, die mit der Übernahme durch den Server erledigt sind und danach entfernt werden.
const ERLEDIGTE_ABSICHTEN = ['forfeit_teilnehmer_id', 'forfeit_art'];

export function dokumentIdFuer(tabelle, zeile) {
    if (tabelle === 'turnier_teilnehmer' && zeile.dokument_id) return zeile.dokument_id;
    return `${LIVE_TABELLEN[tabelle]}:${zeile.id}`;
}

function normalisiere(wert) {
    if (wert instanceof Date) return wert.toISOString();
    if (wert === undefined) return null;
    return wert;
}

// Vergleichswert, der die Darstellungsunterschiede zwischen SQLite (1/0, Zahlen) und PostgreSQL
// (true/false, DECIMAL als String "60.00") sowie Date-Objekten glättet.
function vergleichswert(wert) {
    const w = normalisiere(wert);
    if (w === null) return null;
    if (typeof w === 'boolean') return w ? 1 : 0;
    if (typeof w === 'string' && /^-?\d+(\.\d+)?$/.test(w)) return Number(w);
    return w;
}

export function gleicheWerte(a, b) {
    return JSON.stringify(vergleichswert(a)) === JSON.stringify(vergleichswert(b));
}

function spaltenFelder(tabelle, zeile) {
    const felder = {};
    for (const [spalte, wert] of Object.entries(zeile)) felder[spalte] = normalisiere(wert);
    // Nach den Spalten setzen: der Dokumenttyp heißt bewusst NICHT "typ", weil pools eine
    // gleichnamige Spalte (einzel/mannschaft) hat.
    felder.dokumenttyp = LIVE_TABELLEN[tabelle];
    felder.sql_id = zeile.id;
    return felder;
}

export function mitServerStand(bestehendesDokument, tabelle, zeile) {
    const neu = {
        ...(bestehendesDokument || {}),
        ...spaltenFelder(tabelle, zeile),
        _id: dokumentIdFuer(tabelle, zeile),
        bearbeitet_von: 'server'
    };
    if (bestehendesDokument && bestehendesDokument._rev) neu._rev = bestehendesDokument._rev;
    delete neu._conflicts;
    for (const feld of ERLEDIGTE_ABSICHTEN) delete neu[feld];
    return neu;
}

export function unterscheidetSichVomServerStand(dokument, tabelle, zeile) {
    if (!dokument) return true;
    if (dokument.bearbeitet_von !== 'server') return true;
    const soll = spaltenFelder(tabelle, zeile);
    return Object.keys(soll).some(feld => !gleicheWerte(dokument[feld], soll[feld]));
}

export function geaenderteFelder(dokument, zeile, felder) {
    const diff = {};
    for (const feld of felder) {
        if (!gleicheWerte(dokument[feld], zeile[feld])) diff[feld] = dokument[feld];
    }
    return diff;
}
