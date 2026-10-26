// SEPA-Lastschriftmandate (Startgeld Stufe 3, Plan L2/L4/L5/L12): erteilen, per Mail-Link bestätigen oder
// ablehnen, widerrufen. IBAN, Kontoinhaber und IP des Zahlers liegen nur im AES-GCM-Chiffretext
// daten_verschluesselt; nach außen (API, Mail) geht nur die Maske. Klartext liefert allein ladeMandatIban
// (für die SEPA-Datei).
//
// Nebenläufigkeit: alle Änderungen an den Mandaten eines (Turnier, Verein) laufen unter demselben
// Advisory-Lock (sperreMandate); Statuswechsel zusätzlich als bedingtes UPDATE. Der Partial-Unique-Index
// lastschrift_mandate_aktiv ist die letzte Absicherung (höchstens ein offenes oder gültiges Mandat).
// Lock-Reihenfolge überall: Mandats-Lock -> Mandatszeile -> Tokens -> Zahlweg -> Turnier-Lock (synchronisiereGesichert).
import { FachFehler } from '../utils/fachFehler.js';
import { verschluesseleFeld, entschluesseleFeld } from '../utils/feldVerschluesselung.js';
import { sendeMail } from '../utils/mailer.js';
import { pruefeIban, maskiereIban } from '../shared/iban.js';
import { baueMandatstext, MANDATSTEXT_VERSION } from '../shared/mandatText.js';
import { sepaKennung } from '../shared/sepaZeichen.js';
import { heuteBerlin } from '../shared/abrechnung.js';
import { ladeStammdaten } from './abrechnungStammdaten.js';
import { erzeugeToken, pruefeToken, verbrauchePruefe, tokenBekannt, verbraucheAlleZuBezug } from './einmalToken.js';
import { synchronisiereGesichert } from './zahlwege.js';
import { protokolliereKonto } from './aktionsProtokoll.js';

const AKTIV = ['unbestaetigt', 'gueltig'];
const GUELTIG_STUNDEN = 168;
const KONTOINHABER_MAX = 70;
const MELDUNG_ENTSCHIEDEN = 'Über dieses Mandat wurde schon entschieden oder es wurde zurückgezogen.';

// +14 Monate (L12), Tag auf das Monatsende begrenzt (31.12. -> 28./29.02.).
export function berechneLoeschenAb(isoDatum) {
    const [j, m, d] = String(isoDatum).slice(0, 10).split('-').map(Number);
    const monat = m - 1 + 14;
    const jahr = j + Math.floor(monat / 12);
    const monatImJahr = monat % 12;
    const letzterTag = new Date(Date.UTC(jahr, monatImJahr + 1, 0)).getUTCDate();
    return new Date(Date.UTC(jahr, monatImJahr, Math.min(d, letzterTag))).toISOString().slice(0, 10);
}

// Serialisiert alle Mandatsänderungen eines Vereins in einem Turnier (eigener Schlüsselraum, 2 Argumente).
export async function sperreMandate(trx, turnierId, vereinName) {
    await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [turnierId ?? 0, `mandat:${vereinName}`]);
}

function leseDaten(zeile) {
    if (!zeile?.daten_verschluesselt) return null;
    try {
        return JSON.parse(entschluesseleFeld(zeile.daten_verschluesselt));
    } catch {
        return null; // Schlüssel fehlt oder passt nicht: dann eben ohne Maske
    }
}

function maskiereName(name) {
    const zeichen = Array.from(String(name ?? '').trim());
    return zeichen.length ? `${zeichen.slice(0, 2).join('')}…` : null;
}

/** @returns {{ id, mandatsreferenz, status, iban_maske, kontoinhaber_maske, erteilt_am, bestaetigt_am, textversion }} */
export function mandatOeffentlich(zeile) {
    if (!zeile) return null;
    const daten = leseDaten(zeile);
    return {
        id: zeile.id,
        mandatsreferenz: zeile.mandatsreferenz,
        status: zeile.status,
        iban_maske: zeile.iban_maske ?? null,
        kontoinhaber_maske: daten ? maskiereName(daten.kontoinhaber) : null,
        erteilt_am: zeile.erteilt_am,
        bestaetigt_am: zeile.bestaetigt_am ?? null,
        textversion: zeile.textversion
    };
}

