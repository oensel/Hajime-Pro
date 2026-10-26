// Anmeldeschluss-Job für Lastschriftmandate (Startgeld Stufe 3):
//  - erinnereUnbestaetigte: einmalige Erinnerung an die Admins, 3 Tage vor dem Anmeldeschluss (neue Links, alte verfallen)
//  - stelleUnbestaetigteUm: nach dem Anmeldeschluss werden Lastschrift-Zahlwege ohne gültiges Mandat (unbestätigt oder
//    abgelehnt) auf Bar umgestellt; das Startgeld wird dann vor Ort kassiert
// Die Bestätigung selbst ist nach dem Anmeldeschluss gesperrt (mandate.js, 410), beides prüft denselben effektiven
// Turnierstatus unter demselben Mandats-Lock. Mails gehen immer erst nach dem Commit hinaus und machen nichts rückgängig.
import { sendeMail } from '../utils/mailer.js';
import { normalisiereBasisUrl } from '../utils/basisUrl.js';
import { heuteBerlin, addiereTage } from '../shared/abrechnung.js';
import {
    sperreMandate, widerrufeMandatInTrx, adminAbfrage, ladeEffektivenTurnierStatus, protokolliereMandat
} from './mandate.js';
import { synchronisiereGesichert } from './zahlwege.js';
import { erzeugeToken, verbraucheAlleZuBezug } from './einmalToken.js';

const ERINNERUNG_TAGE = 3;
const GUELTIG_STUNDEN = 168;

const datumText = (wert) => (wert instanceof Date ? wert.toISOString() : String(wert ?? '')).slice(0, 10);

async function sendeSicher(sende, mail, protokollHinweis) {
    try {
        const r = await sende(mail);
        if (r && r.versendet === false && r.grund === 'fehler') console.error(`[Mandat-Job] Mail nicht versendet: ${protokollHinweis}`);
    } catch (fehler) {
        console.error(`[Mandat-Job] Mail nicht versendet: ${protokollHinweis}`, fehler?.name ?? '');
    }
}

function baueUmstellungsMail(an, turnierBezeichnung, vereinName) {
    return {
        to: an,
        subject: `Startgeld bar vor Ort: ${turnierBezeichnung}`,
        text: [
            'Hallo,',
            '',
            `für das Turnier „${turnierBezeichnung}“ lag zum Anmeldeschluss kein bestätigtes SEPA-Lastschriftmandat für ${vereinName} vor.`,
            'Deshalb wird das Startgeld bar vor Ort kassiert.',
            '',
            'Das Lastschriftmandat wurde zurückgezogen, die Kontodaten sind gelöscht. Es wird nichts abgebucht.'
        ].join('\n')
    };
}

/**
 * Stellt Lastschrift-Zahlwege ohne gültiges Mandat nach dem Anmeldeschluss auf Bar um.
 * Gesichert-Flag: weder Lastschrift ohne gültiges Mandat noch Bar sichern das Startgeld, das Flag ändert sich hier also nie.
 * Die Statusableitung (statusAbleiten) ist trotzdem aus: nach dem Anmeldeschluss sollen keine Teilnehmerstatus mehr springen.
 * @returns {Promise<number>} Anzahl umgestellter Zahlwege
 */
