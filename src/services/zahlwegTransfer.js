import { istGueltigeEmail } from '../shared/zahlweg.js';

// Zahlwege im Turnier-Export/-Import (Cloud <-> Hallen-Server). Exportiert werden nur Namen und Rechnungsdaten,
// kein Benutzer- und kein Vereinsbezug (geaendert_von/verein_id). Das Flag startgeld_zahlweg_gesichert reist nicht mit,
// es wird nach dem Import mit synchronisiereGesichert neu abgeleitet.

export async function exportiereZahlwege(knex, turnierId) {
    const zeilen = await knex('turnier_zahlwege').where({ turnier_id: turnierId }).orderBy('id', 'asc');
    return zeilen.map((z) => ({
        verein_name: z.verein_name,
        zahlweg: z.zahlweg,
        rechnung_email: z.rechnung_email ?? null,
        rechnung_ansprechperson: z.rechnung_ansprechperson ?? null,
        rechnung_anschrift: z.rechnung_anschrift ?? null
    }));
}

const IMPORT_ZAHLWEGE = ['ueberweisung', 'bar'];
const MAX = { verein_name: 1000, rechnung_email: 255, rechnung_ansprechperson: 255, rechnung_anschrift: 1000 };

// Pflichtfeld bzw. optionales Textfeld aus einer Datei: getrimmter String (null bei fehlend), undefined = ungültig.
function textFeld(wert, max, pflicht) {
    if (wert === null || wert === undefined) return pflicht ? undefined : null;
    if (typeof wert !== 'string') return undefined;
    const t = wert.trim();
    if (!t) return pflicht ? undefined : null;
    return t.length > max ? undefined : t;
}

// Prüft eine Zahlweg-Zeile aus einer Datei und liefert die bereinigten Felder oder null (ungültig).
export function pruefeTransferZeile(z) {
    if (!z || typeof z !== 'object') return null;
    const name = textFeld(z.verein_name, MAX.verein_name, true);
    if (!name) return null;
    if (!IMPORT_ZAHLWEGE.includes(z.zahlweg)) return null;
    const email = textFeld(z.rechnung_email, MAX.rechnung_email, false);
    const person = textFeld(z.rechnung_ansprechperson, MAX.rechnung_ansprechperson, false);
    const anschrift = textFeld(z.rechnung_anschrift, MAX.rechnung_anschrift, false);
    if (email === undefined || person === undefined || anschrift === undefined) return null;
    if (email !== null && !istGueltigeEmail(email)) return null;
    return { verein_name: name, zahlweg: z.zahlweg, rechnung_email: email, rechnung_ansprechperson: person, rechnung_anschrift: anschrift };
}

// Ersetzt die Zahlwege des Turniers durch die der Datei. Fehlt der Abschnitt (ältere Dateien), bleibt alles unberührt.
// Zeilen aus der Datei sind unvertrauenswürdig: ungültige werden verworfen, importierte Zeilen tragen nie einen Benutzer
// (geaendert_von/verein_id bleiben NULL) und speisen deshalb die Vorbelegung anderer Vereine nicht.
export async function ersetzeZahlwege(trx, turnierId, zahlwege) {
    if (!Array.isArray(zahlwege)) return 0;
    await trx('turnier_zahlwege').where({ turnier_id: turnierId }).del();
    const turnier = await trx('turniere').where({ id: turnierId }).first('verein_id', 'ausrichter');
    const ausrichter = new Set();
    if (typeof turnier?.ausrichter === 'string' && turnier.ausrichter.trim()) ausrichter.add(turnier.ausrichter.trim());
    if (turnier?.verein_id != null) {
        const v = await trx('vereine').where({ id: turnier.verein_id }).first('name');
        if (v?.name) ausrichter.add(String(v.name).trim());
    }
    const zeilen = [];
    const gesehen = new Set();
    for (const z of zahlwege) {
        const geprueft = pruefeTransferZeile(z);
        if (!geprueft || gesehen.has(geprueft.verein_name) || ausrichter.has(geprueft.verein_name)) continue;
        gesehen.add(geprueft.verein_name);
        zeilen.push({ turnier_id: turnierId, ...geprueft, verein_id: null, geaendert_von: null });
    }
    if (zeilen.length) await trx('turnier_zahlwege').insert(zeilen);
    return zeilen.length;
}

// Kassenjournal (am Hallen-Server kassierte Barzahlungen) für den Rückweg in die Cloud.
export async function exportiereBarzahlungen(knex, turnierId) {
    const zeilen = await knex('turnier_barzahlungen').where({ turnier_id: turnierId }).orderBy('id', 'asc');
    return zeilen.map((b) => ({
        uid: b.uid,
        verein_name: b.verein_name,
        anzahl: b.anzahl,
        betrag_cent: b.betrag_cent,
        kassiert_am: b.kassiert_am instanceof Date ? b.kassiert_am.toISOString() : (b.kassiert_am ?? null)
    }));
}

const UID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Übernimmt Barzahlungen aus einer Datei (unvertrauenswürdig): ungültige Zeilen werden verworfen, bekannte uid ignoriert.
// Gibt die Zahl tatsächlich neu angelegter Zeilen zurück; fehlt der Abschnitt, bleibt alles unberührt.
export async function uebernehmeBarzahlungen(trx, turnierId, liste) {
    if (!Array.isArray(liste)) return 0;
    let neu = 0;
    for (const b of liste) {
        if (!b || typeof b !== 'object') continue;
        const name = textFeld(b.verein_name, MAX.verein_name, true);
        if (!name || typeof b.uid !== 'string' || !UID_MUSTER.test(b.uid)) continue;
        if (!Number.isInteger(b.anzahl) || b.anzahl < 1 || b.anzahl > 100000) continue;
        if (!Number.isInteger(b.betrag_cent) || b.betrag_cent < 0 || b.betrag_cent > 100000000) continue;
        const zeit = typeof b.kassiert_am === 'string' && !Number.isNaN(Date.parse(b.kassiert_am)) ? new Date(b.kassiert_am) : null;
        const zeile = { uid: b.uid.toLowerCase(), turnier_id: turnierId, verein_name: name, anzahl: b.anzahl, betrag_cent: b.betrag_cent };
        if (zeit) zeile.kassiert_am = zeit;
        const eingefuegt = await trx('turnier_barzahlungen').insert(zeile).onConflict('uid').ignore().returning('id');
        neu += eingefuegt.length;
    }
    return neu;
}
