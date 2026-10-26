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
//  - Lastschrift (Stufe 3): die Rechnung ist zugleich die Vorabankündigung (Einzugsdatum, Mandatsreferenz, Gläubiger-ID,
//    IBAN des Zahlers NUR maskiert). Sie braucht kein Konto des Ausrichters, aber ein gültiges Mandat; bezahlte Kämpfer
//    werden nicht angerechnet (E9).
import { FachFehler } from '../utils/fachFehler.js';
import { sendeMail } from '../utils/mailer.js';
import {
    zaehleKaempferJeVerein, formatiereRechnungsnummer, baueVerwendungszweck, addiereTage, heuteBerlin,
    rechnungsArt, rechnungsAnzeigeStatus, angerechneterBetragCent
} from '../shared/abrechnung.js';
import { fruehestesFaelligkeitsdatum } from '../shared/targetKalender.js';
import { ladeAbrechnung, vereineOhneGueltigesMandat, mandatSperrText, glaeubigerIdGeaendertText } from './abrechnung.js';
import { ladeStammdaten, ermittleZahlungsempfaenger } from './abrechnungStammdaten.js';
import { erzeugeRechnungPdf, euro, datum, berechneOffenCent } from './rechnungPdf.js';
import { maskiereIban } from '../shared/iban.js';
import { ladeAusrichterNamen } from './zahlwegTransfer.js';
import { sperreMandate, widerrufeMandatInTrx, ladeEffektivenTurnierStatus, protokolliereMandat } from './mandate.js';
import { synchronisiereGesichert } from './zahlwege.js';

const normName = (s) => String(s ?? '').trim().toLowerCase();
const mandatFehltText = (vereinName) => mandatSperrText({ vereinName, hinweisCode: 'mandat' });

// Spalten einer Rechnung für API-Antworten (ohne PDF).
const RECHNUNG_SPALTEN = [
    'id', 'turnier_id', 'verein_name', 'zahlweg', 'art', 'nummer', 'anzahl', 'einzelpreis_cent', 'betrag_cent', 'bar_erhalten_cent',
    'status', 'versandt_am', 'versand_fehler', 'bezahlt_am', 'bezahlt_von', 'erstellt_von', 'created_at',
    'mandatsreferenz', 'iban_maske_zahler', 'sepa_datei_id'
];

