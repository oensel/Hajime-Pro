// Vereinsimport für Super-Admins: eine Liste „Name;Bundesland“ (CSV mit Semikolon, Tabulator oder Komma vor dem
// Bundesland; eine optionale Kopfzeile wird erkannt) wird erst ausgewertet (Vorschau) und danach angelegt. Das Bundesland
// ist Pflicht. Vorhandene Vereine (Schreibweise ohne Beachtung von Groß-/Kleinschreibung und Leerzeichen) und Wiederholungen
// in der Liste werden übersprungen, bestehende Vereine nie verändert.
import { findeBundesland } from '../shared/bundeslaender.js';
import { bereinigeVereinsname } from './vereinsVerwaltung.js';

export const MAX_IMPORT_ZEILEN = 2000;
export const MAX_IMPORT_ZEICHEN = 500_000;

const KOPF_NAMEN = new Set(['name', 'verein', 'vereinsname']);
const KOPF_LAENDER = new Set(['bundesland', 'land']);

// Trennt eine Zeile am letzten Trennzeichen (Semikolon, Tabulator, sonst Komma): Vereinsnamen enthalten gelegentlich
// Kommas („TSV Musterstadt, Abt. Judo“), das Bundesland steht immer hinten.
function teileZeile(zeile) {
    for (const trenner of [';', '\t', ',']) {
        const i = zeile.lastIndexOf(trenner);
        if (i !== -1) return [zeile.slice(0, i), zeile.slice(i + 1)];
    }
    return [zeile, ''];
}

const entferneAnfuehrung = (text) => text.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"').trim();
const schluesselVonName = (name) => name.toLowerCase();

/**
 * Zerlegt den Text in Zeilen mit Name und Bundesland. Rein, ohne Datenbank.
 * @returns {{ zeile: number, name: string|null, bundesland: string|null, fehler: string|null }[]}
 */
export function parseVereinsListe(text) {
    const zeilen = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
    const ergebnis = [];
    zeilen.forEach((roh, index) => {
        if (!roh.trim()) return;
        const [namensTeil, landTeil] = teileZeile(roh);
        const nameRoh = entferneAnfuehrung(namensTeil);
        const landRoh = entferneAnfuehrung(landTeil);
        if (ergebnis.length === 0 && KOPF_NAMEN.has(nameRoh.toLowerCase()) && KOPF_LAENDER.has(landRoh.toLowerCase())) return;
        const name = bereinigeVereinsname(nameRoh);
        const bundesland = findeBundesland(landRoh);
        let fehler = null;
        if (!name) fehler = 'Vereinsname fehlt oder ist zu lang.';
        else if (!landRoh) fehler = 'Bundesland fehlt (Pflichtangabe).';
        else if (!bundesland) fehler = `Unbekanntes Bundesland „${landRoh}“.`;
        ergebnis.push({ zeile: index + 1, name, bundesland, fehler });
    });
    return ergebnis;
}

/**
 * Bewertet die Liste gegen die vorhandenen Vereine.
 * status: 'neu' | 'vorhanden' | 'doppelt' | 'ungueltig'
 * @returns {Promise<{ ok: true, zeilen: object[], anzahl: Record<string, number> } | { ok: false, status: number, error: string }>}
 */
export async function bewerteVereinsImport(knex, text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, status: 400, error: 'Bitte eine Liste der Vereine angeben.' };
    if (text.length > MAX_IMPORT_ZEICHEN) return { ok: false, status: 400, error: 'Die Liste ist zu groß.' };
    const geparst = parseVereinsListe(text);
    if (geparst.length === 0) return { ok: false, status: 400, error: 'Die Liste enthält keine Vereine.' };
    if (geparst.length > MAX_IMPORT_ZEILEN) {
        return { ok: false, status: 400, error: `Die Liste ist zu lang (höchstens ${MAX_IMPORT_ZEILEN} Vereine je Import).` };
    }
    const vorhanden = new Set((await knex('vereine').select('name')).map((v) => schluesselVonName(v.name.replace(/\s+/g, ' ').trim())));
    const gesehen = new Set();
    const anzahl = { neu: 0, vorhanden: 0, doppelt: 0, ungueltig: 0 };
    const zeilen = geparst.map((z) => {
        let status;
        let grund = z.fehler;
        if (z.fehler) status = 'ungueltig';
        else {
            const schluessel = schluesselVonName(z.name);
            if (vorhanden.has(schluessel)) { status = 'vorhanden'; grund = 'Der Verein existiert bereits.'; }
            else if (gesehen.has(schluessel)) { status = 'doppelt'; grund = 'Der Verein steht mehrfach in der Liste.'; }
            else { status = 'neu'; gesehen.add(schluessel); }
        }
        anzahl[status] += 1;
        return { ...z, status, grund };
    });
    return { ok: true, zeilen, anzahl };
}

/**
 * Legt die neuen Vereine der Liste an (alles oder nichts). Ungültige Zeilen verhindern den Import nicht, sie werden
 * übersprungen und in der Antwort gezählt.
 * @returns {Promise<{ ok: true, angelegt: number, uebersprungen: number } | { ok: false, status: number, error: string }>}
 */
export async function importiereVereine(knex, text) {
    const bewertung = await bewerteVereinsImport(knex, text);
    if (!bewertung.ok) return bewertung;
    const neue = bewertung.zeilen.filter((z) => z.status === 'neu');
    try {
        await knex.transaction(async (trx) => {
            if (neue.length) await trx('vereine').insert(neue.map((z) => ({ name: z.name, bundesland: z.bundesland })));
        });
    } catch (err) {
        if (err && err.code === '23505') {
            return { ok: false, status: 409, error: 'Ein Verein wurde gleichzeitig angelegt. Es wurde nichts geändert; bitte erneut versuchen.' };
        }
        throw err;
    }
    return { ok: true, angelegt: neue.length, uebersprungen: bewertung.zeilen.length - neue.length };
}