// Prüft die Mandatsangaben (400) und liefert die normalisierten Werte.
export function pruefeMandatsEingabe(eingabe) {
    const e = eingabe && typeof eingabe === 'object' ? eingabe : {};
    const iban = pruefeIban(e.iban);
    if (!iban.ok) throw new FachFehler(400, iban.fehler);
    const kontoinhaber = typeof e.kontoinhaber === 'string' ? e.kontoinhaber.trim() : '';
    if (!kontoinhaber) throw new FachFehler(400, 'Bitte den Kontoinhaber angeben.');
    if (kontoinhaber.length > KONTOINHABER_MAX) {
        throw new FachFehler(400, `Der Kontoinhaber darf höchstens ${KONTOINHABER_MAX} Zeichen lang sein.`);
    }
    if (e.zustimmung !== true) throw new FachFehler(400, 'Bitte das Lastschriftmandat ausdrücklich erteilen.');
    if (e.vertretung_bestaetigt !== true) {
        throw new FachFehler(400, 'Bitte bestätigen, dass Sie berechtigt sind, den Verein zu vertreten.');
    }
    return { iban: iban.iban, kontoinhaber };
}

export async function ladeAktivesMandat(knex, turnierId, vereinName, { sperren = false } = {}) {
    const q = knex('lastschrift_mandate').where({ turnier_id: turnierId, verein_name: vereinName }).whereIn('status', AKTIV);
    return (await (sperren ? q.forUpdate() : q).first()) || null;
}

// Admins des zahlenden Vereins, die bestätigen dürfen: freigegeben, E-Mail bestätigt, nicht gesperrt.
function adminAbfrage(knex, vereinId) {
    return knex('benutzer_vereine')
        .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
        .where({ 'benutzer_vereine.verein_id': vereinId, 'benutzer_vereine.freigegeben': 1, 'benutzer_vereine.rolle': 'admin' })
        .whereNotNull('benutzer.email_bestaetigt_am')
        .where((q) => q.where('benutzer.gesperrt', false).orWhereNull('benutzer.gesperrt'));
}

async function baueMandatsreferenz(trx, stammdaten, turnierId, zahlwegId) {
    const praefix = String(stammdaten?.rechnungs_praefix ?? '').replace(/-/g, '');
    const basis = `${praefix}M${turnierId}V${zahlwegId}`;
    // Nächste Nummer aus dem GRÖSSTEN vorhandenen Zusatz (nicht aus der Anzahl): gelöschte alte Mandate
    // (Löschfrist L12) dürfen keine Referenz doppelt vergeben. Die Referenz ohne Zusatz zählt als 1.
    const vorhandene = await trx('lastschrift_mandate').where({ zahlweg_id: zahlwegId }).select('mandatsreferenz');
    let hoechste = 0;
    for (const { mandatsreferenz } of vorhandene) {
        const treffer = /-(\d+)$/.exec(String(mandatsreferenz));
        hoechste = Math.max(hoechste, treffer ? Number(treffer[1]) : 1);
    }
    const n = hoechste + 1;
    const zusatz = n > 1 ? `-${n}` : '';
    return sepaKennung(basis, 35 - zusatz.length) + zusatz;
}

// Widerruf innerhalb einer Transaktion, die sperreMandate schon hält. L5: ein gültiges Mandat widerruft beim
// Wechsel nur ein Admin des zahlenden Vereins (Umstellung durch den Job und Rücklastschrift sind keine Wechsel).
export async function widerrufeMandatInTrx(trx, { turnierId, vereinName, benutzer, grund }) {
    if (!['wechsel', 'umstellung', 'ruecklastschrift'].includes(grund)) throw new Error(`Unbekannter Widerrufsgrund: ${grund}`);
    const mandat = await ladeAktivesMandat(trx, turnierId, vereinName, { sperren: true });
    if (!mandat) return null;
    if (grund === 'wechsel' && mandat.status === 'gueltig' && benutzer?.istAdminDesVereins !== true) {
        throw new FachFehler(403, 'Ein bestätigtes Lastschriftmandat kann nur ein Admin des Vereins widerrufen.');
    }
    const geaendert = await trx('lastschrift_mandate')
        .where({ id: mandat.id })
        .whereIn('status', AKTIV)
        .update({
            status: grund === 'umstellung' ? 'umgestellt' : 'widerrufen',
            daten_verschluesselt: null,
            entschieden_am: mandat.entschieden_am ?? trx.fn.now(),
            loeschen_ab: berechneLoeschenAb(mandat.letzter_einzug_am ?? heuteBerlin()),
            updated_at: trx.fn.now()
        });
    if (geaendert === 0) return null;
    await verbraucheAlleZuBezug(trx, 'mandat', mandat.id);
    await trx('turnier_zahlwege').where({ turnier_id: turnierId, verein_name: vereinName })
        .update({ mandat_gueltig: false, updated_at: trx.fn.now() });
    return mandat.id; // ID des widerrufenen Mandats (fürs Protokoll), null = es gab keines
}

