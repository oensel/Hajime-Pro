// Startgeld-Zahlweg (Spec docs/superpowers/specs, Plan Stufe 1): reine Ableitungen und Prüfungen,
// ohne knex und DOM, läuft am Server und im Browser.

export const ZAHLWEGE = ['ueberweisung', 'bar', 'lastschrift'];
export const ABRECHNUNGSBASEN = ['gemeldet', 'teilnahme_waage'];

// In Stufe 1 werden nur diese Zahlwege angeboten (lastschrift ist reserviert).
const STANDARD_ANGEBOTEN = ['ueberweisung', 'bar'];
const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function istGueltigeEmail(wert) {
    return typeof wert === 'string' && EMAIL_MUSTER.test(wert);
}

// Kommaseparierter Text -> Liste bekannter Zahlwege; ohne Angabe der Standard.
export function parseAngeboteneZahlwege(wert) {
    if (wert === null || wert === undefined || String(wert).trim() === '') {
        return [...STANDARD_ANGEBOTEN];
    }
    return String(wert)
        .split(',')
        .map((teil) => teil.trim())
        .filter((teil) => ZAHLWEGE.includes(teil));
}

export function startgeldVerlangt(turnier) {
    return parseFloat(turnier?.startgeld) > 0;
}

// Erfüllt, wenn kein Startgeld verlangt wird oder der Zahlweg gesichert bzw. von Hand als bezahlt markiert ist.
export function startgeldErfuellt(turnier, teilnehmer) {
    if (!startgeldVerlangt(turnier)) return true;
    return Boolean(teilnehmer?.startgeld_zahlweg_gesichert) || Boolean(teilnehmer?.startgeld_bezahlt);
}

// Stufe 1: nur die Überweisung gilt als gesichert (Bar wird an der Kasse bezahlt).
export function istZahlwegGesichert(zeile) {
    return zeile?.zahlweg === 'ueberweisung';
}

export function pruefeZahlwegEingabe(eingabe, angeboten) {
    const text = (wert) => (typeof wert === 'string' ? wert.trim() : '');
    const werte = {
        zahlweg: text(eingabe?.zahlweg),
        rechnung_email: text(eingabe?.rechnung_email),
        rechnung_ansprechperson: text(eingabe?.rechnung_ansprechperson),
        rechnung_anschrift: text(eingabe?.rechnung_anschrift),
    };
    let fehler = null;
    if (!werte.zahlweg || !(angeboten || []).includes(werte.zahlweg)) {
        fehler = 'Bitte einen angebotenen Zahlweg wählen.';
    } else if (!werte.rechnung_email) {
        fehler = 'Bitte die Rechnungs-E-Mail angeben.';
    } else if (!EMAIL_MUSTER.test(werte.rechnung_email)) {
        fehler = 'Die Rechnungs-E-Mail ist ungültig.';
    } else if (!werte.rechnung_ansprechperson) {
        fehler = 'Bitte eine Ansprechperson angeben.';
    } else if (!werte.rechnung_anschrift) {
        fehler = 'Bitte die Rechnungsanschrift angeben.';
    }
    return fehler ? { fehler, werte: null } : { fehler: null, werte };
}
