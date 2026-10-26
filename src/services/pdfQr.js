// QR-Code als Vektorquadrate in eine pdf-lib-Seite zeichnen (Ursprung unten links, Fehlerkorrektur M).
import { rgb } from 'pdf-lib';
import qrcode from 'qrcode-generator';

export function zeichneQr(seite, inhalt, x, y, groesse) {
    const qr = qrcode(0, 'M');
    qr.addData(inhalt);
    qr.make();
    const n = qr.getModuleCount();
    const m = groesse / n;
    seite.drawRectangle({ x, y, width: groesse, height: groesse, color: rgb(1, 1, 1) });
    for (let z = 0; z < n; z++) {
        for (let s = 0; s < n; s++) {
            if (qr.isDark(z, s)) {
                seite.drawRectangle({ x: x + s * m, y: y + groesse - (z + 1) * m, width: m + 0.02, height: m + 0.02, color: rgb(0, 0, 0) });
            }
        }
    }
}
