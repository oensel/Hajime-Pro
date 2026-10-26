import test from 'node:test';
import assert from 'node:assert/strict';
import { erzeugePain008, PAIN008_VERSION, xmlMaskiere, centAlsBetrag } from '../../src/services/sepaDatei.js';
import { pruefeIban } from '../../src/shared/iban.js';

const GLAEUBIGER_IBAN = 'DE89370400440532013000';
const ZAHLER_IBAN = 'DE02120300000000202051';
const GLAEUBIGER_ID = 'DE98ZZZ09999999999';

function posten(betraege, zusatz = {}) {
    return betraege.map((betragCent, i) => ({
        endToEndId: `RE-2026-${i + 1}`,
        betragCent,
        mandatsreferenz: `MAND-${i + 1}`,
        mandatDatum: '2026-01-15',
        zahlerName: `Verein ${i + 1}`,
        zahlerIban: ZAHLER_IBAN,
        verwendungszweck: `Startgeld ${i + 1}`,
        ...zusatz,
    }));
}

function eingabe(uebersteuern = {}) {
    return {
        msgId: 'HAJIME-2026-0001',
        erzeugtAm: new Date('2026-10-26T08:15:30.789Z'),
        glaeubiger: { name: 'Judo Club Musterstadt', iban: GLAEUBIGER_IBAN, glaeubigerId: GLAEUBIGER_ID },
        faelligkeit: '2026-11-02',
        posten: posten([2400, 1600]),
        ...uebersteuern,
    };
}

// Winziger Wohlgeformtheits-Parser: Tags müssen sauber geschachtelt sein, Textknoten dürfen
// weder rohes '<' noch unmaskiertes '&' enthalten. Liefert die Textknoten mit ihrem Pfad zurück.
function pruefeWohlgeformt(xml) {
    const text = xml.replace(/^<\?xml[^>]*\?>/, '');
    const stapel = [];
    const textknoten = [];
    const muster = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w:.-]+="[^"<&]*")*)\s*(\/?)>|([^<]+)/g;
    let pos = 0;
    let m;
    while ((m = muster.exec(text)) !== null) {
        assert.equal(m.index, pos, `unerwartetes Zeichen bei ${pos}`);
        pos = muster.lastIndex;
        if (m[5] !== undefined) {
            if (/^\s*$/.test(m[5])) continue;
            assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(m[5]), `unmaskiertes & in "${m[5]}"`);
            assert.ok(!/>/.test(m[5]), `rohes > in "${m[5]}"`);
            textknoten.push({ pfad: stapel.join('/'), text: m[5] });
        } else if (m[1]) {
            assert.equal(stapel.pop(), m[2], `schließendes Tag ${m[2]} passt nicht`);
        } else if (!m[4]) {
            stapel.push(m[2]);
        }
    }
    assert.equal(pos, text.length);
    assert.deepEqual(stapel, []);
    return textknoten;
}

test('die Testdaten-IBANs sind gültig', () => {
    assert.ok(pruefeIban(GLAEUBIGER_IBAN).ok);
    assert.ok(pruefeIban(ZAHLER_IBAN).ok);
});