// Neues Mandat innerhalb einer Transaktion, die sperreMandate schon hält. Liefert die zu versendenden Mails,
// die der Aufrufer erst nach dem Commit verschickt.
export async function erteileMandatInTrx(trx, { turnier, zahlwegZeile, daten, benutzer, ip }) {
    const stammdaten = turnier.verein_id ? await ladeStammdaten(trx, turnier.verein_id) : null;
    if (!stammdaten?.glaeubiger_id) throw new FachFehler(400, 'Lastschrift wird für dieses Turnier nicht angeboten.');
    const ersetztMandatId = await widerrufeMandatInTrx(trx, { turnierId: turnier.id, vereinName: zahlwegZeile.verein_name, benutzer, grund: 'wechsel' });

    const glaeubigerName = stammdaten.absender_name || stammdaten.kontoinhaber;
    const mandatsreferenz = await baueMandatsreferenz(trx, stammdaten, turnier.id, zahlwegZeile.id);
    const mandatstext = baueMandatstext({
        glaeubigerName,
        glaeubigerId: stammdaten.glaeubiger_id,
        mandatsreferenz,
        vorabTage: turnier.vorabankuendigung_tage ?? 5,
        turnierBezeichnung: turnier.bezeichnung,
        zahlenderVerein: zahlwegZeile.verein_name
    });
    const sofort = benutzer?.istAdminDesVereins === true;
    const jetzt = trx.fn.now();
    let zeile;
    try {
        [zeile] = await trx('lastschrift_mandate').insert({
            turnier_id: turnier.id,
            turnier_bezeichnung: turnier.bezeichnung,
            zahlweg_id: zahlwegZeile.id,
            verein_name: zahlwegZeile.verein_name,
            zahlender_verein_id: zahlwegZeile.verein_id ?? null,
            mandatsreferenz,
            daten_verschluesselt: verschluesseleFeld(JSON.stringify({ iban: daten.iban, kontoinhaber: daten.kontoinhaber, ip: ip ?? null })),
            iban_maske: maskiereIban(daten.iban),
            mandatstext,
            textversion: MANDATSTEXT_VERSION,
            glaeubiger_id: stammdaten.glaeubiger_id,
            glaeubiger_name: glaeubigerName,
            status: sofort ? 'gueltig' : 'unbestaetigt',
            erteilt_am: jetzt,
            erteilt_von: String(benutzer.id),
            vertretung_bestaetigt: true,
            bestaetigt_am: sofort ? jetzt : null,
            bestaetigt_von: sofort ? String(benutzer.id) : null,
            entschieden_am: sofort ? jetzt : null
        }).returning('*');
    } catch (fehler) {
        // Unique-Index griff trotz Lock (z.B. Aufrufer ohne sperreMandate): kein 500, nichts gespeichert.
        if (fehler?.code === '23505') throw new FachFehler(409, 'Das Mandat wurde gerade gleichzeitig geändert, bitte erneut versuchen.');
        throw fehler;
    }
    await trx('turnier_zahlwege').where({ id: zahlwegZeile.id }).update({ mandat_gueltig: sofort, updated_at: trx.fn.now() });

    const mails = [];
    if (!sofort) {
        const admins = zahlwegZeile.verein_id == null ? [] : await adminAbfrage(trx, zahlwegZeile.verein_id)
            .select('benutzer.id', 'benutzer.email', 'benutzer.vorname');
        const ersteller = await trx('benutzer').where({ id: String(benutzer.id) }).first('vorname', 'nachname');
        for (const admin of admins) {
            const token = await erzeugeToken(trx, {
                benutzerId: admin.id, zweck: 'mandat', vereinId: zahlwegZeile.verein_id, gueltigStunden: GUELTIG_STUNDEN, bezug: zeile.id
            });
            mails.push({ admin, token, ersteller });
        }
    }
    return { zeile, mails, ersetztMandatId };
}

