// Turnierleitungs-Passwort (Schreibzugriff). Das Start-Passwort kommt aus STEUERUNG_PASSWORD (.env,
// vom Installationsskript erzeugt); bei der ersten Anmeldung wird eine Änderung erzwungen, das
// neue Passwort liegt gehasht (scrypt) in der Tabelle `steuerung_passwort` und löst das Start-
// Passwort ab. Die Middleware ist synchron und liest deshalb einen im Speicher gehaltenen Stand,
// der alle paar Sekunden aus der DB nachgeladen wird (Standby im Cluster, Änderung auf dem Master).
import crypto from 'crypto';

export const MIN_LAENGE = 8;
const NACHLADE_MS = 5000;

let zustand = { hash: null, sha256: null };
let knexRef = null;
let timer = null;

export function sha256Hex(text) {
    return crypto.createHash('sha256').update(String(text)).digest('hex');
}

export function hashePasswort(passwort) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(passwort), salt, 32);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function pruefeHash(passwort, gespeichert) {
    const teile = String(gespeichert || '').split('$');
    if (teile.length !== 3 || teile[0] !== 'scrypt') return false;
    const erwartet = Buffer.from(teile[2], 'base64');
    const berechnet = crypto.scryptSync(String(passwort), Buffer.from(teile[1], 'base64'), erwartet.length);
    return crypto.timingSafeEqual(erwartet, berechnet);
}

function gleich(a, b) {
    return crypto.timingSafeEqual(
        crypto.createHash('sha256').update(String(a)).digest(),
        crypto.createHash('sha256').update(String(b)).digest()
    );
}

async function lade() {
    if (!knexRef) return;
    try {
        const zeile = await knexRef('steuerung_passwort').where({ id: 1 }).first();
        zustand = zeile ? { hash: zeile.passwort_hash, sha256: zeile.passwort_sha256 } : { hash: null, sha256: null };
    } catch {
        // Tabelle noch nicht migriert oder DB kurz nicht erreichbar: letzten Stand behalten.
    }
}

export async function initialisiere(knex) {
    knexRef = knex;
    await lade();
    if (!timer) {
        timer = setInterval(lade, NACHLADE_MS);
        if (timer.unref) timer.unref();
    }
}

/** Stand sofort aus der DB holen (statt auf das nächste Nachladen zu warten). */
export async function ladeJetzt() {
    await lade();
}

function startPasswort() {
    return process.env.STEUERUNG_PASSWORD || '';
}

/** Ist überhaupt ein Passwort für den Schreibzugriff eingerichtet? */
export function istGesetzt() {
    return !!(zustand.hash || startPasswort());
}

/** Gilt noch das vom Installationsskript erzeugte Start-Passwort (Änderung ausstehend)? */
export function istStartPasswort() {
    return !zustand.hash && !!startPasswort();
}

export function pruefe(eingabe) {
    if (eingabe === undefined || eingabe === null || eingabe === '') return false;
    if (zustand.hash) return pruefeHash(eingabe, zustand.hash);
    const start = startPasswort();
    return !!start && gleich(eingabe, start);
}

/** SHA-256 des gültigen Passworts für das Konfig-Dokument der Client-Geräte (oder null). */
export function sha256Aktuell() {
    if (zustand.hash) return zustand.sha256;
    const start = startPasswort();
    return start ? sha256Hex(start) : null;
}

/** Fehlertext, wenn das neue Passwort nicht zulässig ist, sonst null. */
export function pruefeNeuesPasswort(neu) {
    if (typeof neu !== 'string' || neu.trim() !== neu || neu.length < MIN_LAENGE) {
        return `Das neue Passwort braucht mindestens ${MIN_LAENGE} Zeichen ohne Leerzeichen am Anfang oder Ende.`;
    }
    if (pruefe(neu)) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.';
    return null;
}

export async function aendere(neu) {
    const fehler = pruefeNeuesPasswort(neu);
    if (fehler) {
        const e = new Error(fehler);
        e.status = 400;
        throw e;
    }
    if (!knexRef) throw new Error('Passwortspeicher nicht initialisiert.');
    const zeile = { id: 1, passwort_hash: hashePasswort(neu), passwort_sha256: sha256Hex(neu), geaendert_am: knexRef.fn.now() };
    await knexRef('steuerung_passwort').insert(zeile).onConflict('id').merge();
    zustand = { hash: zeile.passwort_hash, sha256: zeile.passwort_sha256 };
}
