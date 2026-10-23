// Zugangscode der Teilnehmer-App: ohne ihn liefert die Cloud keine Turnierdaten (Spec docs/specs/2026-10-24-teilnehmer-app-zugang.md).
// Der Veranstalter hängt in der Halle einen QR-Code aus; er enthält die Adresse der App mit dem Code (`/live/#z=<Code>`, hinter dem # also nie in
// Server- oder Proxy-Protokollen). Die App tauscht den Code gegen das Turnier ein, merkt ihn sich im Gerät und schickt ihn bei jeder Abfrage mit.
//   - ein Code je Turnier, 128 Bit zufällig, gilt nur für dieses Turnier
//   - gültig ab der Erzeugung bis zum Ende des Turniertags (06:00 Uhr Berliner Zeit des Folgetags), danach „abgelaufen“
//   - jederzeit erneuerbar (der alte Code ist sofort ungültig) oder sperrbar; Freigabe zurückgenommen = ungültig
// Ein weitergeleitetes Foto des Aushangs funktioniert bis zum Ablauf oder Erneuern: „nur in der Halle“ erzwingt das nicht, begrenzt aber Reichweite
// und Dauer.
import crypto from 'node:crypto';

export const CODE_MUSTER = /^[A-Za-z0-9_-]{22}$/;
const sha = (text) => crypto.createHash('sha256').update(String(text)).digest();

export const erzeugeCode = () => crypto.randomBytes(16).toString('base64url');

// --- Ende des Turniertags (Europe/Berlin) ---
function berlinVersatzMs(zeitMs) {
    const teile = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(zeitMs)).map((t) => [t.type, t.value]));
    return Date.UTC(teile.year, teile.month - 1, teile.day, teile.hour, teile.minute, teile.second) - Math.floor(zeitMs / 1000) * 1000;
}

/** Der Zeitpunkt, an dem in Berlin am Tag nach `datum` (JJJJ-MM-TT) 06:00 Uhr ist; null bei ungültigem Datum. */
export function endeDesTurniertags(datum) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(datum ?? ''));
    if (!m) return null;
    const lokal = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 6, 0, 0);
    let zeit = lokal - berlinVersatzMs(lokal);
    zeit = lokal - berlinVersatzMs(zeit); // zweiter Schritt: Sommerzeit-Wechsel
    return new Date(zeit);
}

// --- Verwalten (Veranstalter, über das Ingest-Token des Hallen-Servers) ---
async function lese(knex, turnierKey) {
    return (await knex('live_zugang').where({ turnier_key: String(turnierKey) }).first()) || null;
}

async function beschreibe(knex, zeile) {
    const turnier = await knex('live_turniere').where({ turnier_key: zeile.turnier_key }).first('datum', 'name', 'zurueckgezogen');
    const ende = zeile.gueltig_bis ? new Date(zeile.gueltig_bis) : (turnier ? endeDesTurniertags(turnier.datum) : null);
    return {
        code: zeile.code,
        erzeugtAm: new Date(zeile.erzeugt_am).toISOString(),
        gesperrt: !!zeile.gesperrt_am,
        gueltigBis: ende ? ende.toISOString() : null
    };
}

/** Liefert den Zugang des Turniers; gibt es noch keinen, wird er erzeugt. */
export async function holeOderErzeuge(knex, turnierKey) {
    const key = String(turnierKey);
    let zeile = await lese(knex, key);
    if (!zeile) {
        await knex('live_zugang').insert({ turnier_key: key, code: erzeugeCode() }).onConflict('turnier_key').ignore();
        zeile = await lese(knex, key);
    }
    return beschreibe(knex, zeile);
}

/** Neuer Code; der alte ist sofort ungültig, eine Sperre wird aufgehoben. */
export async function erneuere(knex, turnierKey) {
    const key = String(turnierKey);
    const code = erzeugeCode();
    await knex('live_zugang').insert({ turnier_key: key, code })
        .onConflict('turnier_key').merge({ code, erzeugt_am: knex.fn.now(), gesperrt_am: null });
    return beschreibe(knex, await lese(knex, key));
}

/** Sperrt den Zugang (App-Nutzer sehen „gesperrt“) bzw. hebt die Sperre auf; der Code bleibt derselbe. */
export async function setzeGesperrt(knex, turnierKey, gesperrt) {
    await holeOderErzeuge(knex, turnierKey);
    await knex('live_zugang').where({ turnier_key: String(turnierKey) }).update({ gesperrt_am: gesperrt ? knex.fn.now() : null });
    return beschreibe(knex, await lese(knex, turnierKey));
}

// --- Prüfen (App) ---
/** @returns {Promise<{ ok: true } | { ok: false, grund: 'ungueltig'|'gesperrt'|'abgelaufen' }>} */
export async function pruefeZugang(knex, turnierKey, code, { jetzt = () => new Date() } = {}) {
    if (typeof code !== 'string' || !CODE_MUSTER.test(code)) return { ok: false, grund: 'ungueltig' };
    const zeile = await lese(knex, turnierKey);
    if (!zeile || !crypto.timingSafeEqual(sha(code), sha(zeile.code))) return { ok: false, grund: 'ungueltig' };
    if (zeile.gesperrt_am) return { ok: false, grund: 'gesperrt' };
    const turnier = await knex('live_turniere').where({ turnier_key: String(turnierKey) }).first('datum', 'zurueckgezogen');
    if (!turnier || turnier.zurueckgezogen) return { ok: false, grund: 'abgelaufen' };
    const ende = zeile.gueltig_bis ? new Date(zeile.gueltig_bis) : endeDesTurniertags(turnier.datum);
    if (!ende || jetzt().getTime() >= ende.getTime()) return { ok: false, grund: 'abgelaufen' };
    return { ok: true };
}

/** Löst den Code aus dem QR-Code auf das Turnier auf (Start der App nach dem Scannen). */
export async function loeseCodeAuf(knex, code, { jetzt = () => new Date() } = {}) {
    if (typeof code !== 'string' || !CODE_MUSTER.test(code)) return { ok: false, grund: 'ungueltig' };
    const zeile = await knex('live_zugang').where({ code }).first();
    if (!zeile) return { ok: false, grund: 'ungueltig' };
    const pruefung = await pruefeZugang(knex, zeile.turnier_key, code, { jetzt });
    if (!pruefung.ok) return pruefung;
    const turnier = await knex('live_turniere').where({ turnier_key: zeile.turnier_key }).first('name', 'datum');
    return { ok: true, key: zeile.turnier_key, name: turnier.name, datum: turnier.datum };
}

/** Löscht Zugänge von Turnieren, die es in der Cloud nicht mehr gibt (nach der Aufbewahrungsfrist der Live-Daten). */
export async function loescheVerwaisteZugaenge(knex, { tage = 14, jetzt = () => new Date() } = {}) {
    const grenze = new Date(jetzt().getTime() - tage * 86_400_000);
    return knex('live_zugang').where('erzeugt_am', '<', grenze)
        .whereNotIn('turnier_key', knex('live_turniere').select('turnier_key')).del();
}