export async function stelleUnbestaetigteUm(knex, { turnierId = null, sende = sendeMail } = {}) {
    const kandidaten = knex('turnier_zahlwege').where({ zahlweg: 'lastschrift', mandat_gueltig: false });
    if (turnierId != null) kandidaten.where({ turnier_id: turnierId });
    const zeilen = await kandidaten.select('id', 'turnier_id', 'verein_name');

    const statusJeTurnier = new Map();
    let umgestellt = 0;
    for (const kandidat of zeilen) {
        if (!statusJeTurnier.has(kandidat.turnier_id)) {
            statusJeTurnier.set(kandidat.turnier_id, await ladeEffektivenTurnierStatus(knex, kandidat.turnier_id));
        }
        // Offene Anmeldung (oder Entwurf) bleibt unverändert; nur Turniere nach dem Anmeldeschluss.
        if (['veroeffentlicht', 'entwurf', null].includes(statusJeTurnier.get(kandidat.turnier_id))) continue;

        const ergebnis = await knex.transaction(async (trx) => {
            await sperreMandate(trx, kandidat.turnier_id, kandidat.verein_name);
            // Unter dem Lock neu lesen und bedingt umstellen: zwischenzeitlich bestätigt/gewechselt = nichts tun.
            const zahlweg = await trx('turnier_zahlwege').where({ id: kandidat.id, zahlweg: 'lastschrift', mandat_gueltig: false }).first();
            if (!zahlweg) return null;
            const status = await ladeEffektivenTurnierStatus(trx, kandidat.turnier_id);
            if (['veroeffentlicht', 'entwurf', null].includes(status)) return null;
            const turnier = await trx('turniere').where({ id: kandidat.turnier_id }).first('bezeichnung');
            const mandatId = await widerrufeMandatInTrx(trx, {
                turnierId: kandidat.turnier_id, vereinName: kandidat.verein_name, benutzer: null, grund: 'umstellung'
            }) ?? (await trx('lastschrift_mandate').where({ zahlweg_id: zahlweg.id }).orderBy('id', 'desc').first('id'))?.id ?? null;
            const geaendert = await trx('turnier_zahlwege')
                .where({ id: zahlweg.id, zahlweg: 'lastschrift', mandat_gueltig: false })
                .update({ zahlweg: 'bar', mandat_gueltig: false, updated_at: trx.fn.now() });
            if (geaendert === 0) return null;
            await synchronisiereGesichert(trx, kandidat.turnier_id, { statusAbleiten: false });
            const admins = zahlweg.verein_id == null ? [] : await adminAbfrage(trx, zahlweg.verein_id).select('benutzer.email');
            return { zahlweg, mandatId, bezeichnung: turnier?.bezeichnung ?? '', admins };
        });
        if (!ergebnis) continue;
        umgestellt += 1;

        const empfaenger = new Set([ergebnis.zahlweg.rechnung_email, ...ergebnis.admins.map((a) => a.email)]
            .map((a) => String(a ?? '').trim()).filter(Boolean));
        for (const an of empfaenger) {
            await sendeSicher(sende, baueUmstellungsMail(an, ergebnis.bezeichnung, kandidat.verein_name), `Zahlweg ${kandidat.id}`);
        }
        // Systemaktion ohne Konto: Der Eintrag gehört dem zahlenden Verein (protokolliereKonto ohne Konto + vereinId).
        await protokolliereMandat(knex, {
            art: 'mandat.umgestellt', mandatId: ergebnis.mandatId, turnierId: kandidat.turnier_id,
            benutzerId: null, vereinId: ergebnis.zahlweg.verein_id ?? null
        });
    }
    return umgestellt;
}

function baueErinnerungsMail(admin, token, mandat, basisUrl, schluss) {
    return {
        to: admin.email,
        subject: `Erinnerung: SEPA-Lastschriftmandat bestätigen (${mandat.turnier_bezeichnung})`,
        text: [
            admin.vorname ? `Hallo ${admin.vorname},` : 'Hallo,',
            '',
            `das SEPA-Lastschriftmandat von ${mandat.verein_name} für das Startgeld des Turniers „${mandat.turnier_bezeichnung}“ ist noch nicht bestätigt.`,
            `Bitte bis zum Anmeldeschluss (${schluss}) bestätigen oder ablehnen:`,
            `${basisUrl}/mandat-bestaetigen.html?token=${token}`,
            '',
            `Mandatsreferenz: ${mandat.mandatsreferenz}`,
            `Konto: ${mandat.iban_maske}`,
            '',
            'Ohne Bestätigung wird das Startgeld nach dem Anmeldeschluss bar vor Ort kassiert. Frühere Links aus der ersten Mail sind ungültig, dieser ist es nur für Sie und nur einmal.'
        ].join('\n')
    };
}

