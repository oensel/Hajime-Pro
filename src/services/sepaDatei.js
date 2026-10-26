// pain.008-Generator (SEPA-Basislastschrift, eine Sammeldatei mit einem PmtInf). Reiner Generator ohne
// Datenbank. Geldrechnung ausschließlich in ganzen Cent; das XML entsteht von Hand mit strenger Maskierung.
import { FachFehler } from '../utils/fachFehler.js';
import { pruefeIban } from '../shared/iban.js';
import { pruefeGlaeubigerId } from '../shared/glaeubigerId.js';
import { sepaText, sepaKennung } from '../shared/sepaZeichen.js';
import { istTargetGeschaeftstag } from '../shared/targetKalender.js';

// Einzige Stelle für die Schema-Version; der Namespace wird daraus abgeleitet.
export const PAIN008_VERSION = 'pain.008.001.08';
export const PAIN008_NAMESPACE = `urn:iso:std:iso:20022:tech:xsd:${PAIN008_VERSION}`;

const MAX_NAME = 70;
const MAX_VERWENDUNG = 140;
const MAX_KENNUNG = 35;

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function fehler(text) {
    return new FachFehler(422, text);
}

// XML 1.0: erlaubt sind Tab, LF, CR, #x20-#xD7FF, #xE000-#xFFFD und Zeichen ab U+10000.
function entferneUnzulaessigeXmlZeichen(text) {
    let s = '';
    for (const z of String(text ?? '')) {
        const c = z.codePointAt(0);
        const erlaubt = c === 0x9 || c === 0xA || c === 0xD || (c >= 0x20 && c <= 0xD7FF)
            || (c >= 0xE000 && c <= 0xFFFD) || (c >= 0x10000 && c <= 0x10FFFF);
        s += erlaubt ? z : ' ';
    }
    return s;
}

