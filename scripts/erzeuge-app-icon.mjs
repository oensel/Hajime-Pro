// Erzeugt desktop/build/icon.png (1024x1024) aus dem Logo — electron-builder braucht ein
// quadratisches Icon >= 512 px für alle drei Plattformen.
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';

const logo = readFileSync('public/hajime_pro.png').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:180px;">
  <img src="data:image/png;base64,${logo}" style="width:900px"></body>`);
await page.screenshot({ path: 'desktop/build/icon.png', omitBackground: true });
await browser.close();
console.log('desktop/build/icon.png erzeugt');
