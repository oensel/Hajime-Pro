// Testbilder für die Urkunden-Bilder: kleinste gültige Dateien (1×1 Pixel) und ein Mini-PNG-Encoder
// für Bilder mit Transparenz.
import zlib from 'node:zlib';

export const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const JPEG_1PX = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function crc32(bytes) {
    let crc = ~0;
    for (const b of bytes) {
        crc ^= b;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}

function chunk(typ, daten) {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const typDaten = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typDaten));
    return Buffer.concat([laenge, typDaten, crc]);
}

// zeilen: Array von Zeilen (Buffer der Pixeldaten ohne Filterbyte); farbtyp 6 = RGBA, 3 = Palette.
function png({ breite, hoehe, farbtyp, zeilen, zusatz = [] }) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(breite, 0);
    ihdr.writeUInt32BE(hoehe, 4);
    ihdr[8] = 8; // Bit-Tiefe
    ihdr[9] = farbtyp;
    const roh = Buffer.concat(zeilen.map(z => Buffer.concat([Buffer.from([0]), z])));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        ...zusatz,
        chunk('IDAT', zlib.deflateSync(roh)),
        chunk('IEND', Buffer.alloc(0))
    ]).toString('base64');
}

// 2×1 RGBA: links deckend rot, rechts vollständig transparent (wie ein im Browser aus GIF erzeugtes PNG).
export const PNG_RGBA_TRANSPARENT = png({
    breite: 2, hoehe: 1, farbtyp: 6,
    zeilen: [Buffer.from([255, 0, 0, 255, 0, 0, 0, 0])]
});

// 2×1 Palette mit tRNS: Index 0 deckend blau, Index 1 transparent.
export const PNG_PALETTE_TRANSPARENT = png({
    breite: 2, hoehe: 1, farbtyp: 3,
    zeilen: [Buffer.from([0, 1])],
    zusatz: [chunk('PLTE', Buffer.from([0, 0, 255, 255, 255, 255])), chunk('tRNS', Buffer.from([255, 0]))]
});