// Anzahl der Admins, die das Mandat per Mail bestätigen könnten (0 = niemand: der Dialog muss das klar sagen).
export async function zaehleBestaetiger(knex, vereinId) {
    if (vereinId == null) return 0;
    const [{ anzahl }] = await adminAbfrage(knex, vereinId).count({ anzahl: '*' });
    return Number(anzahl);
}

// Aktionsprotokoll: nur IDs und IP, nie Kontodaten. Fehler hier stören den Ablauf nie (protokolliereKonto fängt sie).
export async function protokolliereMandat(knex, { art, mandatId, turnierId, benutzerId, ip = null, vereinId = null }) {
    const texte = {
        'mandat.erteilt': 'Lastschriftmandat erteilt',
        'mandat.widerrufen': 'Lastschriftmandat widerrufen',
        'mandat.entscheidung': 'Lastschriftmandat bestätigt oder abgelehnt'
    };
    await protokolliereKonto(knex, {
        konto: benutzerId == null ? null : { id: String(benutzerId) },
        vereinId,
        aktion: art,
        beschreibung: texte[art],
        ip,
        details: { mandatId, turnierId }
    });
}

function baueBestaetigungsMail({ admin, token, ersteller }, zeile, basisUrl) {
    const wer = [ersteller?.vorname, ersteller?.nachname].filter(Boolean).join(' ') || 'Ein Mitglied Ihres Vereins';
    return {
        to: admin.email,
        subject: `SEPA-Lastschriftmandat bestätigen: ${zeile.turnier_bezeichnung}`,
        text: [
            admin.vorname ? `Hallo ${admin.vorname},` : 'Hallo,',
            '',
            `${wer} hat für ${zeile.verein_name} ein SEPA-Lastschriftmandat für das Startgeld des Turniers „${zeile.turnier_bezeichnung}“ erteilt.`,
            '',
            'Bitte bestätigen Sie das SEPA-Lastschriftmandat oder lehnen Sie es ab:',
            `${basisUrl}/mandat-bestaetigen.html?token=${token}`,
            '',
            `Gläubiger: ${zeile.glaeubiger_name}`,
            `Mandatsreferenz: ${zeile.mandatsreferenz}`,
            `Konto: ${zeile.iban_maske}`,
            '',
            'Bis zur Bestätigung gilt das Startgeld nicht als gesichert. Der Link ist 7 Tage gültig und nur einmal verwendbar; '
                + 'sobald ein Admin Ihres Vereins entschieden hat, verfallen die Links der übrigen Admins.'
        ].join('\n')
    };
}

export async function versendeBestaetigungen(ergebnis, basisUrl, sende = sendeMail) {
    for (const eintrag of ergebnis?.mails || []) {
        const mail = baueBestaetigungsMail(eintrag, ergebnis.zeile, basisUrl);
        try {
            const r = await sende(mail);
            if (r && r.versendet === false && r.grund === 'fehler') console.error('[Mandat] Bestätigungsmail nicht versendet, Mandat', ergebnis.zeile.id);
        } catch (fehler) {
            console.error('[Mandat] Bestätigungsmail nicht versendet, Mandat', ergebnis.zeile.id, fehler?.message ?? '');
        }
    }
}

export function pruefeBasisUrlFuerBestaetigung(basisUrl, benutzer) {
    if (benutzer?.istAdminDesVereins !== true && !basisUrl) {
        throw new FachFehler(503, 'Die Bestätigungsmail kann nicht verschickt werden (PUBLIC_BASE_URL fehlt).');
    }
}

/**
 * Erteilt ein Mandat für eine bestehende Lastschrift-Zahlweg-Zeile (ersetzt ein aktives Mandat desselben Vereins).
 * @returns {Promise<{ mandat: object, bestaetigungNoetig: boolean }>}
 */
