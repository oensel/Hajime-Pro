// Zurückspielen eines am Hallen-Server durchgeführten Turniers in die Cloud (Startgeld Stufe 2, Spec Abschnitt 4).
// Gemeinsamer Kern für den Datei-Upload (POST /api/turniere/:id/import-ergebnisse) und den Direktweg vom Hallen-Server,
// der dieselbe Route aufruft. Ersetzt NUR die Wettkampfdaten (Kampfflächen/Pools/Teilnehmer/Kämpfe, Mannschaften werden
// abgeglichen) DIESES EINEN, in der Cloud bestehenden Turniers. Die Datei ist unvertrauenswürdig: Turnier-Stammfelder,
// Zahlungsdaten bestehender Vereine, Rechnungen, Helferplan, Orga, Urkunden-Vorlagen und Live-Token bleiben wie in der Cloud.
// Neu sind nur Zahlweg-Zeilen von Vereinen, die vor Ort erfasst wurden (immer als Bar), und das Kassenjournal.
import { FachFehler } from '../utils/fachFehler.js';
import { rolleReicht } from '../shared/rollen.js';
import { importWettkampfdaten, ermittleEffektivenStatus } from '../controllers/turnierController.js';
import { turnierHatEchteKaempfe } from '../controllers/poolController.js';
import { pruefeTransferZeile, uebernehmeBarzahlungen, ladeAusrichterNamen } from './zahlwegTransfer.js';
import { synchronisiereGesichert } from './zahlwege.js';

export const MELDUNG_UNVOLLSTAENDIG = 'Die Datei ist unvollständig.';
export const MELDUNG_RECHNUNGEN_VERSANDT = 'Für dieses Turnier wurden schon Rechnungen versandt. Erneutes Zurückspielen muss ein Admin auf der Abrechnungsseite freigeben.';
const MELDUNG_STATUS = 'Ergebnisse können erst hochgeladen werden, wenn die Anmeldefrist abgelaufen ist. Ein bereits abgeschlossenes Turnier ist schreibgeschützt.';

// Listen der Exportdatei, deren Längen `anzahl` festhält (siehe baueTurnierExport).
const PFLICHT_LISTEN = ['kampfflaechen', 'pools', 'teilnehmer', 'kaempfe'];
const OPTIONALE_LISTEN = ['mannschaften', 'mannschaft_mitglieder'];

function istAdminDesAusrichters(benutzer, turnier) {
    if (!benutzer) return false;
    if (benutzer.super_admin_aktiv) return true;
    return !!(benutzer.verein_freigegeben && benutzer.verein_id && turnier.verein_id
        && benutzer.verein_id === turnier.verein_id && rolleReicht(benutzer.verein_rolle, 'admin'));
}

// Prüft, dass die Datei vollständig ist: die vier Wettkampf-Listen sind Arrays, Mannschaften (falls vorhanden) ebenfalls,
// und eine vorhandene Zählung `anzahl` passt zu jeder Liste (erkennt abgeschnittene oder zusammengekürzte Dateien).
function pruefeVollstaendig(daten) {
    for (const name of PFLICHT_LISTEN) {
        if (!Array.isArray(daten[name])) throw new FachFehler(400, MELDUNG_UNVOLLSTAENDIG);
    }
    for (const name of OPTIONALE_LISTEN) {
        if (daten[name] !== undefined && daten[name] !== null && !Array.isArray(daten[name])) throw new FachFehler(400, MELDUNG_UNVOLLSTAENDIG);
    }
    if (daten.anzahl === undefined || daten.anzahl === null) return;
    const anzahl = daten.anzahl;
    if (typeof anzahl !== 'object' || Array.isArray(anzahl)) throw new FachFehler(400, MELDUNG_UNVOLLSTAENDIG);
    for (const name of [...PFLICHT_LISTEN, ...OPTIONALE_LISTEN]) {
        const liste = Array.isArray(daten[name]) ? daten[name] : [];
        if (!Number.isInteger(anzahl[name]) || anzahl[name] !== liste.length) throw new FachFehler(400, MELDUNG_UNVOLLSTAENDIG);
    }
}

