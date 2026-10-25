// Rechnungslauf (Startgeld Stufe 2): je meldendem Verein eine Rechnung bzw. Quittung als PDF, per Mail an die
// Rechnungs-E-Mail. Nur Cloud; Zugriff prüfen die Routen (requireTurnierAdmin).
//
// Grundsätze:
//  - Rechnungen sind Belege: einmal angelegt, werden sie nie geändert oder gelöscht (nur Versand- und Zahlstatus).
//    Weicht der aktuelle Stand später ab (z. B. nach ordneVereinZu), wird das nur gemeldet ("hinweise").
//  - Nummern lückenlos je Aussteller-Verein: Zähler (vereins_abrechnung, FOR UPDATE) und Einfügen in EINER Transaktion,
//    das PDF entsteht ebenfalls darin aus der Momentaufnahme. Scheitert etwas davor, wird keine Nummer verbraucht.
//  - Mail erst nach dem Commit; scheitert sie, bleibt die Rechnung mit versand_fehler stehen und wird erneut gesendet.
//  - Die Klartext-IBAN steht nur im PDF, nie in Momentaufnahme, Mailtext, Fehlermeldung oder Log.
import { FachFehler } from '../utils/fachFehler.js';
import { sendeMail } from '../utils/mailer.js';
import {
    zaehleKaempferJeVerein, formatiereRechnungsnummer, baueVerwendungszweck, addiereTage, heuteBerlin,
    rechnungsArt, rechnungsAnzeigeStatus
} from '../shared/abrechnung.js';
import { ladeAbrechnung } from './abrechnung.js';
import { ladeStammdaten, ermittleZahlungsempfaenger } from './abrechnungStammdaten.js';
import { erzeugeRechnungPdf, euro, datum, berechneOffenCent } from './rechnungPdf.js';
import { maskiereIban } from '../shared/iban.js';

const normName = (s) => String(s ?? '').trim().toLowerCase();

// Spalten einer Rechnung für API-Antworten (ohne PDF).
const RECHNUNG_SPALTEN = [
    'id', 'turnier_id', 'verein_name', 'zahlweg', 'art', 'nummer', 'anzahl', 'einzelpreis_cent', 'betrag_cent', 'bar_erhalten_cent',
    'status', 'versandt_am', 'versand_fehler', 'bezahlt_am', 'bezahlt_von', 'erstellt_von', 'created_at'
];

function selectRechnung(knex) {
    return [
        ...RECHNUNG_SPALTEN,
        knex.raw("to_char(rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum"),
        knex.raw("to_char(zahlungsziel_datum, 'YYYY-MM-DD') as zahlungsziel_datum")
    ];
}