function selectRechnung(knex) {
    return [
        ...RECHNUNG_SPALTEN,
        knex.raw("to_char(rechnungsdatum, 'YYYY-MM-DD') as rechnungsdatum"),
        knex.raw("to_char(zahlungsziel_datum, 'YYYY-MM-DD') as zahlungsziel_datum"),
        knex.raw("to_char(einzug_am, 'YYYY-MM-DD') as einzug_am")
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
export function rechnungsDatenAusZeile(zeile, { iban = null, barDatum = null } = {}) {
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
        barDatum,
        lastschrift: null
    };
    if (daten.zahlweg === 'lastschrift' && daten.art !== 'quittung') {
        // Kein Konto des Ausrichters nötig: eingezogen wird vom Konto des Zahlers (nur maskiert in der Rechnung).
        const lastschrift = {
            mandatsreferenz: zeile.mandatsreferenz,
            mandatDatum: isoDatum(zeile.mandat_datum),
            glaeubigerId: a.glaeubiger_id,
            ibanMaske: zeile.iban_maske_zahler,
            einzugAm: isoDatum(zeile.einzug_am)
        };
        if (Object.values(lastschrift).some((w) => w == null || w === '')) {
            throw new FachFehler(409, 'Die Lastschriftangaben der Rechnung sind unvollständig.');
        }
        daten.lastschrift = lastschrift;
        return daten;
    }
    if (daten.art !== 'quittung' && berechneOffenCent(daten) > 0) {
        if (!iban) throw new FachFehler(409, 'Konto des Ausrichters nicht lesbar: es ist kein Konto hinterlegt.');
        daten.zahlung = { kontoinhaber: a.kontoinhaber, iban, verwendungszweck: zeile.verwendungszweck };
    }
    return daten;
}

/** Mail zu einer gespeicherten Rechnung (rein). Bezahlte Rechnungen und Quittungen verlangen keine Überweisung. */
export function baueRechnungsMail(zeile) {
    const a = zeile.aussteller || {};
    const e = zeile.empfaenger || {};
    const istQuittung = zeile.art === 'quittung';
    const istLastschrift = zeile.zahlweg === 'lastschrift' && !istQuittung;
    const wort = istQuittung ? 'Quittung' : 'Rechnung';
    const offen = Math.max(0, zeile.betrag_cent - zeile.bar_erhalten_cent);
    const zeilen = [
        `Guten Tag${e.ansprechperson ? ` ${e.ansprechperson}` : ''},`,
        '',
        `anbei erhalten Sie die ${wort} ${zeile.nummer} über das Startgeld für „${zeile.turnier_bezeichnung}“ `
            + `(${zeile.anzahl} Kämpfer, ${euro(zeile.betrag_cent)}).`
    ];
    if (istQuittung || offen === 0 || zeile.status === 'bezahlt') {
        zeilen.push('Der Betrag wurde bereits bezahlt.');
    } else if (istLastschrift) {
        // Vorabankündigung: Datum, Betrag, maskierte IBAN; nie die Klar-IBAN.
        zeilen.push(`Der Betrag von ${euro(offen)} wird am ${datum(isoDatum(zeile.einzug_am))} per SEPA-Lastschrift von Ihrem Konto `
            + `${zeile.iban_maske_zahler} eingezogen (Mandatsreferenz ${zeile.mandatsreferenz}, Gläubiger-ID ${a.glaeubiger_id}). `
            + 'Sie müssen nichts weiter tun; bitte sorgen Sie nur für ausreichende Deckung des Kontos.');
    } else {
        const bis = zeile.zahlungsziel_datum ? ` bis zum ${datum(isoDatum(zeile.zahlungsziel_datum))}` : '';
        const betrag = offen < zeile.betrag_cent ? `den offenen Betrag von ${euro(offen)}` : 'den Betrag';
        zeilen.push(`Bitte überweisen Sie ${betrag}${bis}. Bankverbindung, Verwendungszweck und Girocode finden Sie in der Rechnung.`);
    }
    zeilen.push('', 'Bei Fragen antworten Sie bitte direkt auf diese E-Mail.', '', 'Mit freundlichen Grüßen', a.absender_name || a.name || '');
    return {
        to: e.email,
        subject: `${wort} ${zeile.nummer} – ${zeile.turnier_bezeichnung}${istLastschrift ? ' (Einzug per Lastschrift)' : ''}`,
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
            // Nur ein ausdrückliches versendet:false (oder ein Fehler) gilt als gescheitert; ältere Sender geben nichts zurück.
            const antwort = await sende(baueRechnungsMail(zeile));
            ergebnis = antwort && antwort.versendet === false ? antwort : { versendet: true, grund: null };
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
async function legeRechnungAn(knex, { turnier, vereinEintrag, zahlwegZeile, kopf, konto, barDatum, bezahltAm, benutzerId, erzeugePdf }) {
    return knex.transaction(async (trx) => {
        // Serialisiert Läufe desselben Turniers (eigener Namensraum, unabhängig von den Sperren in zahlwege.js);
        // der Zähler wird zusätzlich je Verein gesperrt (Läufe anderer Turniere desselben Ausrichters).
        await trx.raw("SELECT pg_advisory_xact_lock(hashtext('rechnungslauf'), ?)", [turnier.id]);
        const vorhanden = await trx('rechnungen')
            .where({ turnier_id: turnier.id }).whereNot('status', 'zurueckgebucht')
            .whereRaw('lower(trim(verein_name)) = ?', [normName(zahlwegZeile.verein_name)])
            .first('id');
        if (vorhanden) return null;
        // Lastschrift: das Mandat muss JETZT gültig sein (in der Transaktion gelesen und gegen gleichzeitigen Widerruf
        // gesperrt; ein Widerruf wartet bis nach dem Commit). Sonst 409 ohne verbrauchte Nummer.
        let mandat = null;
        if (zahlwegZeile.zahlweg === 'lastschrift') {
            mandat = await trx('lastschrift_mandate')
                .where({ turnier_id: turnier.id, zahlweg_id: zahlwegZeile.id, status: 'gueltig' })
                .forShare().first('id', 'mandatsreferenz', 'iban_maske', 'erteilt_am', 'glaeubiger_id');
            const merker = await trx('turnier_zahlwege').where({ id: zahlwegZeile.id }).first('zahlweg', 'mandat_gueltig');
            if (!mandat || merker?.zahlweg !== 'lastschrift' || merker.mandat_gueltig !== true) {
                throw new FachFehler(409, mandatFehltText(zahlwegZeile.verein_name));
            }
            // Maßgeblich ist die im Mandat zugesagte Gläubiger-ID; weicht die der Rechnung ab: 409, keine Nummer.
            if (mandat.glaeubiger_id !== kopf.aussteller.glaeubiger_id) {
                throw new FachFehler(409, glaeubigerIdGeaendertText(zahlwegZeile.verein_name));
            }
        }
        const zaehler = await trx('vereins_abrechnung').where({ verein_id: turnier.verein_id }).forUpdate()
            .first('naechste_rechnungsnummer', 'rechnungs_praefix', 'glaeubiger_id');
        if (!zaehler || !zaehler.rechnungs_praefix) throw new FachFehler(409, 'Die Abrechnungsdaten des Ausrichters sind unvollständig.');
        // Stammdaten seit Laufbeginn geändert (Zeile ist jetzt gesperrt): ebenfalls vor dem Hochzählen abbrechen.
        if (mandat && zaehler.glaeubiger_id !== mandat.glaeubiger_id) {
            throw new FachFehler(409, glaeubigerIdGeaendertText(zahlwegZeile.verein_name));
        }
        const nummer = formatiereRechnungsnummer(zaehler.rechnungs_praefix, zaehler.naechste_rechnungsnummer);

        const { anzahl, bezahltAnzahl, kaempfer } = vereinEintrag;
        const art = rechnungsArt({ zahlweg: zahlwegZeile.zahlweg, anzahl, bezahltAnzahl });
        const betrag = anzahl * kopf.einzelpreisCent;
        // Bereits bezahlte Kämpfer (startgeld_bezahlt) werden bei jedem Zahlweg angerechnet (außer Lastschrift),
        // der Rest wird überwiesen (E9, Entscheidung im Review: auch bei Überweisung).
        const barErhalten = angerechneterBetragCent({ zahlweg: zahlwegZeile.zahlweg, anzahl, bezahltAnzahl }, kopf.einzelpreisCent);
        const zeile = {
            turnier_id: turnier.id,
            aussteller_verein_id: turnier.verein_id,
            verein_name: zahlwegZeile.verein_name,
            zahlweg: zahlwegZeile.zahlweg,
            art,
            nummer,
            rechnungsdatum: kopf.rechnungsdatum,
            leistungsdatum: kopf.leistungsdatum,
            zahlungsziel_datum: art === 'quittung' || mandat ? null : addiereTage(kopf.rechnungsdatum, kopf.zahlungszielTage),
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
            erstellt_von: benutzerId ?? null,
            ...(mandat ? {
                mandat_id: mandat.id,
                mandatsreferenz: mandat.mandatsreferenz,
                mandat_datum: heuteBerlin(new Date(mandat.erteilt_am)),
                iban_maske_zahler: mandat.iban_maske,
                // L7: die Rechnung ist die Vorabankündigung; frühestens nach der Frist und nie vor dem nächsten Geschäftstag.
                einzug_am: fruehestesFaelligkeitsdatum(kopf.rechnungsdatum, kopf.vorabTage, heuteBerlin())
            } : {})
        };
        const pdf = await erzeugePdf(rechnungsDatenAusZeile(zeile, { iban: konto?.iban ?? null, barDatum }));
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
export async function erstelleRechnungen(knex, { turnier, benutzerId, sende = sendeMail, erzeugePdf = erzeugeRechnungPdf }) {
    const abrechnung = await ladeAbrechnung(knex, turnier);
    if (!abrechnung.bereit) throw new FachFehler(409, abrechnung.grund || 'Die Abrechnung ist noch nicht möglich.');
    if (!abrechnung.stammdaten.vollstaendig) {
        throw new FachFehler(409, `Die Abrechnungsdaten des Ausrichters sind unvollständig: ${abrechnung.stammdaten.fehlt.join(', ')}.`);
    }
    if (abrechnung.nichtZugeordnet.length > 0) {
        throw new FachFehler(409, 'Es gibt Kämpfer, die keinem meldenden Verein zugeordnet sind (Nicht zugeordnet). Bitte zuerst zuordnen oder Rechnungsdaten erfassen.');
    }

    const ohneMandat = vereineOhneGueltigesMandat(abrechnung);
    if (ohneMandat.length > 0) throw new FachFehler(409, ohneMandat.map(mandatSperrText).join(' '));

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
    // TODO: Zählung und Zahlweg-Zuordnung doppeln ladeAbrechnung; besser liefert ladeAbrechnung die Kämpferliste mit.
    const ausrichter = turnier.verein_id ? await knex('vereine').where({ id: turnier.verein_id }).first('name') : null;
    const ausrichterNamen = [...(await ladeAusrichterNamen(knex, turnier.id))];
    const teilnehmer = await knex('turnier_teilnehmer').where({ turnier_id: turnier.id });
    const zaehlung = zaehleKaempferJeVerein(teilnehmer, { basis: abrechnung.basis, ausrichterName: ausrichter?.name ?? null, ausrichterNamen });
    const zahlwege = new Map();
    for (const z of await knex('turnier_zahlwege').where({ turnier_id: turnier.id }).orderBy('id')) {
        if (!zahlwege.has(normName(z.verein_name))) zahlwege.set(normName(z.verein_name), z);
    }
    const kandidaten = [...offeneVereine]
        .map((k) => ({ schluessel: k, zahlwegZeile: zahlwege.get(k), vereinEintrag: zaehlung.get(k) }))
        .filter((k) => k.zahlwegZeile && k.vereinEintrag && k.vereinEintrag.anzahl > 0)
        .sort((x, y) => x.zahlwegZeile.verein_name.localeCompare(y.zahlwegZeile.verein_name, 'de'));

    // Konto nur nötig für Rechnungen mit Überweisung/Bar-Rest (nicht für Quittungen und nicht für Lastschrift: dort zieht
    // der Ausrichter vom Konto des Zahlers ein, sein eigenes Konto braucht erst die SEPA-Datei).
    const brauchtKonto = kandidaten.some((k) => k.zahlwegZeile.zahlweg !== 'lastschrift'
        && rechnungsArt({ zahlweg: k.zahlwegZeile.zahlweg, ...k.vereinEintrag }) !== 'quittung');
    const konto = brauchtKonto ? await ladeKonto(knex, turnier) : null;

    const stammdaten = await ladeStammdaten(knex, turnier.verein_id);
    if (kandidaten.some((k) => k.zahlwegZeile.zahlweg === 'lastschrift') && !stammdaten?.glaeubiger_id) {
        throw new FachFehler(409, 'Für Lastschrift-Rechnungen fehlt die Gläubiger-ID in den Abrechnungsdaten des Ausrichters.');
    }
    const kopf = {
        rechnungsdatum: heuteBerlin(),
        leistungsdatum: isoDatum(turnier.datum),
        zahlungszielTage: Number.isInteger(turnier.zahlungsziel_tage) ? turnier.zahlungsziel_tage : 14,
        vorabTage: Number.isInteger(turnier.vorabankuendigung_tage) ? turnier.vorabankuendigung_tage : 5,
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
            glaeubiger_id: stammdaten.glaeubiger_id || null,
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
    let abbruch = null;
    for (const k of kandidaten) {
        const kassiert = barJe.get(k.schluessel) ?? null;
        try {
            const neu = await legeRechnungAn(knex, {
                turnier, vereinEintrag: k.vereinEintrag, zahlwegZeile: k.zahlwegZeile, kopf, konto,
                barDatum: kassiert ? heuteBerlin(kassiert) : null,
                bezahltAm: kassiert ?? new Date(),
                benutzerId,
                erzeugePdf
            });
            if (neu != null) { neueIds.push({ id: neu, vereinName: k.zahlwegZeile.verein_name }); ergebnis.erstellt += 1; }
        } catch (err) {
            // 409 (z. B. Stammdaten mitten im Lauf geändert): abbrechen, aber bereits erstellte Rechnungen noch versenden.
            if (err instanceof FachFehler && err.statusCode === 409) { abbruch = err; break; }
            console.error('[Rechnungslauf] Rechnung nicht erstellt:', err?.code ?? '', err?.message ?? 'Fehler');
            ergebnis.fehler.push({ vereinName: k.zahlwegZeile.verein_name, grund: 'Die Rechnung konnte nicht erstellt werden.' });
        }
    }

    for (const { id, vereinName } of neueIds) {
        const v = await versende(knex, id, sende);
        if (v.versendet) ergebnis.versendet += 1;
        else ergebnis.fehler.push({ vereinName, grund: v.grund });
    }
    if (abbruch) {
        const zusatz = ergebnis.erstellt > 0
            ? ` Vorher wurden ${ergebnis.erstellt} Rechnung(en) erstellt, davon ${ergebnis.versendet} versendet.`
            : '';
        throw new FachFehler(409, `${abbruch.message}${zusatz}`, { code: 'rechnungslauf_abgebrochen', daten: ergebnis });
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
        // Bedingt, damit eine parallel erfasste Rücklastschrift nicht überschrieben wird.
        const geaendert = await knex('rechnungen').where({ id: rechnungId }).whereNot('status', 'zurueckgebucht')
            .update({ ...werte, updated_at: knex.fn.now() });
        if (geaendert !== 1) throw new FachFehler(409, 'Eine zurückgebuchte Rechnung kann nicht geändert werden.');
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

// ---- Rücklastschrift (Stufe 3, Plan L9) ----
export const RUECKLASTSCHRIFT_ZAHLWEGE = ['ueberweisung', 'bar'];
const MELDUNG_SCHON_ZURUECKGEBUCHT = 'Diese Rechnung wurde schon als zurückgebucht erfasst.';

// Nur eine eingezogene (in einer SEPA-Datei stehende) Lastschrift-Rechnung kann zurückgebucht werden.
function pruefeRuecklastschriftFaehig(zeile) {
    if (zeile.zahlweg !== 'lastschrift' || zeile.art !== 'rechnung') {
        throw new FachFehler(400, 'Eine Rücklastschrift gibt es nur für Lastschrift-Rechnungen.');
    }
    if (zeile.status === 'zurueckgebucht') throw new FachFehler(409, MELDUNG_SCHON_ZURUECKGEBUCHT);
    if (zeile.sepa_datei_id == null) {
        throw new FachFehler(400, 'Diese Lastschrift steht noch in keiner SEPA-Datei und kann daher nicht zurückgebucht worden sein.');
    }
}

/**
 * Erfasst die Rücklastschrift einer eingezogenen Lastschrift-Rechnung (Ausrichter-Admin, auch nach dem Anmeldeschluss):
 * Rechnung -> 'zurueckgebucht' (sonst unverändert, sie bleibt Beleg), Mandat widerrufen (Klartext gelöscht, Löschfrist ab
 * dem letzten Einzug, L12), Zahlweg des Vereins -> neuerZahlweg. Der nächste Rechnungslauf erstellt dann genau eine neue
 * Rechnung mit der nächsten Nummer (der Partial-Unique-Index lässt sie neben der zurückgebuchten zu); die Anrechnung
 * bezahlter Kämpfer folgt dem neuen Zahlweg (E9). Der Status der Kämpfer wird nicht neu abgeleitet (Turnier ist vorbei).
 *
 * Alles in EINER Transaktion. Lock-Reihenfolge: Mandats-Lock (Turnier, Verein; wie mandate.js/zahlwege.js/mandatJob.js)
 * -> SEPA-Lock (Turnier) -> Rechnungslauf-Lock (Turnier) -> Rechnungszeile -> Mandatszeile -> Tokens -> Zahlweg ->
 * Turnier-Lock (synchronisiereGesichert). Keiner der anderen Wege nimmt einen dieser Locks in umgekehrter Folge: SEPA-Export
 * und Rechnungslauf nehmen nie den Mandats-Lock, der SEPA-Export nie den Rechnungslauf-Lock (und umgekehrt); ihre
 * Zeilensperren (Mandat FOR UPDATE/SHARE, Rechnungen) liegen hinter dem jeweiligen Turnier-Lock, den hier schon wir halten.
 * @returns {Promise<{ rechnung: object, zahlweg: { id, verein_name, zahlweg, mandat_gueltig }, mandatId: number|null }>}
 */
export async function erfasseRuecklastschrift(knex, { turnier, rechnungId, neuerZahlweg, benutzerId }) {
    if (typeof neuerZahlweg !== 'string' || !RUECKLASTSCHRIFT_ZAHLWEGE.includes(neuerZahlweg)) {
        throw new FachFehler(400, 'Bitte den neuen Zahlweg wählen: Überweisung oder Bar.');
    }
    const vorab = await knex('rechnungen').where({ id: rechnungId, turnier_id: turnier.id })
        .first('id', 'verein_name', 'zahlweg', 'art', 'status', 'sepa_datei_id');
    if (!vorab) throw new FachFehler(404, 'Rechnung nicht gefunden.');
    if ((await ladeEffektivenTurnierStatus(knex, turnier.id)) === 'abgesagt') {
        throw new FachFehler(400, 'Das Turnier wurde abgesagt. Es gibt keine Abrechnung.');
    }
    pruefeRuecklastschriftFaehig(vorab);

    const ergebnis = await knex.transaction(async (trx) => {
        await sperreMandate(trx, turnier.id, vorab.verein_name);
        await trx.raw("SELECT pg_advisory_xact_lock(hashtext('sepa_datei'), ?)", [turnier.id]);
        await trx.raw("SELECT pg_advisory_xact_lock(hashtext('rechnungslauf'), ?)", [turnier.id]);
        const aktuell = await trx('rechnungen').where({ id: rechnungId, turnier_id: turnier.id }).forUpdate()
            .first('id', 'verein_name', 'zahlweg', 'art', 'status', 'sepa_datei_id', 'mandat_id');
        if (!aktuell) throw new FachFehler(404, 'Rechnung nicht gefunden.');
        pruefeRuecklastschriftFaehig(aktuell);
        // Bedingtes UPDATE als zweite Absicherung (nie doppelt zurückbuchen, nur mit Datei).
        const geaendert = await trx('rechnungen')
            .where({ id: rechnungId, turnier_id: turnier.id, zahlweg: 'lastschrift' })
            .whereNot('status', 'zurueckgebucht')
            .whereNotNull('sepa_datei_id')
            .update({ status: 'zurueckgebucht', zurueckgebucht_am: trx.fn.now(), updated_at: trx.fn.now() });
        if (geaendert !== 1) throw new FachFehler(409, MELDUNG_SCHON_ZURUECKGEBUCHT);

        // Mandat des Vereins widerrufen (falls noch aktiv; nach der Löschfrist kann es fehlen).
        const mandatId = await widerrufeMandatInTrx(trx, {
            turnierId: turnier.id, vereinName: aktuell.verein_name, benutzer: null, grund: 'ruecklastschrift'
        });
        const zahlwegZeile = await trx('turnier_zahlwege').where({ turnier_id: turnier.id, verein_name: aktuell.verein_name }).forUpdate().first('id');
        if (!zahlwegZeile) throw new FachFehler(409, 'Für diesen Verein gibt es keinen Zahlweg mehr.');
        // Bewusst ohne Anmeldeschluss-Sperre (speichereZahlweg verweigert das danach): das ist die Umstellung durch den Ausrichter.
        await trx('turnier_zahlwege').where({ id: zahlwegZeile.id }).update({
            zahlweg: neuerZahlweg,
            mandat_gueltig: false,
            geaendert_von: benutzerId == null ? null : String(benutzerId),
            updated_at: trx.fn.now()
        });
        await synchronisiereGesichert(trx, turnier.id, { statusAbleiten: false });
        const rechnung = await trx('rechnungen').where({ id: rechnungId }).select(selectRechnung(trx)).first();
        const zahlweg = await trx('turnier_zahlwege').where({ id: zahlwegZeile.id }).first('id', 'verein_name', 'zahlweg', 'mandat_gueltig');
        return { rechnung, zahlweg, mandatId };
    });
    if (ergebnis.mandatId) {
        await protokolliereMandat(knex, {
            art: 'mandat.widerrufen', mandatId: ergebnis.mandatId, turnierId: turnier.id, benutzerId, vereinId: turnier.verein_id ?? null
        });
    }
    return {
        rechnung: { ...ergebnis.rechnung, anzeigeStatus: rechnungsAnzeigeStatus(ergebnis.rechnung, heuteBerlin()) },
        zahlweg: ergebnis.zahlweg,
        mandatId: ergebnis.mandatId ?? null
    };
}
