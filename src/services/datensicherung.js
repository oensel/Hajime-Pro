// Komplettsicherung der Datenbank als Datei (Super-Admin, Cloud) und ihr Wiedereinspielen. Läuft ohne pg_dump: PostgreSQL liefert
// jede Tabelle selbst als JSON (jsonb_agg) und nimmt sie mit jsonb_populate_recordset wieder an; Datums-, Zeit-, bytea- und
// jsonb-Spalten bleiben damit ohne eigene Umwandlung exakt erhalten.
//
// Mit gesetztem SICHERUNG_PASSWORT ist jede Sicherung zusätzlich verschlüsselt (.hajime-sicherung.gz.enc, AES-256-GCM, siehe
// sicherungsVerschluesselung.js): gzip → Verschlüsselung → Datei. Das Wiederherstellen erkennt beide Arten an den ersten Bytes.
//
// Dateiformat (.hajime-sicherung.gz, gzip, eine JSON-Zeile je Eintrag):
//   {"format":"hajime-sicherung","version":1,"erstellt":…,"migrationen":[…],"tabellen":[…]}
//   {"t":"<Tabelle>","r":[{…},…]}            (je höchstens 500 Zeilen, Tabellen in Fremdschlüssel-Reihenfolge, Eltern zuerst)
//   {"ende":true,"zeilen":{"<Tabelle>":<Anzahl>,…}}   (fehlt er oder stimmt die Zählung nicht, wird nichts eingespielt)
// Die Sicherung ist ein konsistenter Schnappschuss (eine Transaktion). Wiederherstellen ersetzt alle Daten in einer
// Transaktion (bei jedem Fehler bleibt der alte Stand) und verlangt denselben Schema-Stand (gleiche Migrationen).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import {
    leseSicherungsPasswort, erzeugeVerschluesselung, erzeugeEntschluesselung, istVerschluesselt, MAGIC, EntschluesselungsFehler
} from './sicherungsVerschluesselung.js';

export const FORMAT = 'hajime-sicherung';
export const VERSION = 1;
export const ENDUNG = '.hajime-sicherung.gz';
export const ENDUNG_VERSCHLUESSELT = '.hajime-sicherung.gz.enc';
const ENDUNG_MUSTER = /-\d{8}-\d{6}\.hajime-sicherung\.gz(\.enc)?$/;
/** Dateiendung einer neuen Sicherung: verschlüsselt, wenn ein Passwort eingestellt ist. */
export const endungFuer = (passwort) => (passwort ? ENDUNG_VERSCHLUESSELT : ENDUNG);
const AUSGENOMMEN = new Set(['knex_migrations', 'knex_migrations_lock']);
const ZEILEN_JE_BLOCK = 500;
// Aufbewahrung je Dateityp (Vorsilbe des Namens): von Hand abgelegte, automatische (siehe sicherungsPlaner.js) und vor dem Wiederherstellen
const BEHALTEN_STANDARD = { sicherung: 30, 'auto-sicherung': 14, 'vor-wiederherstellung': 10 };

export class SicherungsFehler extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

let laeuftGerade = false;
/** Nur eine Sicherung/Wiederherstellung gleichzeitig. */
async function exklusiv(aufgabe) {
    if (laeuftGerade) throw new SicherungsFehler('Es läuft bereits eine Sicherung oder Wiederherstellung.', 409);
    laeuftGerade = true;
    try {
        return await aufgabe();
    } finally {
        laeuftGerade = false;
    }
}

export function sicherungsVerzeichnis(env = process.env) {
    return path.resolve(env.SICHERUNG_VERZEICHNIS || './data/sicherungen');
}

