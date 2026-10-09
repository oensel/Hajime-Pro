import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMsg } from '../../src/shared/msgParser.js';
import { extrahiereKaempfer } from '../../src/shared/mailExtraktion.js';

const ENDE = 0xfffffffe;
const FREI = 0xffffffff;
const FAT_SEKTOR = 0xfffffffd;

const utf16 = (s) => Buffer.from(s + '\0', 'utf16le');

// Baut eine minimale .msg (CFB, 512-Byte-Sektoren, genau ein FAT-Sektor) aus einem Baum
// { name, daten?: Buffer, kinder?: [...] } — kleine Streams (< 4096 Byte) kommen in den Mini-Stream.
function baueCfb(wurzelKinder) {
    const eintraege = [{ name: 'Root Entry', typ: 5, kinder: wurzelKinder }];
    const flach = (knoten) => {
        const index = eintraege.length;
        eintraege.push({ name: knoten.name, typ: knoten.kinder ? 1 : 2, daten: knoten.daten });
        if (knoten.kinder) {
            const idx = knoten.kinder.map(k => flach(k));
            eintraege[index].kindIndizes = idx;
        }
        return index;
    };
    eintraege[0].kindIndizes = wurzelKinder.map(k => flach(k));

    // Geschwister als Kette über "rechts" verknüpfen
    for (const e of eintraege) {
        e.links = FREI; e.rechts = FREI; e.kind = FREI;
    }
    for (const e of eintraege) {
        if (!e.kindIndizes || e.kindIndizes.length === 0) continue;
        e.kind = e.kindIndizes[0];
        e.kindIndizes.forEach((k, i) => { eintraege[k].rechts = i + 1 < e.kindIndizes.length ? e.kindIndizes[i + 1] : FREI; });
    }

    const streams = eintraege.filter(e => e.typ === 2);
    const mini = streams.filter(e => e.daten.length < 4096);
    const gross = streams.filter(e => e.daten.length >= 4096);

    // Mini-Stream + Mini-FAT
    const miniTeile = [];
    const miniFat = [];
    for (const e of mini) {
        const n = Math.max(1, Math.ceil(e.daten.length / 64));
        e.start = miniFat.length;
        for (let i = 0; i < n; i++) miniFat.push(i + 1 < n ? miniFat.length + 1 : ENDE);
        const gepolstert = Buffer.alloc(n * 64);
        e.daten.copy(gepolstert);
        miniTeile.push(gepolstert);
    }
    const miniStream = Buffer.concat(miniTeile);

    const sektorenFuer = (laenge) => Math.max(1, Math.ceil(laenge / 512));
    const dirSektoren = sektorenFuer(eintraege.length * 128);
    const miniFatSektoren = miniFat.length ? sektorenFuer(miniFat.length * 4) : 0;
    const miniStreamSektoren = miniStream.length ? sektorenFuer(miniStream.length) : 0;

    // Sektor 0 = FAT; danach Verzeichnis, Mini-FAT, Mini-Stream, große Streams
    let naechster = 1;
    const belegung = [];
    const belege = (anzahl) => { const start = naechster; naechster += anzahl; belegung.push([start, anzahl]); return start; };
    const dirStart = belege(dirSektoren);
    const miniFatStart = miniFatSektoren ? belege(miniFatSektoren) : ENDE;
    const miniStreamStart = miniStreamSektoren ? belege(miniStreamSektoren) : ENDE;
    for (const e of gross) e.start = belege(sektorenFuer(e.daten.length));

    const fat = new Array(128).fill(FREI);
    fat[0] = FAT_SEKTOR;
    for (const [start, anzahl] of belegung) {
        for (let i = 0; i < anzahl; i++) fat[start + i] = i + 1 < anzahl ? start + i + 1 : ENDE;
    }

    const datei = Buffer.alloc(512 * (1 + naechster));
    // Kopf
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(datei, 0);
    datei.writeUInt16LE(0x3e, 0x18); datei.writeUInt16LE(3, 0x1a); datei.writeUInt16LE(0xfffe, 0x1c);
    datei.writeUInt16LE(9, 0x1e); datei.writeUInt16LE(6, 0x20);
    datei.writeUInt32LE(1, 0x2c);          // Anzahl FAT-Sektoren
    datei.writeUInt32LE(dirStart, 0x30);
    datei.writeUInt32LE(4096, 0x38);
    datei.writeUInt32LE(miniFatStart, 0x3c); datei.writeUInt32LE(miniFatSektoren, 0x40);
    datei.writeUInt32LE(ENDE, 0x44); datei.writeUInt32LE(0, 0x48);
    for (let i = 0; i < 109; i++) datei.writeUInt32LE(i === 0 ? 0 : FREI, 0x4c + i * 4);

    const sektorPos = (sid) => (sid + 1) * 512;
    fat.forEach((w, i) => datei.writeUInt32LE(w, sektorPos(0) + i * 4));

    // Verzeichnis
    eintraege.forEach((e, i) => {
        const o = sektorPos(dirStart) + i * 128;
        const name = Buffer.from(e.name, 'utf16le');
        name.copy(datei, o);
        datei.writeUInt16LE(name.length + 2, o + 64);
        datei.writeUInt8(e.typ, o + 66);
        datei.writeUInt32LE(e.links, o + 68); datei.writeUInt32LE(e.rechts, o + 72); datei.writeUInt32LE(e.kind, o + 76);
        if (e.typ === 5) { datei.writeUInt32LE(miniStreamStart, o + 116); datei.writeUInt32LE(miniStream.length, o + 120); }
        else if (e.typ === 2) { datei.writeUInt32LE(e.start, o + 116); datei.writeUInt32LE(e.daten.length, o + 120); }
        else datei.writeUInt32LE(ENDE, o + 116);
    });
    miniFat.forEach((w, i) => datei.writeUInt32LE(w, sektorPos(miniFatStart) + i * 4));
    miniStream.copy(datei, sektorPos(miniStreamStart));
    for (const e of gross) e.daten.copy(datei, sektorPos(e.start));
    return Uint8Array.from(datei);
}