/**
 * Übernimmt aus der Datei nur Zahlweg-Zeilen von Vereinen, die im Turnier noch keine haben (vor Ort erfasst), nie für den
 * Ausrichter, immer mit Zahlweg Bar (vor Ort wird bar kassiert). Bestehende Zeilen bleiben unberührt. Importierte Zeilen
 * tragen keinen Benutzer (geaendert_von/verein_id NULL) und speisen deshalb keine Vorbelegung.
 * @returns {Promise<number>} Zahl neu angelegter Zeilen
 */
export async function uebernehmeNeueZahlwege(trx, turnierId, zahlwege) {
    if (!Array.isArray(zahlwege)) return 0;
    // Namen wie in der Abrechnung vergleichen: getrimmt, Groß-/Kleinschreibung egal ('jc x' ist 'JC X').
    const norm = (n) => String(n ?? '').trim().toLowerCase();
    const bestehend = new Set((await trx('turnier_zahlwege').where({ turnier_id: turnierId }).select('verein_name'))
        .map((z) => norm(z.verein_name)));
    const ausrichter = new Set([...(await ladeAusrichterNamen(trx, turnierId))].map(norm));
    const zeilen = [];
    for (const z of zahlwege) {
        const geprueft = pruefeTransferZeile(z);
        if (!geprueft || bestehend.has(norm(geprueft.verein_name)) || ausrichter.has(norm(geprueft.verein_name))) continue;
        bestehend.add(norm(geprueft.verein_name));
        zeilen.push({ turnier_id: turnierId, ...geprueft, zahlweg: 'bar', mandat_gueltig: false, verein_id: null, geaendert_von: null });
    }
    if (zeilen.length) await trx('turnier_zahlwege').insert(zeilen);
    return zeilen.length;
}

// Nach dem Commit sind die Daten schon ersetzt: ein Fehler beim Ableiten des Flags darf keine 500 mehr auslösen.
export async function synchronisiereNachRueckspielen(knex, turnierId) {
    try {
        await synchronisiereGesichert(knex, turnierId, { statusAbleiten: false });
        return true;
    } catch (fehler) {
        console.error(`Zurückspielen: Zahlweg-Flags von Turnier ${turnierId} konnten nicht abgeleitet werden: ${fehler?.code ?? ''} ${fehler?.message ?? fehler}`);
        return false;
    }
}

/**
 * Spielt die Exportdatei eines Hallen-Servers in das Cloud-Turnier zurück. Wirft FachFehler (404/403/400/409).
 * @param {object} knex
 * @param {{ turnierId: number, daten: object, benutzer: object }} param  benutzer = ladeBenutzerMitAktivemVerein
 * @returns {Promise<{ turnierId: number, imported: { kampfflaechen: number, pools: number, teilnehmer: number, kaempfe: number }, neueVereine: number, barzahlungen: number }>}
 */