export async function erteileMandat(knex, { turnier, zahlwegZeile, eingabe, benutzer, ip = null, basisUrl = null, sende = sendeMail }) {
    if (!zahlwegZeile || zahlwegZeile.zahlweg !== 'lastschrift' || zahlwegZeile.turnier_id !== turnier?.id) {
        throw new FachFehler(400, 'Für ein Lastschriftmandat muss der Zahlweg Lastschrift gewählt sein.');
    }
    if (benutzer?.id == null) throw new FachFehler(400, 'Ohne Konto kann kein Mandat erteilt werden.');
    const daten = pruefeMandatsEingabe(eingabe);
    pruefeBasisUrlFuerBestaetigung(basisUrl, benutzer);
    const ergebnis = await knex.transaction(async (trx) => {
        await sperreMandate(trx, turnier.id, zahlwegZeile.verein_name);
        // Zeile erst NACH dem Lock neu laden: der Zahlweg kann sich seit dem Aufruf geändert haben (Wechsel/Löschung).
        const aktuell = await trx('turnier_zahlwege').where({ id: zahlwegZeile.id }).first();
        if (!aktuell || aktuell.zahlweg !== 'lastschrift' || aktuell.turnier_id !== turnier.id) {
            throw new FachFehler(409, 'Der Zahlweg wurde gerade geändert, bitte erneut versuchen.');
        }
        const r = await erteileMandatInTrx(trx, { turnier, zahlwegZeile: aktuell, daten, benutzer, ip });
        await synchronisiereGesichert(trx, turnier.id);
        return r;
    });
    await versendeBestaetigungen(ergebnis, basisUrl, sende);
    const vereinId = zahlwegZeile.verein_id ?? null;
    if (ergebnis.ersetztMandatId) {
        await protokolliereMandat(knex, { art: 'mandat.widerrufen', mandatId: ergebnis.ersetztMandatId, turnierId: turnier.id, benutzerId: benutzer.id, ip, vereinId });
    }
    await protokolliereMandat(knex, { art: 'mandat.erteilt', mandatId: ergebnis.zeile.id, turnierId: turnier.id, benutzerId: benutzer.id, ip, vereinId });
    return {
        mandat: mandatOeffentlich(ergebnis.zeile),
        bestaetigungNoetig: ergebnis.zeile.status === 'unbestaetigt',
        empfaengerAnzahl: ergebnis.mails.length
    };
}

async function mandatZuToken(knex, tokenZeile) {
    const mandatId = Number(tokenZeile?.bezug);
    if (!Number.isInteger(mandatId) || mandatId <= 0) return null;
    return (await knex('lastschrift_mandate').where({ id: mandatId }).first()) || null;
}

/** Anzeige der Bestätigungsseite: nur für einen gültigen Token zu einem noch offenen Mandat. */
export async function ladeMandatFuerToken(knex, token) {
    const tokenZeile = await pruefeToken(knex, token, 'mandat');
    if (!tokenZeile) return null;
    const mandat = await mandatZuToken(knex, tokenZeile);
    if (!mandat || mandat.status !== 'unbestaetigt') return null;
    return {
        mandat: mandatOeffentlich(mandat),
        mandatstext: mandat.mandatstext,
        vereinName: mandat.verein_name,
        turnierBezeichnung: mandat.turnier_bezeichnung
    };
}

/**
 * Entscheidung eines Admins über den Mail-Link. Die erste Entscheidung verbraucht alle Links des Mandats;
 * zurückgezogene oder schon entschiedene Mandate antworten 410 und werden nie wieder gültig.
 */