const TEXT = [
    'Hallo,', 'Verein: JC Senden', 'Jungen:',
    '1. Max Mustermann, *2012, 34 kg', '2. Ben Müller 03.07.2011 38 kg'
].join('\r\n');

test('parseMsg: Betreff, Absender, Klartext (Mini-Stream) und Kämpfer', () => {
    const msg = baueCfb([
        { name: '__substg1.0_0037001F', daten: utf16('Meldung') },
        { name: '__substg1.0_0C1A001F', daten: utf16('Trainer Senden') },
        { name: '__substg1.0_1000001F', daten: utf16(TEXT) }
    ]);
    const mail = parseMsg(msg);
    assert.equal(mail.betreff, 'Meldung');
    assert.equal(mail.von, 'Trainer Senden');
    const s = extrahiereKaempfer(mail.text);
    assert.equal(s.length, 2);
    assert.equal(s[0].nachname, 'Mustermann');
    assert.equal(s[0].verein, 'JC Senden');
    assert.equal(s[1].nachname, 'Müller');
});

test('parseMsg: langer Text (reguläre Sektoren) und HTML-Ersatz ohne Klartext', () => {
    const langerText = (TEXT + '\r\n').repeat(1) + 'Füllzeile\r\n'.repeat(500);
    const lang = parseMsg(baueCfb([{ name: '__substg1.0_1000001F', daten: utf16(langerText) }]));
    assert.equal(extrahiereKaempfer(lang.text).length, 2);

    const html = '<p>Verein: JC Senden</p><p>Eva Klein, 2011, w, 30 kg</p>';
    const mail = parseMsg(baueCfb([{ name: '__substg1.0_10130102', daten: Buffer.from(html, 'utf8') }]));
    const s = extrahiereKaempfer(mail.text);
    assert.equal(s.length, 1);
    assert.equal(s[0].geschlecht, 'weiblich');
});

test('parseMsg: Anhang mit Dateiname', () => {
    const mail = parseMsg(baueCfb([
        { name: '__substg1.0_1000001F', daten: utf16('Text') },
        {
            name: '__attach_version1.0_#00000000',
            kinder: [
                { name: '__substg1.0_3707001F', daten: utf16('meldung.xlsx') },
                { name: '__substg1.0_37010102', daten: Buffer.from('PK-daten') }
            ]
        }
    ]));
    assert.equal(mail.anhaenge.length, 1);
    assert.equal(mail.anhaenge[0].name, 'meldung.xlsx');
    assert.equal(Buffer.from(mail.anhaenge[0].daten).toString(), 'PK-daten');
});

test('parseMsg: ungültige Datei wird abgelehnt', () => {
    assert.throws(() => parseMsg(new Uint8Array(1024)), /Outlook/);
});
