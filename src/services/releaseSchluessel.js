// Berechtigung zum Herunterladen und Geräteschlüssel/Einlösecodes (Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md).
// Berechtigt ist ein bestätigtes, nicht gesperrtes Konto, das Super-Admin ist oder in mindestens einem Verein freigegebenes
// Mitglied mit der Rolle Benutzer oder Admin. Die Prüfung läuft bei JEDEM Abruf, auch mit Geräteschlüssel: wird jemand gesperrt
// oder entfernt, endet damit auch das Auto-Update seiner Server.
import { createHash, randomBytes } from 'crypto';
import { ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';

export const SCHLUESSEL_VORSATZ = 'hjg_';
export const CODE_LAENGE = 16;
export const CODE_GUELTIG_TAGE = 14;
const NUTZUNG_INTERVALL_MS = 60_000;
const ZIFFERN_BUCHSTABEN = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');

/** Darf dieses Konto Installer und Updates laden? (Konto bestätigt, nicht gesperrt, Super-Admin oder Rolle ab Benutzer in einem freigegebenen Verein) */
export async function darfReleasesLaden(knex, benutzerId) {
    if (!benutzerId) return false;
    const konto = await knex('benutzer').where({ id: String(benutzerId) }).first('id', 'email_bestaetigt_am', 'gesperrt', 'ist_super_admin');
    if (!konto || !konto.email_bestaetigt_am || konto.gesperrt) return false;
    if (konto.ist_super_admin) return true;
    return (await ladeVereinIdsMitRolle(knex, konto.id, 'benutzer')).length > 0;
}

function zufaelligerCode() {
    const bytes = randomBytes(CODE_LAENGE);
    let code = '';
    for (let i = 0; i < CODE_LAENGE; i++) code += ZIFFERN_BUCHSTABEN[bytes[i] % ZIFFERN_BUCHSTABEN.length];
    return code;
}

export async function erzeugeGeraeteSchluessel(knex, benutzerId, bezeichnung = '') {
    const schluessel = SCHLUESSEL_VORSATZ + randomBytes(32).toString('base64url');
    await knex('download_schluessel').insert({
        benutzer_id: String(benutzerId), bezeichnung: String(bezeichnung || '').slice(0, 120), schluessel_hash: sha256(schluessel)
    });
    return schluessel;
}

const letzteNutzung = new Map();

/** Prüft einen Geräteschlüssel. Liefert { benutzerId, schluesselId } oder null (unbekannt, widerrufen oder Konto nicht mehr berechtigt). */
export async function pruefeGeraeteSchluessel(knex, schluessel, { jetzt = Date.now } = {}) {
    if (typeof schluessel !== 'string' || !schluessel.startsWith(SCHLUESSEL_VORSATZ) || schluessel.length > 200) return null;
    const zeile = await knex('download_schluessel').where({ schluessel_hash: sha256(schluessel) }).whereNull('widerrufen_am').first();
    if (!zeile) return null;
    if (!(await darfReleasesLaden(knex, zeile.benutzer_id))) return null;
    const zuletzt = letzteNutzung.get(zeile.id) || 0;
    if (jetzt() - zuletzt > NUTZUNG_INTERVALL_MS) {
        letzteNutzung.set(zeile.id, jetzt());
        await knex('download_schluessel').where({ id: zeile.id }).update({ zuletzt_benutzt_am: knex.fn.now() });
    }
    return { benutzerId: zeile.benutzer_id, schluesselId: zeile.id };
}

/** Einlösecode für den Dateinamen eines Installers (14 Tage, einmalig). Im Klartext nur hier; gespeichert wird der Hash. */
export async function erzeugeEinloesecode(knex, benutzerId, { jetzt = Date.now } = {}) {
    const code = zufaelligerCode();
    await knex('download_einloesecodes').insert({
        benutzer_id: String(benutzerId), code_hash: sha256(code), laeuft_ab_am: new Date(jetzt() + CODE_GUELTIG_TAGE * 86_400_000)
    });
    return code;
}

/** Tauscht einen Einlösecode (atomar, einmalig) gegen einen Geräteschlüssel. null, wenn der Code unbekannt, benutzt, abgelaufen oder das Konto nicht mehr berechtigt ist. */
export async function loeseEinloesecodeAb(knex, code, bezeichnung = 'Hallen-Server', { jetzt = Date.now } = {}) {
    const text = String(code || '').trim();
    if (!/^[A-Za-z0-9]{16}$/.test(text)) return null;
    const verbraucht = await knex('download_einloesecodes')
        .where({ code_hash: sha256(text) }).whereNull('benutzt_am').andWhere('laeuft_ab_am', '>', new Date(jetzt()))
        .update({ benutzt_am: knex.fn.now() }).returning('benutzer_id');
    if (!verbraucht || verbraucht.length === 0) return null;
    const benutzerId = typeof verbraucht[0] === 'object' ? verbraucht[0].benutzer_id : verbraucht[0];
    if (!(await darfReleasesLaden(knex, benutzerId))) return null;
    return erzeugeGeraeteSchluessel(knex, benutzerId, bezeichnung);
}

/** Geräteschlüssel zur Verwaltung: Super-Admins sehen alle, Admins die Schlüssel der Mitglieder ihrer Vereine, alle anderen ihre eigenen. */
export async function listeGeraeteSchluessel(knex, { benutzerId, superAdmin = false, adminVereinIds = [] }) {
    const abfrage = knex('download_schluessel as s')
        .join('benutzer as b', 'b.id', 's.benutzer_id')
        .select('s.id', 's.bezeichnung', 's.erstellt_am', 's.zuletzt_benutzt_am', 's.widerrufen_am', 'b.id as benutzer_id', 'b.email', 'b.vorname', 'b.nachname')
        .orderBy('s.erstellt_am', 'desc');
    if (!superAdmin) {
        abfrage.where(function () {
            this.where('s.benutzer_id', String(benutzerId));
            if (adminVereinIds.length) {
                this.orWhereIn('s.benutzer_id', knex('benutzer_vereine').whereIn('verein_id', adminVereinIds).andWhere({ freigegeben: 1 }).select('benutzer_id'));
            }
        });
    }
    return abfrage;
}

/** Widerruft einen Schlüssel, soweit der Handelnde ihn sehen darf. true, wenn etwas widerrufen wurde. */
export async function widerrufeGeraeteSchluessel(knex, id, bereich) {
    const sichtbar = await listeGeraeteSchluessel(knex, bereich);
    if (!sichtbar.some(s => s.id === Number(id))) return false;
    const n = await knex('download_schluessel').where({ id: Number(id) }).whereNull('widerrufen_am').update({ widerrufen_am: knex.fn.now() });
    return n > 0;
}