/**
 * Einmalige Erinnerung an die Admins, wenn der Anmeldeschluss in höchstens drei Tagen ist. Der Merker `erinnert_am` wird per
 * bedingtem UPDATE gesetzt, zwei parallele Läufe erinnern deshalb nur einmal.
 * @returns {Promise<number>} Anzahl erinnerter Mandate
 */
export async function erinnereUnbestaetigte(knex, { sende = sendeMail, jetzt = new Date(), basisUrl = normalisiereBasisUrl(process.env.PUBLIC_BASE_URL) } = {}) {
    if (!basisUrl) return 0; // ohne Basis-URL gibt es keine Links
    const heute = heuteBerlin(jetzt);
    const grenze = addiereTage(heute, ERINNERUNG_TAGE);
    const kandidaten = await knex('lastschrift_mandate')
        .join('turniere', 'turniere.id', 'lastschrift_mandate.turnier_id')
        .where('lastschrift_mandate.status', 'unbestaetigt')
        .whereNull('lastschrift_mandate.erinnert_am')
        .whereNotNull('turniere.anmeldeschluss')
        .select('lastschrift_mandate.id', 'lastschrift_mandate.turnier_id', 'lastschrift_mandate.verein_name', 'turniere.anmeldeschluss');

    let erinnert = 0;
    for (const kandidat of kandidaten) {
        const schluss = datumText(kandidat.anmeldeschluss);
        if (schluss < heute || schluss > grenze) continue;
        if ((await ladeEffektivenTurnierStatus(knex, kandidat.turnier_id)) !== 'veroeffentlicht') continue;

        const mails = await knex.transaction(async (trx) => {
            await sperreMandate(trx, kandidat.turnier_id, kandidat.verein_name);
            const [mandat] = await trx('lastschrift_mandate')
                .where({ id: kandidat.id, status: 'unbestaetigt' })
                .whereNull('erinnert_am')
                .update({ erinnert_am: trx.fn.now(), updated_at: trx.fn.now() })
                .returning('*');
            if (!mandat) return null; // ein anderer Lauf war schneller oder das Mandat ist entschieden
            await verbraucheAlleZuBezug(trx, 'mandat', mandat.id);
            const admins = mandat.zahlender_verein_id == null ? []
                : await adminAbfrage(trx, mandat.zahlender_verein_id).select('benutzer.id', 'benutzer.email', 'benutzer.vorname');
            const liste = [];
            for (const admin of admins) {
                const token = await erzeugeToken(trx, {
                    benutzerId: admin.id, zweck: 'mandat', vereinId: mandat.zahlender_verein_id, gueltigStunden: GUELTIG_STUNDEN, bezug: mandat.id
                });
                liste.push(baueErinnerungsMail(admin, token, mandat, basisUrl, schluss));
            }
            return liste;
        });
        if (!mails) continue;
        erinnert += 1;
        for (const mail of mails) await sendeSicher(sende, mail, `Mandat ${kandidat.id}`);
    }
    return erinnert;
}

/** Startet den stündlichen Lauf (Erinnerung, dann Umstellung); der Rückgabewert stoppt ihn. */
export function startMandatJob(knex, { intervallMs = 3_600_000, ...optionen } = {}) {
    const lauf = async () => {
        for (const schritt of [erinnereUnbestaetigte, stelleUnbestaetigteUm]) {
            try {
                await schritt(knex, optionen);
            } catch (fehler) {
                console.error('[Mandat-Job] Lauf fehlgeschlagen:', fehler?.code ?? fehler?.name ?? 'Fehler'); // nie Daten loggen
            }
        }
    };
    const erster = setTimeout(lauf, 30000);
    erster.unref();
    const timer = setInterval(lauf, intervallMs);
    timer.unref();
    return () => { clearTimeout(erster); clearInterval(timer); };
}