export async function entscheideMandat(knex, token, { entscheidung, vertretung_bestaetigt, ip = null } = {}) {
    if (!['bestaetigen', 'ablehnen'].includes(entscheidung)) throw new FachFehler(400, 'Ungültige Entscheidung.');
    if (entscheidung === 'bestaetigen' && vertretung_bestaetigt !== true) {
        throw new FachFehler(400, 'Bitte bestätigen, dass Sie berechtigt sind, den Verein zu vertreten.');
    }
    const vorab = await pruefeToken(knex, token, 'mandat');
    if (!vorab) {
        throw (await tokenBekannt(knex, token, 'mandat'))
            ? new FachFehler(410, MELDUNG_ENTSCHIEDEN)
            : new FachFehler(404, 'Dieser Link ist ungültig.');
    }
    const vorabMandat = await mandatZuToken(knex, vorab);
    if (!vorabMandat) throw new FachFehler(410, MELDUNG_ENTSCHIEDEN);

    const ergebnis = await knex.transaction(async (trx) => {
        await sperreMandate(trx, vorabMandat.turnier_id, vorabMandat.verein_name);
        const tokenZeile = await verbrauchePruefe(trx, token, 'mandat');
        if (!tokenZeile || String(tokenZeile.bezug) !== String(vorabMandat.id)) return null;
        const istAdmin = vorabMandat.zahlender_verein_id != null
            && !!(await adminAbfrage(trx, vorabMandat.zahlender_verein_id).where('benutzer.id', tokenZeile.benutzer_id).first('benutzer.id'));
        if (!istAdmin) throw new FachFehler(403, 'Nur ein Admin des Vereins kann über das Mandat entscheiden.'); // Rollback: Link bleibt
        const updates = entscheidung === 'bestaetigen'
            ? { status: 'gueltig', bestaetigt_am: trx.fn.now(), bestaetigt_von: String(tokenZeile.benutzer_id) }
            : { status: 'abgelehnt', daten_verschluesselt: null, loeschen_ab: berechneLoeschenAb(heuteBerlin()) };
        const [zeile] = await trx('lastschrift_mandate')
            .where({ id: vorabMandat.id, status: 'unbestaetigt' })
            .update({ ...updates, entschieden_am: trx.fn.now(), updated_at: trx.fn.now() })
            .returning('*');
        // Auch wenn das Mandat nicht mehr offen war: der Link bleibt verbraucht (Commit), Antwort 410.
        await verbraucheAlleZuBezug(trx, 'mandat', vorabMandat.id);
        if (!zeile) return null;
        zeile.entscheider_id = tokenZeile.benutzer_id;
        if (zeile.zahlweg_id != null) {
            await trx('turnier_zahlwege').where({ id: zeile.zahlweg_id })
                .update({ mandat_gueltig: zeile.status === 'gueltig', updated_at: trx.fn.now() });
        }
        if (zeile.turnier_id != null) await synchronisiereGesichert(trx, zeile.turnier_id);
        return zeile;
    });
    if (!ergebnis) throw new FachFehler(410, MELDUNG_ENTSCHIEDEN);
    await protokolliereMandat(knex, {
        art: 'mandat.entscheidung', mandatId: ergebnis.id, turnierId: ergebnis.turnier_id,
        benutzerId: ergebnis.entscheider_id, ip, vereinId: ergebnis.zahlender_verein_id
    });
    return mandatOeffentlich(ergebnis);
}

/**
 * Widerruft das aktive Mandat eines Vereins (L5/L12). Gibt false zurück, wenn es keines gab.
 */
export async function widerrufeMandat(knex, { turnierId, vereinName, benutzer = null, grund, ip = null }) {
    const mandatId = await knex.transaction(async (trx) => {
        await sperreMandate(trx, turnierId, vereinName);
        const id = await widerrufeMandatInTrx(trx, { turnierId, vereinName, benutzer, grund });
        if (id) await synchronisiereGesichert(trx, turnierId);
        return id;
    });
    if (!mandatId) return false;
    await protokolliereMandat(knex, { art: 'mandat.widerrufen', mandatId, turnierId, benutzerId: benutzer?.id ?? null, ip });
    return true;
}

/** Klar-IBAN und Kontoinhaber, nur für die SEPA-Datei. */
export async function ladeMandatIban(knex, mandatId) {
    const zeile = await knex('lastschrift_mandate').where({ id: mandatId }).first('id', 'daten_verschluesselt');
    if (!zeile) throw new FachFehler(404, 'Mandat nicht gefunden.');
    if (!zeile.daten_verschluesselt) throw new FachFehler(409, 'Für dieses Mandat liegen keine Kontodaten mehr vor.');
    const daten = JSON.parse(entschluesseleFeld(zeile.daten_verschluesselt));
    return { iban: daten.iban, kontoinhaber: daten.kontoinhaber };
}
