// Erzeugt desktop/build/icon.png (1024x1024) aus dem Zeichen (Judo-Jacke mit Gürtel, ohne Schriftzug)
// im Logo public/hajime_pro.png — electron-builder braucht ein quadratisches Icon >= 512 px für alle
// drei Plattformen; dieselbe Datei dient im Server-Paket als Tray-Symbol. Android-Symbole:
// scripts/erzeuge-android-icon.mjs.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';

const logo = readFileSync('public/hajime_pro.png').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
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

await page.setContent(`<body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:180px;">
  <img src="${zeichen.url}" style="height:${Math.round(1024 * 0.7)}px"></body>`);
await page.screenshot({ path: 'desktop/build/icon.png', omitBackground: true });
// Kleines transparentes Zeichen für die Top-Bar der Handy-Ansicht der Android-App (public/hajime_zeichen.png).
const zeichenPng = await page.evaluate(async (z) => {
    const bild = new Image();
    await new Promise((ok) => { bild.onload = ok; bild.src = z.url; });
    const h = 192, w = Math.round(z.w / z.h * h);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bild, 0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
}, zeichen);
writeFileSync('public/hajime_zeichen.png', Buffer.from(zeichenPng, 'base64'));
console.log('public/hajime_zeichen.png erzeugt');
await browser.close();
console.log('desktop/build/icon.png erzeugt');
