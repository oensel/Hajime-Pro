// Gesperrte Konten (benutzer.gesperrt, gesetzt von Super-Admins): Login und jede Anfrage mit einem noch gültigen Token
// werden abgelehnt. requireAuth fragt bei jeder Anfrage; damit das keine zusätzliche Abfrage je Request kostet, merkt
// sich dieses Modul das Ergebnis kurz. Sperren/Entsperren vergisst den Stand sofort (auf dieser Instanz; andere
// Instanzen im Cluster übernehmen die Sperre nach höchstens TTL_MS).
const TTL_MS = 10_000;
const stand = new Map(); // benutzer_id -> { gesperrt: boolean, bis: number }

export async function istKontoGesperrt(knex, benutzerId) {
    if (!benutzerId) return false;
    const jetzt = Date.now();
    const bekannt = stand.get(benutzerId);
    if (bekannt && bekannt.bis > jetzt) return bekannt.gesperrt;
    const zeile = await knex('benutzer').where({ id: benutzerId }).first('gesperrt');
    const gesperrt = !!(zeile && zeile.gesperrt);
    if (stand.size > 5000) stand.clear();
    stand.set(benutzerId, { gesperrt, bis: jetzt + TTL_MS });
    return gesperrt;
}

export function vergesseSperrStand(benutzerId) {
    if (benutzerId) stand.delete(benutzerId); else stand.clear();
}

export const MELDUNG_KONTO_GESPERRT = 'Dieses Konto ist gesperrt. Bitte wenden Sie sich an die Administration.';