export function xmlMaskiere(text) {
    return entferneUnzulaessigeXmlZeichen(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function element(name, inhalt, attribute = '') {
    return `<${name}${attribute}>${xmlMaskiere(inhalt)}</${name}>`;
}

// Cent (ganze Zahl) als Dezimaltext mit genau zwei Nachkommastellen, ohne Gleitkomma.
export function centAlsBetrag(cent) {
    const c = Math.abs(cent);
    return `${cent < 0 ? '-' : ''}${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

function pruefeIsoDatum(wert, bezeichnung) {
    if (typeof wert !== 'string' || !ISO_DATUM.test(wert)) throw fehler(`${bezeichnung} ist kein gültiges Datum (JJJJ-MM-TT).`);
    const [j, m, t] = wert.split('-').map(Number);
    const d = new Date(Date.UTC(j, m - 1, t));
    if (d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) {
        throw fehler(`${bezeichnung} ist kein gültiges Datum (JJJJ-MM-TT).`);
    }
    return wert;
}

function pflichtText(wert, bezeichnung, max) {
    const s = sepaText(wert, max);
    if (!s) throw fehler(`${bezeichnung} fehlt oder enthält keine SEPA-fähigen Zeichen.`);
    return s;
}

function pflichtKennung(wert, bezeichnung) {
    const s = sepaKennung(wert, MAX_KENNUNG);
    if (!s) throw fehler(`${bezeichnung} fehlt oder enthält keine SEPA-fähigen Zeichen.`);
    return s;
}

export function erzeugePain008({ msgId, erzeugtAm, glaeubiger, faelligkeit, posten }) {
    if (!Array.isArray(posten) || posten.length === 0) throw fehler('Die Lastschrift-Datei braucht mindestens einen Posten.');
    if (!(erzeugtAm instanceof Date) || Number.isNaN(erzeugtAm.getTime())) throw fehler('Der Erstellzeitpunkt ist ungültig.');
    if (!glaeubiger) throw fehler('Die Gläubiger-Angaben fehlen.');

    const gIban = pruefeIban(glaeubiger.iban);
    if (!gIban.ok) throw fehler(`IBAN des Gläubigers: ${gIban.fehler}`);
    const gId = pruefeGlaeubigerId(glaeubiger.glaeubigerId);
    if (!gId.ok) throw fehler(`Gläubiger-ID: ${gId.fehler}`);
    const gName = pflichtText(glaeubiger.name, 'Der Name des Gläubigers', MAX_NAME);

    pruefeIsoDatum(faelligkeit, 'Das Fälligkeitsdatum');
    if (!istTargetGeschaeftstag(faelligkeit)) throw fehler('Das Fälligkeitsdatum muss ein TARGET-Geschäftstag sein.');

    const msg = pflichtKennung(msgId, 'Die Nachrichten-ID');

    const gesehen = new Set();
    let summeCent = 0;
    const transaktionen = [];
    posten.forEach((p, i) => {
        const nr = i + 1;
        if (!Number.isSafeInteger(p?.betragCent) || p.betragCent <= 0) throw fehler(`Posten ${nr}: Der Betrag muss größer als 0 sein (ganze Cent).`);
        const zIban = pruefeIban(p.zahlerIban);
        if (!zIban.ok) throw fehler(`Posten ${nr}: IBAN des Zahlers: ${zIban.fehler}`);
        const mandatDatum = pruefeIsoDatum(p.mandatDatum, `Posten ${nr}: Das Mandatsdatum`);
        const e2e = pflichtKennung(p.endToEndId, `Posten ${nr}: Die EndToEndId`);
        if (gesehen.has(e2e)) throw fehler(`Die EndToEndId ${e2e} kommt in der Datei mehrfach vor.`);
        gesehen.add(e2e);
        const mandat = pflichtKennung(p.mandatsreferenz, `Posten ${nr}: Die Mandatsreferenz`);
        const zahlerName = pflichtText(p.zahlerName, `Posten ${nr}: Der Name des Zahlers`, MAX_NAME);
        const zweck = pflichtText(p.verwendungszweck, `Posten ${nr}: Der Verwendungszweck`, MAX_VERWENDUNG);
        summeCent += p.betragCent;
        transaktionen.push([
            '<DrctDbtTxInf>',
            `<PmtId>${element('EndToEndId', e2e)}</PmtId>`,
            element('InstdAmt', centAlsBetrag(p.betragCent), ' Ccy="EUR"'),
            '<DrctDbtTx><MndtRltdInf>',
            element('MndtId', mandat),
            element('DtOfSgntr', mandatDatum),
            '</MndtRltdInf></DrctDbtTx>',
            '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>',
            `<Dbtr>${element('Nm', zahlerName)}</Dbtr>`,
            `<DbtrAcct><Id>${element('IBAN', zIban.iban)}</Id></DbtrAcct>`,
            `<RmtInf>${element('Ustrd', zweck)}</RmtInf>`,
            '</DrctDbtTxInf>',
        ].join(''));
    });

    const anzahl = posten.length;
    const summe = centAlsBetrag(summeCent);
    const zeit = erzeugtAm.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const pmtInfId = sepaKennung(`${msg}-1`, MAX_KENNUNG);

    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<Document xmlns="${PAIN008_NAMESPACE}">`,
        '<CstmrDrctDbtInitn>',
        '<GrpHdr>',
        element('MsgId', msg),
        element('CreDtTm', zeit),
        element('NbOfTxs', String(anzahl)),
        element('CtrlSum', summe),
        `<InitgPty>${element('Nm', gName)}</InitgPty>`,
        '</GrpHdr>',
        '<PmtInf>',
        element('PmtInfId', pmtInfId),
        element('PmtMtd', 'DD'),
        element('BtchBookg', 'true'),
        element('NbOfTxs', String(anzahl)),
        element('CtrlSum', summe),
        '<PmtTpInf>',
        '<SvcLvl><Cd>SEPA</Cd></SvcLvl>',
        '<LclInstrm><Cd>CORE</Cd></LclInstrm>',
        element('SeqTp', 'OOFF'),
        '</PmtTpInf>',
        element('ReqdColltnDt', faelligkeit),
        `<Cdtr>${element('Nm', gName)}</Cdtr>`,
        `<CdtrAcct><Id>${element('IBAN', gIban.iban)}</Id></CdtrAcct>`,
        '<CdtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></CdtrAgt>',
        element('ChrgBr', 'SLEV'),
        `<CdtrSchmeId><Id><PrvtId><Othr>${element('Id', gId.wert)}<SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>`,
        ...transaktionen,
        '</PmtInf>',
        '</CstmrDrctDbtInitn>',
        '</Document>',
    ].join('\n');

    return { xml, anzahl, summeCent };
}