// --- Schema lesen ---
async function ladeTabellenNamen(k) {
    const r = await k.raw(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`);
    return r.rows.map((z) => z.table_name).filter((n) => !AUSGENOMMEN.has(n));
}

async function ladeMigrationen(k) {
    const r = await k.raw('SELECT name FROM knex_migrations ORDER BY id');
    return r.rows.map((z) => z.name);
}

/** Tabellen so ordnen, dass Eltern vor ihren Kindern stehen (Reste bei Zyklen alphabetisch hinten). */
export async function sortiereNachFremdschluesseln(k, tabellen) {
    const r = await k.raw(`
        SELECT c.relname AS kind, p.relname AS eltern
        FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid JOIN pg_class p ON p.oid = x.confrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE x.contype = 'f' AND n.nspname = current_schema()`);
    const menge = new Set(tabellen);
    const eltern = new Map(tabellen.map((t) => [t, new Set()]));
    for (const { kind, eltern: e } of r.rows) if (kind !== e && menge.has(kind) && menge.has(e)) eltern.get(kind).add(e);
    const ergebnis = [];
    const fertig = new Set();
    let offen = [...tabellen];
    while (offen.length) {
        const bereit = offen.filter((t) => [...eltern.get(t)].every((e) => fertig.has(e)));
        if (bereit.length === 0) { ergebnis.push(...offen); break; }
        for (const t of bereit) { ergebnis.push(t); fertig.add(t); }
        offen = offen.filter((t) => !fertig.has(t));
    }
    return ergebnis;
}

// --- Sichern ---
async function* erzeugeZeilen(trx) {
    const tabellen = await sortiereNachFremdschluesseln(trx, await ladeTabellenNamen(trx));
    yield `${JSON.stringify({ format: FORMAT, version: VERSION, erstellt: new Date().toISOString(), migrationen: await ladeMigrationen(trx), tabellen })}\n`;
    const zaehlung = {};
    for (const tabelle of tabellen) {
        // Blockweise über einen Cursor lesen (konstanter Speicherbedarf auch bei großen Tabellen); PostgreSQL liefert jede Zeile als JSON
        await trx.raw('DECLARE sicherung_cursor NO SCROLL CURSOR FOR SELECT to_jsonb(t) AS r FROM ?? t', [tabelle]);
        let anzahl = 0;
        for (;;) {
            const block = (await trx.raw(`FETCH FORWARD ${ZEILEN_JE_BLOCK} FROM sicherung_cursor`)).rows.map((z) => z.r);
            if (block.length === 0) break;
            anzahl += block.length;
            yield `${JSON.stringify({ t: tabelle, r: block })}\n`;
        }
        await trx.raw('CLOSE sicherung_cursor');
        zaehlung[tabelle] = anzahl;
        if (anzahl === 0) yield `${JSON.stringify({ t: tabelle, r: [] })}\n`;
    }
    yield `${JSON.stringify({ ende: true, zeilen: zaehlung })}\n`;
}

/**
 * Schreibt die Sicherung (gzip, mit Passwort zusätzlich verschlüsselt) in einen beschreibbaren Stream. `ohneSperre`: nur für die Vorab-Sicherung
 * beim Wiederherstellen. `passwort`: Standard ist das eingestellte Sicherungspasswort (null = unverschlüsselt).
 */
export async function schreibeSicherung(knex, ziel, { ohneSperre = false, passwort = leseSicherungsPasswort() } = {}) {
    const lauf = () => knex.transaction(
        (trx) => pipeline(Readable.from(erzeugeZeilen(trx)), zlib.createGzip(), ...(passwort ? [erzeugeVerschluesselung(passwort)] : []), ziel),
        { isolationLevel: 'repeatable read', readOnly: true }
    );
    await (ohneSperre ? lauf() : exklusiv(lauf));
}

const zeitstempel = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

export function pruefeDateiname(name) {
    return typeof name === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(name) && (name.endsWith(ENDUNG) || name.endsWith(ENDUNG_VERSCHLUESSELT)) && !name.includes('..');
}

/** Legt eine Sicherung im Verzeichnis ab (erst als .teil, dann umbenannt). */
export async function schreibeSicherungsdatei(knex, verzeichnis, praefix = 'sicherung', { ohneSperre = false, behalte = {}, passwort = leseSicherungsPasswort() } = {}) {
    // Die Dateien enthalten Personendaten und Passwort-Prüfwerte: nur der Besitzer darf lesen (unter Windows ohne Wirkung).
    await fs.promises.mkdir(verzeichnis, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(verzeichnis, 0o700).catch(() => {});
    const name = `${praefix}-${zeitstempel()}${endungFuer(passwort)}`;
    const pfad = path.join(verzeichnis, name);
    try {
        await schreibeSicherung(knex, fs.createWriteStream(`${pfad}.teil`, { mode: 0o600 }), { ohneSperre, passwort });
        await fs.promises.rename(`${pfad}.teil`, pfad);
    } catch (err) {
        await fs.promises.rm(`${pfad}.teil`, { force: true });
        throw err;
    }
    await bereinigeAlte(verzeichnis, { ...BEHALTEN_STANDARD, ...behalte });
    return { name, pfad, groesse: (await fs.promises.stat(pfad)).size, verschluesselt: !!passwort };
}

export async function listeSicherungsdateien(verzeichnis) {
    let namen;
    try {
        namen = await fs.promises.readdir(verzeichnis);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const dateien = [];
    for (const name of namen.filter(pruefeDateiname)) {
        const s = await fs.promises.stat(path.join(verzeichnis, name));
        dateien.push({ name, groesse: s.size, erstellt: s.mtime.toISOString(), verschluesselt: name.endsWith(ENDUNG_VERSCHLUESSELT) });
    }
    return dateien.sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

export async function loescheSicherungsdatei(verzeichnis, name) {
    if (!pruefeDateiname(name)) throw new SicherungsFehler('Ungültiger Dateiname.');
    try {
        await fs.promises.unlink(path.join(verzeichnis, name));
    } catch (err) {
        if (err.code === 'ENOENT') throw new SicherungsFehler('Die Sicherung gibt es nicht.', 404);
        throw err;
    }
}

/** Löscht je Vorsilbe (Namensanfang bis zum Zeitstempel) die ältesten Dateien über der erlaubten Anzahl. */
async function bereinigeAlte(verzeichnis, behalte = BEHALTEN_STANDARD) {
    const jePraefix = new Map();
    for (const datei of await listeSicherungsdateien(verzeichnis)) { // neueste zuerst
        const praefix = datei.name.replace(ENDUNG_MUSTER, '');
        const liste = jePraefix.get(praefix) || [];
        liste.push(datei);
        jePraefix.set(praefix, liste);
    }
    for (const [praefix, dateien] of jePraefix) {
        const grenze = behalte[praefix];
        if (!Number.isInteger(grenze)) continue; // unbekannte Dateien bleiben unberührt
        for (const datei of dateien.slice(grenze)) await fs.promises.rm(path.join(verzeichnis, datei.name), { force: true });
    }
}

// --- Wiederherstellen ---
/**
 * Liest die ersten Bytes, erkennt verschlüsselt/unverschlüsselt und liefert den entpackten Klartext-Strom. Eine verschlüsselte Sicherung
 * braucht das Passwort (Standard: das eingestellte); Fehler (falsches Passwort, Veränderung, Abbruch) kommen als Fehler des Stroms.
 */
async function oeffneKlartext(quelle, passwort) {
    // Über pipe statt über einen Iterator lesen: bricht die Verarbeitung ab, bleibt `quelle` ein normaler pausierter Strom, den der Aufrufer mit
    // resume() leerlesen kann (ein Iterator würde das blockieren).
    const eingang = new PassThrough();
    quelle.on('error', (err) => eingang.destroy(err));
    quelle.pipe(eingang);
    const kopf = await new Promise((resolve, reject) => {
        const weg = () => { eingang.off('readable', versuche); eingang.off('end', ende); eingang.off('error', fehler); };
        const versuche = () => {
            const bytes = eingang.read(MAGIC.length);
            if (bytes !== null) { weg(); eingang.unshift(bytes); resolve(bytes); }
        };
        const ende = () => { weg(); resolve(Buffer.alloc(0)); };
        const fehler = (err) => { weg(); reject(err); };
        eingang.on('readable', versuche);
        eingang.once('end', ende);
        eingang.once('error', fehler);
        versuche();
    });
    const gunzip = zlib.createGunzip();
    // Ist die Verarbeitung zu Ende oder abgebrochen, wird die Quelle vom Zwischenspeicher gelöst (sonst pausiert dessen voller Puffer sie für immer)
    const loese = () => { quelle.unpipe(eingang); eingang.destroy(); };
    gunzip.once('close', loese);
    if (istVerschluesselt(kopf)) {
        if (!passwort) {
            loese();
            throw new SicherungsFehler('Die Sicherung ist verschlüsselt, aber es ist kein Passwort eingestellt (SICHERUNG_PASSWORT).');
        }
        const entschluesselt = erzeugeEntschluesselung(passwort);
        eingang.on('error', (err) => entschluesselt.destroy(err));
        entschluesselt.on('error', (err) => gunzip.destroy(err));
        eingang.pipe(entschluesselt).pipe(gunzip);
    } else {
        eingang.on('error', (err) => gunzip.destroy(err));
        eingang.pipe(gunzip);
    }
    return gunzip;
}

const uebersetzeFehler = (err) => {
    if (err instanceof EntschluesselungsFehler) return new SicherungsFehler(err.message, 400);
    if (err && (err.code === 'Z_DATA_ERROR' || err.code === 'Z_BUF_ERROR' || /incorrect header check|unexpected end of file/i.test(String(err.message)))) {
        return new SicherungsFehler('Die Datei ist keine gültige oder vollständige Sicherung.');
    }
    return err;
};

/**
 * Prüft eine Sicherungsdatei ohne Datenbank: Entschlüsseln, Entpacken, Aufbau und Zählung. Nützlich für Kopien an anderen Orten.
 * @returns {Promise<{ verschluesselt: boolean, erstellt: string, migrationen: number, tabellen: number, zeilen: number }>}
 */
export async function pruefeSicherung(quelle, { passwort = leseSicherungsPasswort() } = {}) {
    let gunzip;
    try {
        gunzip = await oeffneKlartext(quelle, passwort);
        const zeilen = zeilenVon(gunzip);
        const erste = await zeilen.next();
        let kopf;
        try { kopf = JSON.parse(erste.value); } catch { throw new SicherungsFehler('Das ist keine Hajime-Pro-Sicherung.'); }
        if (!kopf || kopf.format !== FORMAT) throw new SicherungsFehler('Das ist keine Hajime-Pro-Sicherung.');
        const gezaehlt = {};
        let ende = null;
        for await (const zeile of zeilen) {
            let eintrag;
            try { eintrag = JSON.parse(zeile); } catch { throw new SicherungsFehler('Die Sicherungsdatei ist beschädigt.'); }
            if (eintrag.ende) { ende = eintrag; continue; }
            if (!kopf.tabellen.includes(eintrag.t) || !Array.isArray(eintrag.r)) throw new SicherungsFehler('Die Sicherungsdatei ist beschädigt.');
            gezaehlt[eintrag.t] = (gezaehlt[eintrag.t] || 0) + eintrag.r.length;
        }
        if (!ende) throw new SicherungsFehler('Die Sicherungsdatei ist unvollständig.');
        for (const tabelle of kopf.tabellen) {
            if ((gezaehlt[tabelle] || 0) !== (ende.zeilen[tabelle] || 0)) throw new SicherungsFehler('Die Sicherungsdatei ist unvollständig oder beschädigt.');
        }
        return {
            verschluesselt: !!(await istVerschluesseltDatei(quelle)), erstellt: kopf.erstellt, migrationen: kopf.migrationen.length,
            tabellen: kopf.tabellen.length, zeilen: Object.values(gezaehlt).reduce((a, b) => a + b, 0)
        };
    } catch (err) {
        gunzip?.destroy();
        throw uebersetzeFehler(err);
    }
}
// Wurde aus einer Datei gelesen, steht in quelle.path der Pfad; nur dort lässt sich die Art nachträglich feststellen.
async function istVerschluesseltDatei(quelle) {
    if (!quelle.path) return null;
    const handle = await fs.promises.open(quelle.path, 'r');
    try {
        const kopf = Buffer.alloc(MAGIC.length);
        await handle.read(kopf, 0, MAGIC.length, 0);
        return istVerschluesselt(kopf);
    } finally { await handle.close(); }
}

async function* zeilenVon(stream) {
    let rest = '';
    for await (const stueck of stream) {
        rest += stueck.toString('utf8');
        let i;
        while ((i = rest.indexOf('\n')) !== -1) {
            const zeile = rest.slice(0, i);
            rest = rest.slice(i + 1);
            if (zeile.trim()) yield zeile;
        }
    }
    if (rest.trim()) yield rest;
}

async function setzeSequenzenNach(trx, tabellen) {
    const r = await trx.raw(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`);
    const menge = new Set(tabellen);
    for (const { table_name: tabelle, column_name: spalte } of r.rows) {
        if (!menge.has(tabelle)) continue;
        await trx.raw(
            'SELECT setval(pg_get_serial_sequence(?, ?), COALESCE((SELECT MAX(??) FROM ??), 0) + 1, false)',
            [`"${tabelle}"`, spalte, spalte, tabelle]
        );
    }
}

