// Liest Outlook-Nachrichten (.msg) ohne Zusatzbibliothek: Die Datei ist ein OLE/Compound-File
// (CFB) mit Properties als Streams "__substg1.0_<Tag><Typ>". Framework-frei, läuft im Browser und
// in den Unit-Tests identisch. Ergebnis wie parseEml: { betreff, von, text, anhaenge }.
// Grenzen: nur Klartext- und HTML-Körper (kein reiner RTF-Körper), keine eingebetteten Nachrichten.

import { htmlZuText } from './mailExtraktion.js';

const SIGNATUR = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDE = 0xfffffffe;
const FREI = 0xffffffff;

function leseCfb(bytes) {
    if (bytes.length < 512 || SIGNATUR.some((b, i) => bytes[i] !== b)) {
        throw new Error('Keine gültige Outlook-Datei (.msg).');
    }
    const ansicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o) => ansicht.getUint16(o, true);
    const u32 = (o) => ansicht.getUint32(o, true);

    const sektorGroesse = 1 << u16(0x1e);
    const miniGroesse = 1 << u16(0x20);
    const miniGrenze = u32(0x38);
    const sektorOffset = (sid) => (sid + 1) * sektorGroesse;
    const sektor = (sid) => bytes.subarray(sektorOffset(sid), sektorOffset(sid) + sektorGroesse);

    // FAT (über DIFAT: erst 109 Einträge im Kopf, dann verkettete DIFAT-Sektoren)
    const fatSektoren = [];
    for (let i = 0; i < 109; i++) {
        const sid = u32(0x4c + i * 4);
        if (sid !== FREI && sid !== ENDE) fatSektoren.push(sid);
    }
    let difat = u32(0x44);
    for (let n = 0, max = u32(0x48); n < max && difat !== ENDE && difat !== FREI; n++) {
        const a = new DataView(bytes.buffer, bytes.byteOffset + sektorOffset(difat), sektorGroesse);
        for (let i = 0; i < sektorGroesse / 4 - 1; i++) {
            const sid = a.getUint32(i * 4, true);
            if (sid !== FREI && sid !== ENDE) fatSektoren.push(sid);
        }
        difat = a.getUint32(sektorGroesse - 4, true);
    }
    const fat = [];
    for (const sid of fatSektoren) {
        const a = new DataView(bytes.buffer, bytes.byteOffset + sektorOffset(sid), sektorGroesse);
        for (let i = 0; i < sektorGroesse / 4; i++) fat.push(a.getUint32(i * 4, true));
    }

    const kette = (start, tabelle) => {
        const ids = [];
        for (let sid = start; sid !== ENDE && sid !== FREI && ids.length <= tabelle.length; sid = tabelle[sid]) ids.push(sid);
        return ids;
    };
    const liesKette = (start, groesse, tabelle, holeSektor, einheit) => {
        const teile = kette(start, tabelle).map(holeSektor);
        const aus = new Uint8Array(teile.length * einheit);
        teile.forEach((t, i) => aus.set(t, i * einheit));
        return aus.subarray(0, groesse ?? aus.length);
    };

    // Verzeichnis
    const dirBytes = liesKette(u32(0x30), null, fat, sektor, sektorGroesse);
    const dir = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
        const a = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128);
        const laenge = Math.max(0, a.getUint16(64, true) - 2);
        let name = '';
        for (let i = 0; i < laenge; i += 2) name += String.fromCharCode(a.getUint16(i, true));
        dir.push({
            name, typ: a.getUint8(66), links: a.getUint32(68, true), rechts: a.getUint32(72, true),
            kind: a.getUint32(76, true), start: a.getUint32(116, true), groesse: a.getUint32(120, true)
        });
    }
    if (dir.length === 0) throw new Error('Outlook-Datei ist leer.');

    // Mini-Stream (kleine Streams) liegt im Root-Eintrag
    const miniFat = [];
    const miniFatBytes = liesKette(u32(0x3c), null, fat, sektor, sektorGroesse);
    const miniAnsicht = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniAnsicht.getUint32(i, true));
    const miniStream = dir[0].groesse > 0 ? liesKette(dir[0].start, dir[0].groesse, fat, sektor, sektorGroesse) : new Uint8Array(0);

    const liesStream = (eintrag) => {
        if (eintrag.groesse < miniGrenze) {
            return liesKette(eintrag.start, eintrag.groesse, miniFat,
                (sid) => miniStream.subarray(sid * miniGroesse, (sid + 1) * miniGroesse), miniGroesse);
        }
        return liesKette(eintrag.start, eintrag.groesse, fat, sektor, sektorGroesse);
    };

    // Kinder eines Storage: binärer Baum aus links/rechts-Geschwistern
    const kinder = (index) => {
        const ergebnis = [];
        const stapel = [dir[index].kind];
        const besucht = new Set();
        while (stapel.length) {
            const i = stapel.pop();
            if (i === FREI || i >= dir.length || besucht.has(i)) continue;
            besucht.add(i);
            ergebnis.push(i);
            stapel.push(dir[i].links, dir[i].rechts);
        }
        return ergebnis;
    };

    return { dir, kinder, liesStream };
}

function dekodiere(bytes, istUnicode) {
    if (istUnicode) return new TextDecoder('utf-16le').decode(bytes);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
        return new TextDecoder('windows-1252').decode(bytes);
    }
}

// Text-Property (001F = Unicode, 001E = 8-Bit) aus den Streams eines Storage
function liesTextProperty(cfb, kindIndizes, tag) {
    for (const [typ, unicode] of [['001F', true], ['001E', false]]) {
        const i = kindIndizes.find(k => cfb.dir[k].name.toLowerCase() === `__substg1.0_${tag}${typ}`.toLowerCase());
        if (i !== undefined) return dekodiere(cfb.liesStream(cfb.dir[i]), unicode).replace(/\0+$/, '');
    }
    return '';
}

function liesBinaerProperty(cfb, kindIndizes, tag) {
    const i = kindIndizes.find(k => cfb.dir[k].name.toLowerCase() === `__substg1.0_${tag}0102`.toLowerCase());
    return i === undefined ? null : cfb.liesStream(cfb.dir[i]);
}

export function parseMsg(bytes) {
    const cfb = leseCfb(bytes);
    const wurzel = cfb.kinder(0);

    const betreff = liesTextProperty(cfb, wurzel, '0037');
    const von = liesTextProperty(cfb, wurzel, '0C1A');
    let text = liesTextProperty(cfb, wurzel, '1000');
    if (!text.trim()) {
        const html = liesBinaerProperty(cfb, wurzel, '1013') || null;
        if (html) text = htmlZuText(dekodiere(html, false));
        else text = htmlZuText(liesTextProperty(cfb, wurzel, '1013'));
    }

    const anhaenge = [];
    for (const i of wurzel) {
        if (cfb.dir[i].typ !== 1 || !cfb.dir[i].name.startsWith('__attach_version1.0_')) continue;
        const teile = cfb.kinder(i);
        const daten = liesBinaerProperty(cfb, teile, '3701');
        if (!daten) continue;
        const name = liesTextProperty(cfb, teile, '3707') || liesTextProperty(cfb, teile, '3704');
        anhaenge.push({ name, typ: '', daten });
    }

    return { betreff, von, text: text.replace(/\r\n?/g, '\n'), anhaenge };
}
