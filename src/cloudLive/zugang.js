// Zugang der Geräte zu einem Turnier, das die Cloud live führt (Spec docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md):
//  - Schlüssel: steckt im Pfad /turnierlive/<schluessel>, bestimmt das Turnier
//  - Code: 6 Ziffern, wird gegen das Geheimnis getauscht (Kopplung per QR/Code), gilt nur zusammen mit dem Schlüssel
//  - Geheimnis: Header x-hajime-sync-secret der Replikation, gilt nur für die Dokument-DB dieses Turniers
// Der Zugang läuft wie der der Teilnehmer-App um 06:00 Uhr (Berliner Zeit) am Tag nach dem Turniertag ab oder mit „Live beenden“.
import crypto from 'node:crypto';
import { endeDesTurniertags } from '../liveCloud/zugang.js';

/** Falsche Codes, nach denen der Zugang gesperrt wird (der Admin hebt die Sperre auf oder erneuert den Zugang). */
export const MAX_FEHLVERSUCHE = 10;

const sha = (text) => crypto.createHash('sha256').update(String(text)).digest();
const gleich = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

const erzeugeSchluessel = () => crypto.randomBytes(16).toString('base64url');
const erzeugeGeheimnis = () => crypto.randomBytes(32).toString('hex');
const erzeugeCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// turniere.datum kommt je nach pg-Typparser als 'JJJJ-MM-TT' oder als Date.
function datumsText(datum) {
    if (datum instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${datum.getFullYear()}-${p(datum.getMonth() + 1)}-${p(datum.getDate())}`;
    }
    return String(datum ?? '');
}

function alsDaten(zeile) {
    if (!zeile) return null;
    return {
        turnierId: zeile.turnier_id,
        schluessel: zeile.schluessel,
        geheimnis: zeile.geheimnis,
        code: zeile.code,
        instanzId: zeile.instanz_id,
        gesperrt: !!zeile.gesperrt_am,
        gueltigBis: zeile.turnier_datum !== undefined ? endeDesTurniertags(datumsText(zeile.turnier_datum)) : null,
        beendetAm: zeile.beendet_am ? new Date(zeile.beendet_am) : null
    };
}

function liesZeile(knex, bedingung) {
    return knex('cloud_live')
        .join('turniere', 'turniere.id', 'cloud_live.turnier_id')
        .where(bedingung)
        .first('cloud_live.*', 'turniere.datum as turnier_datum');
}

export async function ladeZugang(knex, turnierId) {
    return alsDaten(await liesZeile(knex, { 'cloud_live.turnier_id': turnierId }));
}

export async function ladeZugangPerSchluessel(knex, schluessel) {
    return alsDaten(await liesZeile(knex, { 'cloud_live.schluessel': String(schluessel) }));
}

/** Startet den Live-Betrieb: legt den Zugang an; ein bereits laufender wird unverändert geliefert, ein beendeter beginnt neu. */
export async function starteZugang(knex, turnierId) {
    const vorhanden = await ladeZugang(knex, turnierId);
    if (vorhanden && !vorhanden.beendetAm) return vorhanden;
    const neu = {
        schluessel: erzeugeSchluessel(), geheimnis: erzeugeGeheimnis(), code: erzeugeCode(),
        instanz_id: crypto.randomUUID(), erzeugt_am: knex.fn.now(), gesperrt_am: null, beendet_am: null, fehlversuche: 0
    };
    if (vorhanden) await knex('cloud_live').where({ turnier_id: turnierId }).update(neu);
    else await knex('cloud_live').insert({ turnier_id: turnierId, ...neu });
    return ladeZugang(knex, turnierId);
}

// Gemeinsame Prüfung: aktiv (nicht beendet), nicht gesperrt, nicht abgelaufen.
function pruefeZustand(daten) {
    if (!daten || daten.beendetAm) return { ok: false, grund: 'ungueltig' };
    return { ok: true };
}

function pruefeSperreUndAblauf(daten, jetzt) {
    if (daten.gesperrt) return { ok: false, grund: 'gesperrt' };
    if (!daten.gueltigBis || jetzt().getTime() >= daten.gueltigBis.getTime()) return { ok: false, grund: 'abgelaufen' };
    return { ok: true };
}

/** Tauscht den 6-stelligen Code gegen das Geheimnis. Sperre und Ablauf werden VOR dem Vergleich geprüft, sonst ließe sich über die Antwort raten. */
export async function pruefeCode(knex, schluessel, code, { jetzt = () => new Date() } = {}) {
    const daten = await ladeZugangPerSchluessel(knex, schluessel);
    const zustand = pruefeZustand(daten);
    if (!zustand.ok) return zustand;
    const frist = pruefeSperreUndAblauf(daten, jetzt);
    if (!frist.ok) return frist;
    const eingabe = String(code ?? '').replace(/\D/g, '');
    if (eingabe.length !== 6 || !gleich(eingabe, daten.code)) {
        const [{ fehlversuche }] = await knex('cloud_live').where({ turnier_id: daten.turnierId })
            .update({ fehlversuche: knex.raw('fehlversuche + 1') }).returning('fehlversuche');
        if (fehlversuche >= MAX_FEHLVERSUCHE) await knex('cloud_live').where({ turnier_id: daten.turnierId }).update({ gesperrt_am: knex.fn.now() });
        return { ok: false, grund: 'ungueltig' };
    }
    await knex('cloud_live').where({ turnier_id: daten.turnierId }).update({ fehlversuche: 0 });
    return { ok: true, geheimnis: daten.geheimnis };
}

/** Prüft das Geheimnis einer Replikation gegen das Turnier des Schlüssels. */
export async function pruefeGeheimnis(knex, schluessel, geheimnis, { jetzt = () => new Date() } = {}) {
    const daten = await ladeZugangPerSchluessel(knex, schluessel);
    const zustand = pruefeZustand(daten);
    if (!zustand.ok) return zustand;
    if (typeof geheimnis !== 'string' || !geheimnis || !gleich(geheimnis, daten.geheimnis)) return { ok: false, grund: 'ungueltig' };
    const frist = pruefeSperreUndAblauf(daten, jetzt);
    if (!frist.ok) return frist;
    return { ok: true, zugang: daten };
}

/** Neuer Code und neues Geheimnis (der Schlüssel bleibt); bereits gekoppelte Geräte müssen neu koppeln. Hebt eine Sperre auf. */
export async function erneuereZugang(knex, turnierId) {
    const vorhanden = await ladeZugang(knex, turnierId);
    if (!vorhanden || vorhanden.beendetAm) return null;
    await knex('cloud_live').where({ turnier_id: turnierId }).update({
        geheimnis: erzeugeGeheimnis(), code: erzeugeCode(), erzeugt_am: knex.fn.now(), gesperrt_am: null, fehlversuche: 0
    });
    return ladeZugang(knex, turnierId);
}

export async function setzeGesperrt(knex, turnierId, gesperrt) {
    await knex('cloud_live').where({ turnier_id: turnierId }).update({ gesperrt_am: gesperrt ? knex.fn.now() : null, ...(gesperrt ? {} : { fehlversuche: 0 }) });
    return ladeZugang(knex, turnierId);
}

export async function beendeZugang(knex, turnierId) {
    await knex('cloud_live').where({ turnier_id: turnierId }).update({ beendet_am: knex.fn.now() });
    return ladeZugang(knex, turnierId);
}