export async function spieleTurnierZurueck(knex, { turnierId, daten, benutzer }) {
    const turnier = Number.isInteger(turnierId) ? await knex('turniere').where({ id: turnierId }).first() : null;
    if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');

    if (!istAdminDesAusrichters(benutzer, turnier)) {
        throw new FachFehler(403, 'Nur Admins des ausrichtenden Vereins dürfen das Turnier zurückspielen.');
    }

    const t = daten && typeof daten === 'object' ? daten.turnier : null;
    if (!t || typeof t !== 'object' || t.id == null) {
        throw new FachFehler(400, 'Ungültiges Import-Format: Turnier-ID fehlt in der Datei.');
    }
    // Stammt die Datei aus einem Hallen-Server-Import (urspruengliche_id, siehe importiereTurnierDaten), steht dort die
    // tatsächliche Cloud-Herkunfts-ID — die eigene (lokale) ID der Datei wäre für den Abgleich bedeutungslos.
    const quellTurnierId = t.urspruengliche_id ?? t.id;
    if (parseInt(quellTurnierId, 10) !== turnierId) {
        throw new FachFehler(400, `Die Datei gehört zu Turnier-ID ${quellTurnierId}, nicht zum ausgewählten Turnier (ID ${turnierId}).`);
    }

    pruefeVollstaendig(daten);

    const { kampfflaechen, pools, teilnehmer, kaempfe } = daten;
    const mannschaften = daten.mannschaften || [];
    const mannschaftMitglieder = daten.mannschaft_mitglieder || [];

    const ergebnis = await knex.transaction(async (trx) => {
        // Sperrt die Turnierzeile: gleichzeitiges Rückspielen bzw. das Verbrauchen der Freigabe läuft nacheinander.
        const gesperrt = await trx('turniere').where({ id: turnierId }).forUpdate().first();
        const hatEchteKaempfe = await turnierHatEchteKaempfe(trx, turnierId);
        const status = ermittleEffektivenStatus(gesperrt, { hatEchteKaempfe });
        const erlaubt = ['anmeldung_geschlossen', 'in_durchfuehrung'].includes(status)
            || (status === 'abgeschlossen' && gesperrt.zurueckgespielt_am != null);
        if (!erlaubt) throw new FachFehler(403, MELDUNG_STATUS);

        const versandt = await trx('rechnungen').where({ turnier_id: turnierId }).whereNotNull('versandt_am').first('id');
        if (versandt && !gesperrt.rueckspielen_freigegeben) throw new FachFehler(409, MELDUNG_RECHNUNGEN_VERSANDT);

        // Nur die Wettkampfdaten DIESES Turniers ersetzen — turniere/benutzer/vereine bleiben unangetastet, andere
        // Turniere sind von dieser Löschung nicht betroffen. mannschaften bewusst NICHT gelöscht (siehe
        // importWettkampfdaten): sie werden dort per (verein, bezeichnung) mit den in der Cloud bereits bestehenden Zeilen
        // abgeglichen statt neu angelegt, damit ihre IDs stabil bleiben (worauf mannschaftskaempfe verweisen).
        const altePoolIds = (await trx('pools').where({ turnier_id: turnierId }).select('id')).map((p) => p.id);
        if (altePoolIds.length > 0) {
            await trx('kaempfe').whereIn('pool_id', altePoolIds).del();
        }
        await trx('turnier_teilnehmer').where({ turnier_id: turnierId }).del();
        await trx('pools').where({ turnier_id: turnierId }).del();
        await trx('kampfflaechen').where({ turnier_id: turnierId }).del();

        await importWettkampfdaten(trx, turnierId, { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaftMitglieder });

        // Zahlungsdaten bestehender Vereine bleiben unberührt (Spec Abschnitt 4), nur vor Ort neu erfasste Vereine kommen dazu.
        const neueVereine = await uebernehmeNeueZahlwege(trx, turnierId, daten.zahlwege);
        const barzahlungen = await uebernehmeBarzahlungen(trx, turnierId, daten.barzahlungen);

        // Automatischer Übergang in den Archiv-Zustand (Zustand 5: "wird automatisch durch den Upload der Ergebnisdaten
        // ... ausgelöst"); eine Freigabe für erneutes Zurückspielen ist damit verbraucht.
        await trx('turniere').where({ id: turnierId }).update({
            status: 'abgeschlossen',
            zurueckgespielt_am: trx.fn.now(),
            rueckspielen_freigegeben: false,
            updated_at: trx.fn.now()
        });
        return { neueVereine, barzahlungen };
    });
    // Flag der neu eingelesenen Teilnehmer aus den Zahlwegen ableiten; der archivierte Status bleibt wie importiert.
    await synchronisiereNachRueckspielen(knex, turnierId);

    return {
        turnierId,
        imported: {
            kampfflaechen: kampfflaechen.length,
            pools: pools.length,
            teilnehmer: teilnehmer.length,
            kaempfe: kaempfe.length
        },
        neueVereine: ergebnis.neueVereine,
        barzahlungen: ergebnis.barzahlungen
    };
}