/** Datum (pg-DATE als Text oder als lokales Date) -> 'YYYY-MM-DD'. */
function isoDatum(wert) {
    if (wert == null || wert === '') return null;
    if (wert instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${wert.getFullYear()}-${p(wert.getMonth() + 1)}-${p(wert.getDate())}`;
    }
    return String(wert).slice(0, 10);
}

function versandFehlerText(grund) {
    if (grund === 'kein_smtp') return 'Kein Mailserver eingerichtet (SMTP_HOST fehlt). Die Rechnung kann heruntergeladen oder später erneut gesendet werden.';
    if (grund === 'keine_email') return 'Für den Verein ist keine Rechnungs-E-Mail hinterlegt.';
    return 'Der Mailversand ist fehlgeschlagen. Bitte später erneut senden.';
}

async function ladeKonto(knex, turnier) {
    let konto;
    try {
        konto = await ermittleZahlungsempfaenger(knex, turnier);
    } catch (err) {
        // Schlüssel fehlt oder wurde getauscht: verständlich melden statt 500 (die Meldung enthält nie Zahlungsdaten).
        const grund = err instanceof FachFehler && err.statusCode === 503
            ? 'der Schlüssel für Zahlungsdaten fehlt (ZAHLUNGSDATEN_SCHLUESSEL)'
            : 'die IBAN lässt sich mit dem eingestellten Schlüssel nicht entschlüsseln';
        throw new FachFehler(409, `Konto des Ausrichters nicht lesbar: ${grund}.`);
    }
    if (!konto) throw new FachFehler(409, 'Konto des Ausrichters nicht lesbar: es ist kein Konto hinterlegt.');
    return konto;
}

// RechnungsDaten (rechnungPdf.js) aus der gespeicherten Momentaufnahme; die IBAN kommt nur zum Zeichnen hinzu.
function pdfDaten(zeile, { iban = null, barDatum = null } = {}) {
    const a = zeile.aussteller || {};
    const e = zeile.empfaenger || {};
    const daten = {
        art: zeile.art,
        nummer: zeile.nummer,
        rechnungsdatum: isoDatum(zeile.rechnungsdatum),
        leistungsdatum: isoDatum(zeile.leistungsdatum),
        zahlungszielDatum: isoDatum(zeile.zahlungsziel_datum),
        turnierBezeichnung: zeile.turnier_bezeichnung,
        aussteller: {
            name: a.name, anschrift: a.anschrift, rechnung_email: a.rechnung_email,
            steuernummer: a.steuernummer, ust_id: a.ust_id, ust_hinweis: a.ust_hinweis
        },
        empfaenger: { name: e.name, ansprechperson: e.ansprechperson, anschrift: e.anschrift },
        kaempfer: (zeile.positionen || []).map((k) => k.name),
        anzahl: zeile.anzahl,
        einzelpreisCent: zeile.einzelpreis_cent,
        betragCent: zeile.betrag_cent,
        barErhaltenCent: zeile.bar_erhalten_cent,
        zahlweg: zeile.zahlweg,
        zahlung: null,
        hinweis: zeile.hinweis || null,
        barDatum
    };
    if (daten.art !== 'quittung' && berechneOffenCent(daten) > 0) {
        if (!iban) throw new FachFehler(409, 'Konto des Ausrichters nicht lesbar: es ist kein Konto hinterlegt.');
        daten.zahlung = { kontoinhaber: a.kontoinhaber, iban, verwendungszweck: zeile.verwendungszweck };
    }
    return daten;
}

function baueMail(zeile) {
    const a = zeile.aussteller || {};
    const e = zeile.empfaenger || {};
    const istQuittung = zeile.art === 'quittung';
    const wort = istQuittung ? 'Quittung' : 'Rechnung';
    const offen = Math.max(0, zeile.betrag_cent - zeile.bar_erhalten_cent);
    const zeilen = [
        `Guten Tag${e.ansprechperson ? ` ${e.ansprechperson}` : ''},`,
        '',
        `anbei erhalten Sie die ${wort} ${zeile.nummer} über das Startgeld für „${zeile.turnier_bezeichnung}“ `
            + `(${zeile.anzahl} Kämpfer, ${euro(zeile.betrag_cent)}).`
    ];
    if (istQuittung || offen === 0) {
        zeilen.push('Der Betrag wurde bereits bezahlt.');
    } else {
        const bis = zeile.zahlungsziel_datum ? ` bis zum ${datum(isoDatum(zeile.zahlungsziel_datum))}` : '';
        const betrag = offen < zeile.betrag_cent ? `den offenen Betrag von ${euro(offen)}` : 'den Betrag';
        zeilen.push(`Bitte überweisen Sie ${betrag}${bis}. Bankverbindung, Verwendungszweck und Girocode finden Sie in der Rechnung.`);
    }
    zeilen.push('', 'Bei Fragen antworten Sie bitte direkt auf diese E-Mail.', '', 'Mit freundlichen Grüßen', a.absender_name || a.name || '');
    return {
        to: e.email,
        subject: `${wort} ${zeile.nummer} – ${zeile.turnier_bezeichnung}`,
        text: zeilen.join('\n'),
        replyTo: a.rechnung_email || null,
        absenderName: a.absender_name || null,
        anhaenge: [{ dateiname: `${zeile.nummer}.pdf`, inhalt: Buffer.from(zeile.pdf), typ: 'application/pdf' }]
    };
}

// Versendet eine gespeicherte Rechnung (gespeichertes PDF) und hält das Ergebnis fest. Wirft nie wegen der Mail.
async function versende(knex, rechnungId, sende) {
    const zeile = await knex('rechnungen').where({ id: rechnungId }).first();
    if (!zeile) throw new FachFehler(404, 'Rechnung nicht gefunden.');
    if (!zeile.pdf) throw new FachFehler(409, 'Zu dieser Rechnung liegt kein PDF vor.');
    let ergebnis;
    if (!zeile.empfaenger?.email) {
        ergebnis = { versendet: false, grund: 'keine_email' };
    } else {
        try {
            ergebnis = (await sende(baueMail(zeile))) ?? { versendet: true, grund: null };
        } catch (err) {
            console.error('[Rechnungslauf] Mailversand fehlgeschlagen:', err?.message ?? 'Fehler');
            ergebnis = { versendet: false, grund: 'fehler' };
        }
    }
    if (ergebnis.versendet) {
        // offen -> versandt; bezahlt (Quittung oder schon als bezahlt markiert) bleibt bezahlt.
        await knex('rechnungen').where({ id: rechnungId }).update({
            versandt_am: knex.fn.now(),
            versand_fehler: null,
            status: knex.raw("CASE WHEN status = 'offen' THEN 'versandt' ELSE status END"),
            updated_at: knex.fn.now()
        });
        return { versendet: true, grund: null };
    }
    const fehlerText = versandFehlerText(ergebnis.grund);
    await knex('rechnungen').where({ id: rechnungId }).update({ versand_fehler: fehlerText, updated_at: knex.fn.now() });
    return { versendet: false, grund: fehlerText };
}

// Legt die Rechnung eines Vereins an (eigene Transaktion). Gibt die neue ID zurück oder null, wenn es schon eine gibt.
async function legeRechnungAn(knex, { turnier, vereinEintrag, zahlwegZeile, kopf, konto, barDatum, bezahltAm, benutzerId }) {
    return knex.transaction(async (trx) => {
        // Serialisiert Läufe desselben Turniers; der Zähler wird zusätzlich je Verein gesperrt (Läufe anderer Turniere).
        await trx.raw('SELECT pg_advisory_xact_lock(?)', [turnier.id]);
        const vorhanden = await trx('rechnungen')
            .where({ turnier_id: turnier.id }).whereNot('status', 'zurueckgebucht')
            .whereRaw('lower(trim(verein_name)) = ?', [normName(zahlwegZeile.verein_name)])
            .first('id');
        if (vorhanden) return null;
        const zaehler = await trx('vereins_abrechnung').where({ verein_id: turnier.verein_id }).forUpdate()
            .first('naechste_rechnungsnummer', 'rechnungs_praefix');
        if (!zaehler || !zaehler.rechnungs_praefix) throw new FachFehler(409, 'Die Abrechnungsdaten des Ausrichters sind unvollständig.');
        const nummer = formatiereRechnungsnummer(zaehler.rechnungs_praefix, zaehler.naechste_rechnungsnummer);

        const { anzahl, bezahltAnzahl, kaempfer } = vereinEintrag;
        const art = rechnungsArt({ zahlweg: zahlwegZeile.zahlweg, anzahl, bezahltAnzahl });
        const betrag = anzahl * kopf.einzelpreisCent;
        // Bar: bereits kassierte Kämpfer (startgeld_bezahlt) werden angerechnet, der Rest wird überwiesen (E9).
        const barErhalten = zahlwegZeile.zahlweg === 'bar' ? Math.min(bezahltAnzahl, anzahl) * kopf.einzelpreisCent : 0;
        const zeile = {
            turnier_id: turnier.id,
            aussteller_verein_id: turnier.verein_id,
            verein_name: zahlwegZeile.verein_name,
            zahlweg: zahlwegZeile.zahlweg,
            art,
            nummer,
            rechnungsdatum: kopf.rechnungsdatum,
            leistungsdatum: kopf.leistungsdatum,
            zahlungsziel_datum: art === 'quittung' ? null : addiereTage(kopf.rechnungsdatum, kopf.zahlungszielTage),
            anzahl,
            einzelpreis_cent: kopf.einzelpreisCent,
            betrag_cent: betrag,
            bar_erhalten_cent: barErhalten,
            positionen: kaempfer.map((k) => ({ name: k.name, judopass_id: k.judopass_id })),
            empfaenger: {
                name: zahlwegZeile.verein_name,
                ansprechperson: zahlwegZeile.rechnung_ansprechperson || null,
                anschrift: zahlwegZeile.rechnung_anschrift || null,
                email: zahlwegZeile.rechnung_email || null
            },
            aussteller: kopf.aussteller,
            turnier_bezeichnung: kopf.turnierBezeichnung,
            verwendungszweck: art === 'quittung' ? null : baueVerwendungszweck(turnier.verwendungszweck, {
                turnierName: kopf.turnierBezeichnung, vereinName: zahlwegZeile.verein_name, rechnungsnummer: nummer
            }),
            hinweis: kopf.hinweis,
            status: art === 'quittung' ? 'bezahlt' : 'offen',
            bezahlt_am: art === 'quittung' ? bezahltAm : null,
            erstellt_von: benutzerId ?? null
        };
        const pdf = await erzeugeRechnungPdf(pdfDaten(zeile, { iban: konto?.iban ?? null, barDatum }));
        const [neu] = await trx('rechnungen').insert({
            ...zeile,
            positionen: JSON.stringify(zeile.positionen),
            empfaenger: JSON.stringify(zeile.empfaenger),
            aussteller: JSON.stringify(zeile.aussteller),
            pdf: Buffer.from(pdf)
        }).returning('id');
        await trx('vereins_abrechnung').where({ verein_id: turnier.verein_id }).update({
            naechste_rechnungsnummer: zaehler.naechste_rechnungsnummer + 1, updated_at: trx.fn.now()
        });
        return typeof neu === 'object' ? neu.id : neu;
    });
}

/**
 * Erstellt für alle Vereine mit gezählten Kämpfern und ohne aktive Rechnung eine Rechnung/Quittung und versendet sie.
 * @returns {Promise<{ erstellt: number, versendet: number, fehler: Array<{ vereinName: string, grund: string }>,
 *   hinweise: Array<{ vereinName: string, grund: string }> }>}
 */
export async function erstelleRechnungen(knex, { turnier, benutzerId, sende = sendeMail }) {
    const abrechnung = await ladeAbrechnung(knex, turnier);
    if (!abrechnung.bereit) throw new FachFehler(409, abrechnung.grund || 'Die Abrechnung ist noch nicht möglich.');
    if (!abrechnung.stammdaten.vollstaendig) {
        throw new FachFehler(409, `Die Abrechnungsdaten des Ausrichters sind unvollständig: ${abrechnung.stammdaten.fehlt.join(', ')}.`);
    }
    if (abrechnung.nichtZugeordnet.length > 0) {
        throw new FachFehler(409, 'Es gibt Kämpfer, die keinem meldenden Verein zugeordnet sind (Nicht zugeordnet). Bitte zuerst zuordnen oder Rechnungsdaten erfassen.');
    }

    const hinweise = abrechnung.vereine
        .filter((v) => v.rechnungWeichtAb)
        .map((v) => ({
            vereinName: v.vereinName,
            grund: `Rechnung weicht ab: ${v.anzahl} statt ${v.rechnung.anzahl} Kämpfer (${euro(v.betragCent)} statt ${euro(v.rechnung.betrag_cent)}).`
        }));
    const offeneVereine = new Set(abrechnung.vereine.filter((v) => v.anzahl > 0 && !v.rechnung).map((v) => normName(v.vereinName)));
    const ergebnis = { erstellt: 0, versendet: 0, fehler: [], hinweise };
    if (offeneVereine.size === 0) return ergebnis;

    // Kämpferliste je Verein mit derselben Zählung wie die Übersicht.
    const ausrichter = turnier.verein_id ? await knex('vereine').where({ id: turnier.verein_id }).first('name') : null;
    const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id });
    const zaehlung = zaehleKaempferJeVerein(teilnehmer, { basis: abrechnung.basis, ausrichterName: ausrichter?.name ?? null });
    const zahlwege = new Map();
    for (const z of await knex('turnier_zahlwege').where({ turnier_id: turnier.id }).orderBy('id')) {
        if (!zahlwege.has(normName(z.verein_name))) zahlwege.set(normName(z.verein_name), z);
    }
    const kandidaten = [...offeneVereine]
        .map((k) => ({ schluessel: k, zahlwegZeile: zahlwege.get(k), vereinEintrag: zaehlung.get(k) }))
        .filter((k) => k.zahlwegZeile && k.vereinEintrag && k.vereinEintrag.anzahl > 0)
        .sort((x, y) => x.zahlwegZeile.verein_name.localeCompare(y.zahlwegZeile.verein_name, 'de'));

    // Konto nur nötig, wenn nicht alles Bar-Quittungen sind.
    const brauchtKonto = kandidaten.some((k) => rechnungsArt({ zahlweg: k.zahlwegZeile.zahlweg, ...k.vereinEintrag }) !== 'quittung');
    const konto = brauchtKonto ? await ladeKonto(knex, turnier) : null;

    const stammdaten = await ladeStammdaten(knex, turnier.verein_id);
    const kopf = {
        rechnungsdatum: heuteBerlin(),
        leistungsdatum: isoDatum(turnier.datum),
        zahlungszielTage: Number.isInteger(turnier.zahlungsziel_tage) ? turnier.zahlungsziel_tage : 14,
        einzelpreisCent: abrechnung.startgeldCent,
        turnierBezeichnung: turnier.bezeichnung,
        hinweis: turnier.rechnung_hinweis || null,
        aussteller: {
            verein_id: turnier.verein_id,
            name: ausrichter?.name || turnier.ausrichter || stammdaten.absender_name,
            anschrift: stammdaten.anschrift,
            rechnung_email: stammdaten.rechnung_email,
            absender_name: stammdaten.absender_name,
            steuernummer: stammdaten.steuernummer || null,
            ust_id: stammdaten.ust_id || null,
            ust_hinweis: stammdaten.ust_hinweis,
            kontoinhaber: konto?.kontoinhaber ?? null,
            iban_maske: konto ? maskiereIban(konto.iban) : null
        }
    };

    // Jüngste Barzahlung je Verein (Quittungsdatum).
    const barJe = new Map();
    for (const b of await knex('turnier_barzahlungen').where({ turnier_id: turnier.id }).select('verein_name', 'kassiert_am')) {
        const k = normName(b.verein_name);
        const zeit = new Date(b.kassiert_am);
        if (!barJe.has(k) || barJe.get(k) < zeit) barJe.set(k, zeit);
    }

    const neueIds = [];
    for (const k of kandidaten) {
        const kassiert = barJe.get(k.schluessel) ?? null;
        try {
            const neu = await legeRechnungAn(knex, {
                turnier, vereinEintrag: k.vereinEintrag, zahlwegZeile: k.zahlwegZeile, kopf, konto,
                barDatum: kassiert ? heuteBerlin(kassiert) : null,
                bezahltAm: kassiert ?? new Date(),
                benutzerId
            });
            if (neu != null) { neueIds.push({ id: neu, vereinName: k.zahlwegZeile.verein_name }); ergebnis.erstellt += 1; }
        } catch (err) {
            if (err instanceof FachFehler && err.statusCode === 409) throw err;
            console.error('[Rechnungslauf] Rechnung nicht erstellt:', err?.code ?? '', err?.message ?? 'Fehler');
            ergebnis.fehler.push({ vereinName: k.zahlwegZeile.verein_name, grund: 'Die Rechnung konnte nicht erstellt werden.' });
        }
    }

    for (const { id, vereinName } of neueIds) {
        const v = await versende(knex, id, sende);
        if (v.versendet) ergebnis.versendet += 1;
        else ergebnis.fehler.push({ vereinName, grund: v.grund });
    }
    return ergebnis;
}

export async function sendeRechnungErneut(knex, rechnungId, { sende = sendeMail } = {}) {
    const { versendet, grund } = await versende(knex, rechnungId, sende);
    return { versendet, grund };
}

/** Zahlstatus von Hand: bezahlt -> 'bezahlt'; zurück -> 'versandt' bzw. 'offen' (ohne Versand). Quittungen bleiben bezahlt. */
export async function setzeBezahlt(knex, rechnungId, { bezahlt, benutzerId }) {
    if (typeof bezahlt !== 'boolean') throw new FachFehler(400, 'Bitte angeben, ob die Rechnung bezahlt ist (bezahlt: true/false).');
    const zeile = await knex('rechnungen').where({ id: rechnungId }).first('id', 'art', 'status', 'versandt_am');
    if (!zeile) throw new FachFehler(404, 'Rechnung nicht gefunden.');
    if (zeile.status === 'zurueckgebucht') throw new FachFehler(409, 'Eine zurückgebuchte Rechnung kann nicht geändert werden.');
    if (!bezahlt && zeile.art === 'quittung') throw new FachFehler(400, 'Eine Quittung ist immer bezahlt.');
    const werte = bezahlt
        ? { status: 'bezahlt', bezahlt_am: knex.fn.now(), bezahlt_von: benutzerId ?? null }
        : { status: zeile.versandt_am ? 'versandt' : 'offen', bezahlt_am: null, bezahlt_von: null };
    if (!(bezahlt && zeile.status === 'bezahlt')) {
        await knex('rechnungen').where({ id: rechnungId }).update({ ...werte, updated_at: knex.fn.now() });
    }
    const neu = await knex('rechnungen').where({ id: rechnungId }).select(selectRechnung(knex)).first();
    return { ...neu, anzeigeStatus: rechnungsAnzeigeStatus(neu, heuteBerlin()) };
}

/** PDF einer Rechnung (gespeicherte Momentaufnahme). */
export async function ladeRechnungPdf(knex, rechnungId) {
    const zeile = await knex('rechnungen').where({ id: rechnungId }).first('nummer', 'pdf');
    if (!zeile || !zeile.pdf) throw new FachFehler(404, 'Rechnung nicht gefunden.');
    return { nummer: zeile.nummer, pdf: zeile.pdf };
}