/**
 * Spielt eine Sicherung (gzip-Stream) ein und ersetzt dabei alle Daten. `vorher` läuft nach der Kopfprüfung und vor dem
 * Ersetzen (z. B. Sicherung des aktuellen Stands); wirft es, bleibt alles unverändert. `fremdschluesselPruefen` lässt die
 * Fremdschlüssel aktiv (der Weg ohne Superuser-Rechte; hier für Tests erzwingbar).
 * @returns {Promise<{ tabellen: number, zeilen: number }>}
 */
export async function stelleWiederHer(knex, quelle, { vorher = null, fremdschluesselPruefen = false, passwort = leseSicherungsPasswort() } = {}) {
    return exklusiv(async () => {
        let gunzip;
        try {
            gunzip = await oeffneKlartext(quelle, passwort);
            const zeilen = zeilenVon(gunzip);
            const kopfZeile = await zeilen.next();
            let kopf;
            try {
                kopf = JSON.parse(kopfZeile.value);
            } catch {
                throw new SicherungsFehler('Das ist keine Hajime-Pro-Sicherung.');
            }
            if (!kopf || kopf.format !== FORMAT) throw new SicherungsFehler('Das ist keine Hajime-Pro-Sicherung.');
            if (kopf.version !== VERSION) throw new SicherungsFehler(`Nicht unterstützte Version der Sicherung (${kopf.version}).`);
            const aktuell = await ladeMigrationen(knex);
            if (JSON.stringify(kopf.migrationen) !== JSON.stringify(aktuell)) {
                const letzteDatei = kopf.migrationen[kopf.migrationen.length - 1];
                throw new SicherungsFehler(
                    `Die Sicherung stammt von einem anderen Datenbank-Stand (letzte Migration ${letzteDatei}, hier ${aktuell[aktuell.length - 1]}). `
                    + 'Bitte zuerst dieselbe Programmversion einspielen.', 409);
            }
            const vorhandene = await ladeTabellenNamen(knex);
            const fehlend = kopf.tabellen.filter((t) => !vorhandene.includes(t));
            if (fehlend.length) throw new SicherungsFehler(`Tabellen fehlen in der Datenbank: ${fehlend.join(', ')}.`, 409);

            if (vorher) await vorher();

            return await knex.transaction(async (trx) => {
                // Ohne Superuser-Rechte (z. B. Supabase) bleibt es bei den Fremdschlüsseln: die Datei steht in Eltern-zuerst-Reihenfolge.
                if (!fremdschluesselPruefen) {
                    try {
                        await trx.transaction((sp) => sp.raw("SET LOCAL session_replication_role = 'replica'"));
                    } catch { /* Fremdschlüssel bleiben aktiv */ }
                }
                await trx.raw(`TRUNCATE TABLE ${vorhandene.map(() => '??').join(', ')} RESTART IDENTITY CASCADE`, vorhandene);

                const gezaehlt = {};
                let ende = null;
                for await (const zeile of zeilen) {
                    let eintrag;
                    try {
                        eintrag = JSON.parse(zeile);
                    } catch {
                        throw new SicherungsFehler('Die Sicherungsdatei ist beschädigt.');
                    }
                    if (eintrag.ende) { ende = eintrag; continue; }
                    if (!kopf.tabellen.includes(eintrag.t) || !Array.isArray(eintrag.r)) throw new SicherungsFehler('Die Sicherungsdatei ist beschädigt.');
                    gezaehlt[eintrag.t] = (gezaehlt[eintrag.t] || 0) + eintrag.r.length;
                    if (eintrag.r.length) {
                        await trx.raw('INSERT INTO ?? SELECT * FROM jsonb_populate_recordset(NULL::??, ?::jsonb)', [eintrag.t, eintrag.t, JSON.stringify(eintrag.r)]);
                    }
                }
                if (!ende) throw new SicherungsFehler('Die Sicherungsdatei ist unvollständig.');
                for (const tabelle of kopf.tabellen) {
                    if ((gezaehlt[tabelle] || 0) !== (ende.zeilen[tabelle] || 0)) throw new SicherungsFehler('Die Sicherungsdatei ist unvollständig oder beschädigt.');
                }
                await setzeSequenzenNach(trx, kopf.tabellen);
                return { tabellen: kopf.tabellen.length, zeilen: Object.values(gezaehlt).reduce((a, b) => a + b, 0) };
            });
        } catch (err) {
            gunzip?.destroy();
            if (quelle instanceof fs.ReadStream) quelle.destroy(); // eine hochgeladene Anfrage bleibt offen, damit die Antwort noch ausgeliefert wird
            if (err && err.code === '23503') throw new SicherungsFehler('Die Fremdschlüssel der Sicherung passen nicht zusammen. Es wurde nichts geändert.', 409);
            throw uebersetzeFehler(err);
        }
    });
}
