// Stammdaten des Ausrichters für Startgeld-Rechnungen (Tabelle vereins_abrechnung).
// Die IBAN liegt nur verschlüsselt in der Datenbank und verlässt den Service nie im Klartext,
// außer über ermittleZahlungsempfaenger (für Rechnung und Girocode).
import { FachFehler } from '../utils/fachFehler.js';
import { verschluesseleFeld, entschluesseleFeld } from '../utils/feldVerschluesselung.js';
import { pruefeIban, maskiereIban } from '../shared/iban.js';
import { STAMMDATEN_FELDER, fehlendeStammdaten, pruefePraefix } from '../shared/abrechnung.js';
import { istGueltigeEmail } from '../shared/zahlweg.js';

const TEXT_FELDER = [...STAMMDATEN_FELDER, 'steuernummer', 'ust_id', 'kontoinhaber'];
const MAX_LAENGE = {
    anschrift: 500, rechnung_email: 200, absender_name: 200, ust_hinweis: 1000,
    steuernummer: 50, ust_id: 50, kontoinhaber: 200
};

const leer = (w) => w == null || String(w).trim() === '';

function zuStammdaten(zeile) {
    if (!zeile) return null;
    const { iban_verschluesselt: verschluesselt, geaendert_von: _geaendertVon, ...rest } = zeile;
    return { ...rest, iban_vorhanden: !!verschluesselt, iban_maske: verschluesselt ? (zeile.iban_maske ?? null) : null };
}

export async function ladeStammdaten(knex, vereinId) {
    const zeile = await knex('vereins_abrechnung').where({ verein_id: vereinId }).first();
    return zuStammdaten(zeile);
}

export async function speichereStammdaten(knex, vereinId, eingabe, benutzerId) {
    const e = eingabe && typeof eingabe === 'object' ? eingabe : {};
    const werte = {};
    for (const feld of TEXT_FELDER) {
        if (!(feld in e)) continue;
        const roh = e[feld];
        const text = roh == null ? null : String(roh).trim();
        if (text && text.length > (MAX_LAENGE[feld] ?? 200)) {
            throw new FachFehler(400, `Eine Angabe ist zu lang (${feld}).`);
        }
        werte[feld] = text || null;
    }
    if (werte.rechnung_email && !istGueltigeEmail(werte.rechnung_email)) {
        throw new FachFehler(400, 'Bitte eine gültige Rechnungs-E-Mail-Adresse angeben.');
    }
    if ('rechnungs_praefix' in werte) {
        const fehler = pruefePraefix(werte.rechnungs_praefix);
        if (fehler) throw new FachFehler(400, fehler);
    }
    if (e.iban_loeschen === true) {
        werte.iban_verschluesselt = null;
        werte.iban_maske = null;
    } else if (!leer(e.iban)) {
        const pruefung = pruefeIban(e.iban);
        if (!pruefung.ok) throw new FachFehler(400, pruefung.fehler);
        werte.iban_verschluesselt = verschluesseleFeld(pruefung.iban); // 503 ohne Schlüssel
        werte.iban_maske = maskiereIban(pruefung.iban);
    }
    werte.geaendert_von = benutzerId ?? null;
    werte.updated_at = knex.fn.now();

    const vorhanden = await knex('vereins_abrechnung').where({ verein_id: vereinId }).first();
    if (vorhanden) {
        await knex('vereins_abrechnung').where({ verein_id: vereinId }).update(werte);
    } else {
        try {
            await knex('vereins_abrechnung').insert({ verein_id: vereinId, ...werte });
        } catch (err) {
            // paralleles Anlegen: die Zeile gibt es nun, also aktualisieren
            if (err?.code !== '23505') throw err;
            await knex('vereins_abrechnung').where({ verein_id: vereinId }).update(werte);
        }
    }
    return ladeStammdaten(knex, vereinId);
}

// E3: Turnierfelder iban/kontoinhaber haben Vorrang (wenn beide gefüllt), sonst das Vereinskonto.
export async function ermittleZahlungsempfaenger(knex, turnier) {
    if (!leer(turnier?.iban) && !leer(turnier?.kontoinhaber)) {
        return { kontoinhaber: String(turnier.kontoinhaber).trim(), iban: String(turnier.iban).replace(/\s+/g, '').toUpperCase(), quelle: 'turnier' };
    }
    if (!turnier?.verein_id) return null;
    const zeile = await knex('vereins_abrechnung').where({ verein_id: turnier.verein_id }).first();
    if (!zeile?.iban_verschluesselt || leer(zeile.kontoinhaber)) return null;
    return { kontoinhaber: zeile.kontoinhaber, iban: entschluesseleFeld(zeile.iban_verschluesselt), quelle: 'verein' };
}

export async function pruefeStammdatenFuerTurnier(knex, turnier) {
    const stammdaten = turnier?.verein_id ? await ladeStammdaten(knex, turnier.verein_id) : null;
    const fehlt = fehlendeStammdaten(stammdaten, turnier);
    return { vollstaendig: fehlt.length === 0, fehlt };
}