test('zwei Posten: Anzahl, Summe, Schema-Kennungen', () => {
    const r = erzeugePain008(eingabe());
    assert.equal(r.anzahl, 2);
    assert.equal(r.summeCent, 4000);
    assert.equal(PAIN008_VERSION, 'pain.008.001.08');
    assert.match(r.xml, new RegExp(`xmlns="urn:iso:std:iso:20022:tech:xsd:${PAIN008_VERSION.replace(/\./g, '\\.')}"`));
    assert.equal((r.xml.match(/<CtrlSum>40\.00<\/CtrlSum>/g) || []).length, 2);
    assert.equal((r.xml.match(/<NbOfTxs>2<\/NbOfTxs>/g) || []).length, 2);
    assert.match(r.xml, /<SeqTp>OOFF<\/SeqTp>/);
    assert.match(r.xml, /<LclInstrm><Cd>CORE<\/Cd><\/LclInstrm>/);
    assert.match(r.xml, /<ReqdColltnDt>2026-11-02<\/ReqdColltnDt>/);
    assert.match(r.xml, /<CreDtTm>2026-10-26T08:15:30Z<\/CreDtTm>/);
    assert.match(r.xml, /<InstdAmt Ccy="EUR">24\.00<\/InstdAmt>/);
    assert.match(r.xml, new RegExp(`<Id>${GLAEUBIGER_ID}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm>`));
    assert.match(r.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.equal((r.xml.match(/<PmtInf>/g) || []).length, 1);
});

test('Cent-Rechnung: 1999 + 1 + 1000 ergibt 30.00, Beträge mit zwei Nachkommastellen', () => {
    const r = erzeugePain008(eingabe({ posten: posten([1999, 1, 1000]) }));
    assert.equal(r.summeCent, 3000);
    assert.equal((r.xml.match(/<CtrlSum>30\.00<\/CtrlSum>/g) || []).length, 2);
    assert.match(r.xml, /<InstdAmt Ccy="EUR">19\.99<\/InstdAmt>/);
    assert.match(r.xml, /<InstdAmt Ccy="EUR">0\.01<\/InstdAmt>/);
    assert.match(r.xml, /<InstdAmt Ccy="EUR">10\.00<\/InstdAmt>/);
    assert.equal(centAlsBetrag(5), '0.05');
    assert.equal(centAlsBetrag(100000007), '1000000.07');
});

test('Namen werden SEPA-konform und maskiert', () => {
    const r = erzeugePain008(eingabe({
        glaeubiger: { name: 'Jürgen & Söhne <e.V.>', iban: GLAEUBIGER_IBAN, glaeubigerId: GLAEUBIGER_ID },
    }));
    assert.match(r.xml, /<Nm>Juergen \+ Soehne e\.V\.<\/Nm>/);
    assert.ok(!r.xml.includes('Söhne'));
    pruefeWohlgeformt(r.xml);
});

test('Längen: Verwendungszweck ≤ 140, EndToEndId ohne Leerzeichen ≤ 35, Namen ≤ 70', () => {
    const p = posten([1000]);
    p[0].verwendungszweck = 'x'.repeat(200);
    p[0].endToEndId = 'A B '.repeat(30);
    p[0].mandatsreferenz = 'M R '.repeat(30);
    p[0].zahlerName = 'N'.repeat(100);
    const r = erzeugePain008(eingabe({ posten: p, glaeubiger: { name: 'G'.repeat(100), iban: GLAEUBIGER_IBAN, glaeubigerId: GLAEUBIGER_ID } }));
    const ustrd = r.xml.match(/<Ustrd>([^<]*)<\/Ustrd>/)[1];
    assert.equal(ustrd.length, 140);
    const e2e = r.xml.match(/<EndToEndId>([^<]*)<\/EndToEndId>/)[1];
    assert.ok(e2e.length <= 35 && e2e.length > 0 && !/\s/.test(e2e));
    const mand = r.xml.match(/<MndtId>([^<]*)<\/MndtId>/)[1];
    assert.ok(mand.length <= 35 && !/\s/.test(mand));
    for (const m of r.xml.matchAll(/<Nm>([^<]*)<\/Nm>/g)) assert.ok(m[1].length <= 70);
});

test('wohlgeformt, und in Textknoten steht nur der SEPA-Zeichensatz (bzw. ISO-Werte)', () => {
    const p = posten([1234, 99]);
    p[0].zahlerName = 'Ärger "Ü" & <Co> \u0001\u0008 Ünï\u{1F600}';
    p[0].verwendungszweck = `Start'geld <&> "x" \u0000 ${'ö'.repeat(5)}`;
    const r = erzeugePain008(eingabe({ posten: p }));
    const knoten = pruefeWohlgeformt(r.xml);
    assert.ok(knoten.length > 20);
    // Weder maskierte Entitäten noch Steuerzeichen: nach sepaText bleibt kein &, <, >, " übrig.
    for (const k of knoten) {
        assert.match(k.text.replace(/&apos;/g, "'"), /^[A-Za-z0-9/\-?:().,'+ ]*$/, `Textknoten ${k.pfad}: "${k.text}"`);
    }
    // Hochkomma wird als Entität ausgegeben, bleibt aber in der Auswertung sichtbar
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(r.xml));
});

test('xmlMaskiere maskiert alle fünf Zeichen und ersetzt unzulässige Steuerzeichen', () => {
    assert.equal(xmlMaskiere(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
    assert.equal(xmlMaskiere('a\u0000b\u0008c￾d'), 'a b c d');
    assert.equal(xmlMaskiere('a\tb'), 'a\tb');
});

test('Zahler-IBAN steht nur in DbtrAcct, Gläubiger-IBAN nur in CdtrAcct', () => {
    const r = erzeugePain008(eingabe());
    const alleIbans = [...r.xml.matchAll(/<IBAN>([^<]*)<\/IBAN>/g)];
    assert.equal(alleIbans.length, 3);
    for (const m of r.xml.matchAll(new RegExp(ZAHLER_IBAN, 'g'))) {
        const davor = r.xml.slice(0, m.index);
        assert.ok(davor.endsWith('<DbtrAcct><Id><IBAN>'), 'Zahler-IBAN außerhalb von DbtrAcct');
    }
    assert.equal((r.xml.match(new RegExp(ZAHLER_IBAN, 'g')) || []).length, 2);
    assert.equal((r.xml.match(new RegExp(GLAEUBIGER_IBAN, 'g')) || []).length, 1);
    assert.ok(r.xml.includes(`<CdtrAcct><Id><IBAN>${GLAEUBIGER_IBAN}</IBAN>`));
});

test('Element-Reihenfolge nach pain.008.001.08', () => {
    const r = erzeugePain008(eingabe());
    const reihenfolge = (namen) => {
        let letzte = -1;
        for (const n of namen) {
            const i = r.xml.indexOf(`<${n}>`, letzte + 1);
            assert.ok(i > letzte, `${n} an falscher Stelle`);
            letzte = i;
        }
    };
    reihenfolge(['GrpHdr', 'PmtInf', 'PmtInfId', 'PmtMtd', 'BtchBookg', 'PmtTpInf', 'ReqdColltnDt', 'Cdtr', 'CdtrAcct', 'CdtrAgt', 'ChrgBr', 'CdtrSchmeId', 'DrctDbtTxInf']);
    reihenfolge(['PmtId', 'DrctDbtTx', 'DbtrAgt', 'Dbtr', 'DbtrAcct', 'RmtInf']);
});

test('Validierungen werfen mit deutscher Meldung', () => {
    assert.throws(() => erzeugePain008(eingabe({ posten: [] })), /mindestens einen Posten/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([0]) })), /Betrag/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([-5]) })), /Betrag/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([10.5]) })), /Betrag/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([1000], { zahlerIban: 'DE00123' }) })), /IBAN des Zahlers/);
    assert.throws(() => erzeugePain008(eingabe({ glaeubiger: { name: 'X', iban: 'DE00123', glaeubigerId: GLAEUBIGER_ID } })), /IBAN des Gläubigers/);
    assert.throws(() => erzeugePain008(eingabe({ glaeubiger: { name: 'X', iban: GLAEUBIGER_IBAN, glaeubigerId: 'DE99ZZZ09999999999' } })), /Gläubiger-ID/);
    assert.throws(() => erzeugePain008(eingabe({ faelligkeit: '2026-11-01' })), /TARGET-Geschäftstag/); // Sonntag
    assert.throws(() => erzeugePain008(eingabe({ faelligkeit: '2026-12-25' })), /TARGET-Geschäftstag/);
    assert.throws(() => erzeugePain008(eingabe({ faelligkeit: '02.11.2026' })), /Fälligkeitsdatum/);
    assert.throws(() => erzeugePain008(eingabe({ faelligkeit: '2026-02-30' })), /Fälligkeitsdatum/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([1000], { mandatDatum: '15.01.2026' }) })), /Mandatsdatum/);
    assert.throws(() => erzeugePain008(eingabe({ posten: posten([1000], { endToEndId: '' }) })), /EndToEndId/);
});

test('doppelte EndToEndId in einer Datei wirft', () => {
    const p = posten([1000, 2000]);
    p[1].endToEndId = p[0].endToEndId;
    assert.throws(() => erzeugePain008(eingabe({ posten: p })), /mehrfach/);
    // Gleich nach Normalisierung (Leerzeichen entfallen) zählt ebenfalls als doppelt
    const q = posten([1000, 2000]);
    q[0].endToEndId = 'AB 1';
    q[1].endToEndId = 'A B1';
    assert.throws(() => erzeugePain008(eingabe({ posten: q })), /mehrfach/);
});
