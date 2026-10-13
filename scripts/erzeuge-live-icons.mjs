// Erzeugt die PWA-Icons der Teilnehmer-App (ohne Abhängigkeiten): node scripts/erzeuge-live-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ziel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../teilnehmer-app/icons');
const HINTERGRUND = [13, 71, 161, 255];
const VORDERGRUND = [255, 255, 255, 255];

const crcTabelle = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabelle[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(typ, daten) {
    const laenge = Buffer.alloc(4); laenge.writeUInt32BE(daten.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(typ), daten])));
    return Buffer.concat([laenge, Buffer.from(typ), daten, crc]);
}
function png(groesse) {
    const rand = Math.round(groesse * 0.22);
    const balken = Math.round(groesse * 0.12);
    const links = Math.round(groesse * 0.3);
    const rechts = groesse - links - balken;
    const mitteY = Math.round(groesse / 2);
    const zeilen = [];
    for (let y = 0; y < groesse; y++) {
        const zeile = Buffer.alloc(1 + groesse * 4);
        for (let x = 0; x < groesse; x++) {
            const imH = y >= rand && y < groesse - rand &&
                ((x >= links && x < links + balken) || (x >= rechts && x < rechts + balken) ||
                 (Math.abs(y - mitteY) < balken / 2 && x >= links && x < rechts + balken));
            zeile.set(imH ? VORDERGRUND : HINTERGRUND, 1 + x * 4);
        }
        zeilen.push(zeile);
    }
    const kopf = Buffer.alloc(13);
    kopf.writeUInt32BE(groesse, 0); kopf.writeUInt32BE(groesse, 4);
    kopf[8] = 8; kopf[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', kopf), chunk('IDAT', zlib.deflateSync(Buffer.concat(zeilen))), chunk('IEND', Buffer.alloc(0))
    ]);
}

fs.mkdirSync(ziel, { recursive: true });
for (const [datei, groesse] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    fs.writeFileSync(path.join(ziel, datei), png(groesse));
    console.log(`geschrieben: ${datei}`);
}
