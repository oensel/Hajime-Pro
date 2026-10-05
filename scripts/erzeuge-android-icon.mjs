// Erzeugt die Launcher-Symbole der Android-App (mobil/android/app/src/main/res/mipmap-*) aus dem
// Zeichen (Judo-Jacke mit Gürtel) im Logo public/hajime_pro.png: adaptives Symbol (Vordergrund auf
// weißem Hintergrund) plus die Symbole für ältere Android-Versionen (eckig/rund).
// Nicht Teil der CI — die Ergebnisse sind committet. Aufruf: npm run android:icon
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const res = 'mobil/android/app/src/main/res';
const logo = readFileSync('public/hajime_pro.png').toString('base64');
const dichten = {
    mdpi: { launcher: 48, vordergrund: 108 },
    hdpi: { launcher: 72, vordergrund: 162 },
    xhdpi: { launcher: 96, vordergrund: 216 },
    xxhdpi: { launcher: 144, vordergrund: 324 },
    xxxhdpi: { launcher: 192, vordergrund: 432 }
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<body></body>');

// Zeichen ausschneiden: erste zusammenhängende Gruppe nicht-weißer Spalten (links von der Schrift).
const zeichen = await page.evaluate(async (b64) => {
    const bild = new Image();
    await new Promise((ok, err) => { bild.onload = ok; bild.onerror = err; bild.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = bild.width; c.height = bild.height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bild, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const dunkel = (px, py) => { const i = (py * c.width + px) * 4; return d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200; };
    const spalte = (px) => { for (let py = 0; py < c.height; py++) if (dunkel(px, py)) return true; return false; };
    let links = 0; while (links < c.width && !spalte(links)) links++;
    let rechts = links; while (rechts < c.width && spalte(rechts)) rechts++;
    let oben = c.height, unten = 0;
    for (let px = links; px < rechts; px++) for (let py = 0; py < c.height; py++) if (dunkel(px, py)) { oben = Math.min(oben, py); unten = Math.max(unten, py); }
    const w = rechts - links, h = unten - oben + 1;
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d').drawImage(c, links, oben, w, h, 0, 0, w, h);
    return { url: out.toDataURL('image/png'), w, h };
}, logo);
console.log(`Zeichen ausgeschnitten: ${zeichen.w}x${zeichen.h}`);

async function rendere(groesse, anteil, form, transparent) {
    return page.evaluate(async ({ groesse, anteil, form, transparent, zeichen }) => {
        const bild = new Image();
        await new Promise((ok) => { bild.onload = ok; bild.src = zeichen.url; });
        const c = document.createElement('canvas'); c.width = c.height = groesse;
        const x = c.getContext('2d');
        if (!transparent) {
            x.fillStyle = '#fff';
            x.beginPath();
            if (form === 'rund') x.arc(groesse / 2, groesse / 2, groesse / 2, 0, Math.PI * 2);
            else x.roundRect(0, 0, groesse, groesse, groesse * 0.18);
            x.fill();
        }
        const maxSeite = groesse * anteil;
        const f = Math.min(maxSeite / zeichen.w, maxSeite / zeichen.h);
        const w = zeichen.w * f, h = zeichen.h * f;
        x.imageSmoothingQuality = 'high';
        x.drawImage(bild, (groesse - w) / 2, (groesse - h) / 2, w, h);
        return c.toDataURL('image/png').split(',')[1];
    }, { groesse, anteil, form, transparent, zeichen });
}

const schreibe = (datei, b64) => writeFileSync(path.join(res, datei), Buffer.from(b64, 'base64'));
for (const [dichte, g] of Object.entries(dichten)) {
    const ordner = `mipmap-${dichte}`;
    // Adaptiv: Sicherheitszone ist der mittlere Kreis (66/108), das Zeichen bleibt darin.
    schreibe(`${ordner}/ic_launcher_foreground.png`, await rendere(g.vordergrund, 0.5, 'quadrat', true));
    schreibe(`${ordner}/ic_launcher.png`, await rendere(g.launcher, 0.72, 'quadrat', false));
    schreibe(`${ordner}/ic_launcher_round.png`, await rendere(g.launcher, 0.62, 'rund', false));
}
await browser.close();
console.log('Android-Launcher-Symbole erzeugt');
