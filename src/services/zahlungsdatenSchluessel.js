// Schlüsselverwaltung für verschlüsselte Zahlungsdaten (Startgeld Stufe 3): Bestandsaufnahme je Schlüsselkennung (kid)
// und Umschlüsseln auf den aktuellen Schlüssel. Gibt nie Klartext oder Schlüsselmaterial aus (nur Zählungen).
import { entschluesseleFeld, verschluesseleFeld, schluesselKennung } from '../utils/feldVerschluesselung.js';

// Alle verschlüsselten Spalten: Tabelle, Primärschlüsselspalte, Spalte.
const SPALTEN = [
    { tabelle: 'vereins_abrechnung', schluessel: 'verein_id', spalte: 'iban_verschluesselt', zaehler: 'vereinsKonten' },
    { tabelle: 'lastschrift_mandate', schluessel: 'id', spalte: 'daten_verschluesselt', zaehler: 'mandate' }
];

const kidVon = (text) => {
    const teile = String(text ?? '').split(':');
    return teile.length === 5 && teile[0] === 'z1' ? teile[1] : null;
};

/** Zählt die Chiffretexte je kid und die nicht entschlüsselbaren (mit dem Schlüssel aus `env`). */
export async function pruefeSchluessel(knex, env = process.env) {
    const nachKid = {};
    let gesamt = 0;
    let nichtEntschluesselbar = 0;
    for (const { tabelle, spalte } of SPALTEN) {
        const zeilen = await knex(tabelle).whereNotNull(spalte).select(spalte);
        for (const zeile of zeilen) {
            gesamt += 1;
            const kid = kidVon(zeile[spalte]);
            nachKid[kid ?? 'unbekannt'] = (nachKid[kid ?? 'unbekannt'] || 0) + 1;
            try {
                entschluesseleFeld(zeile[spalte], env);
            } catch {
                nichtEntschluesselbar += 1;
            }
        }
    }
    return { gesamt, nachKid, nichtEntschluesselbar, kennung: schluesselKennung(env) };
}

/**
 * Schlüsselt alle Chiffretexte, die nicht unter der aktuellen kid stehen, auf den aktuellen Schlüssel um
 * (entschlüsseln mit dem passenden Schlüssel, neu verschlüsseln mit ZAHLUNGSDATEN_SCHLUESSEL). Alles in EINER
 * Transaktion: ein Fehler lässt den Bestand unverändert. Idempotent. Liefert nur Zählungen.
 * @returns {Promise<{ vereinsKonten: number, mandate: number }>}
 */
export async function schluesseleUm(knex, env = process.env) {
    const kennung = schluesselKennung(env);
    if (!kennung.aktuell) throw new Error('ZAHLUNGSDATEN_SCHLUESSEL fehlt oder ist zu kurz.');
    return knex.transaction(async (trx) => {
        const ergebnis = { vereinsKonten: 0, mandate: 0 };
        const zuAendern = [];
        for (const def of SPALTEN) {
            const zeilen = await trx(def.tabelle).whereNotNull(def.spalte).select(def.schluessel, def.spalte).forUpdate();
            for (const zeile of zeilen) {
                if (kidVon(zeile[def.spalte]) !== kennung.aktuell) zuAendern.push({ def, zeile });
            }
        }
        if (zuAendern.length > 0 && !kennung.alt) {
            throw new Error('Es gibt Chiffretexte unter einem anderen Schlüssel: ZAHLUNGSDATEN_SCHLUESSEL_ALT muss den bisherigen Schlüssel enthalten.');
        }
        for (const { def, zeile } of zuAendern) {
            let neu;
            try {
                const klartext = entschluesseleFeld(zeile[def.spalte], env);
                neu = verschluesseleFeld(klartext, env);
                if (entschluesseleFeld(neu, env) !== klartext) throw new Error('Gegenprobe');
            } catch {
                throw new Error(`Eintrag ${def.tabelle} ${zeile[def.schluessel]} ist mit den vorhandenen Schlüsseln nicht lesbar; nichts wurde geändert.`);
            }
            await trx(def.tabelle).where({ [def.schluessel]: zeile[def.schluessel] }).update({ [def.spalte]: neu });
            ergebnis[def.zaehler] += 1;
        }
        return ergebnis;
    });
}
