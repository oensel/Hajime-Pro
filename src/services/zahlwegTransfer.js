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
        if (!z || typeof z !== 'object') continue;
        const name = textFeld(z.verein_name, MAX.verein_name, true);
        if (!name || gesehen.has(name) || ausrichter.has(name)) continue;
        if (!IMPORT_ZAHLWEGE.includes(z.zahlweg)) continue;
        const email = textFeld(z.rechnung_email, MAX.rechnung_email, false);
        const person = textFeld(z.rechnung_ansprechperson, MAX.rechnung_ansprechperson, false);
        const anschrift = textFeld(z.rechnung_anschrift, MAX.rechnung_anschrift, false);
        if (email === undefined || person === undefined || anschrift === undefined) continue;
        if (email !== null && !istGueltigeEmail(email)) continue;
        gesehen.add(name);
        zeilen.push({
            turnier_id: turnierId,
            verein_name: name,
            zahlweg: z.zahlweg,
            rechnung_email: email,
            rechnung_ansprechperson: person,
            rechnung_anschrift: anschrift,
            verein_id: null,
            geaendert_von: null
        });
    }
    if (zeilen.length) await trx('turnier_zahlwege').insert(zeilen);
    return zeilen.length;
}
