// Urkunden-Generator (docs/specs/2026-09-29-urkunden-generator-design.md):
// Vorlagen-API, Generierung (Seitenzahl je Platzbereich), Designer (urkunden-designer.html),
// Generieren mit Vorlagen-Popup (urkunden.html) und das Druck-Angebot nach "Pool abschließen". Die Tests bauen seriell aufeinander auf.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DK8 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pool-ko-doppel-ko8.json'), 'utf8'));
const BLANKO = fs.readFileSync(path.join(__dirname, 'fixtures/urkunde-blanko.pdf')).toString('base64');
const VORLAGEN_NAME = `Standard ${Date.now()}`;
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// 2×1-GIF: links schwarz, rechts transparent (Transparenzindex 1)
const GIF_TRANSPARENT = 'R0lGODlhAgABAIABAAAAAP///yH5BAEAAAEALAAAAAACAAEAAAICRAoAOw==';
const FELD = { id: 'f1', text: '{Name}', x: 97, y: 400, breite: 400, schrift: 'noto-serif-bold', groesse: 30, farbe: '#1a1a1a', ausrichtung: 'zentriert' };

test.describe.configure({ mode: 'serial' });

let turnierId;
let poolId;
let vorlageId;

async function seitenzahl(resp) {
    return (await PDFDocument.load(await resp.body())).getPageCount();
}

test.describe('Urkunden', () => {
    test.beforeAll(async ({ request }) => {
        ({ turnierId, poolId } = await ladeUndErstelleTurnier(request, DK8));
        await spieleBracketKomplettDurch(request, poolId);
    });

    test('Vorlage anlegen: gültig, doppelter Name, ungültiges PDF', async ({ request }) => {
        const resp = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: VORLAGEN_NAME, pdf_base64: BLANKO, pdf_dateiname: 'blanko.pdf' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        vorlageId = (await resp.json()).id;

        const doppelt = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: VORLAGEN_NAME, pdf_base64: BLANKO }
        });
        expect(doppelt.status()).toBe(409);

        const kaputt = await request.post('/api/urkunden/vorlagen', {
            data: { turnierId, name: `${VORLAGEN_NAME} kaputt`, pdf_base64: Buffer.from('kein pdf').toString('base64') }
        });
        expect(kaputt.status()).toBe(400);
    });

    test('Felder speichern: außerhalb der Seite abgelehnt, gültig gespeichert', async ({ request }) => {
        const aussen = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, {
            data: { felder: [{ ...FELD, x: 500 }] }
        });
        expect(aussen.status()).toBe(400);

        const ok = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, { data: { felder: [FELD] } });
        expect(ok.ok(), await ok.text()).toBeTruthy();

        const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
        expect(liste.find(v => v.id === vorlageId).felder).toEqual([FELD]);
    });

    test('Generieren: Seitenzahl je Platzbereich, leere Auswahl → 422', async ({ request }) => {
        const uebersicht = await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json();
        const pool = uebersicht.pools.find(p => p.id === poolId);
        expect(pool.abgeschlossen).toBe(true);
        expect(pool.anzahl['3']).toBe(4);
        expect(pool.anzahl.alle).toBe(DK8.teilnehmer.length);

        for (const platzbereich of ['3', '7', 'alle']) {
            const resp = await request.post('/api/urkunden/generieren', {
                data: { turnierId, vorlageId, platzbereich, poolIds: [poolId], reihenfolge: 'absteigend' }
            });
            expect(resp.ok(), await resp.text()).toBeTruthy();
            expect(resp.headers()['content-type']).toContain('application/pdf');
            expect(resp.headers()['x-urkunden-anzahl']).toBe(String(pool.anzahl[platzbereich]));
            expect(await seitenzahl(resp)).toBe(pool.anzahl[platzbereich]);
        }

        const leer = await request.post('/api/urkunden/generieren', {
            data: { turnierId, vorlageId, platzbereich: '3', poolIds: [], reihenfolge: 'absteigend' }
        });
        expect(leer.status()).toBe(422);
    });

    test('Linien speichern und Mini-Vorschau als einseitiges PDF', async ({ request }) => {
        const linie = { id: 'l1', typ: 'linie', x: 100, y: 450, breite: 300, staerke: 1.5, stil: 'gepunktet', farbe: '#223344' };
        const falsch = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, {
            data: { felder: [FELD, { ...linie, stil: 'wellig' }] }
        });
        expect(falsch.status()).toBe(400);
        const ok = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, { data: { felder: [FELD, linie] } });
        expect(ok.ok(), await ok.text()).toBeTruthy();

        const vorschau = await request.get(`/api/urkunden/vorlagen/${vorlageId}/vorschau?turnierId=${turnierId}`);
        expect(vorschau.ok(), await vorschau.text()).toBeTruthy();
        expect(vorschau.headers()['content-type']).toContain('application/pdf');
        expect(await seitenzahl(vorschau)).toBe(1);

        const zurueck = await request.put(`/api/urkunden/vorlagen/${vorlageId}?turnierId=${turnierId}`, { data: { felder: [FELD] } });
        expect(zurueck.ok()).toBeTruthy();
    });

    test('Turnier-Export enthält die Vorlagen des Ausrichter-Vereins', async ({ request }) => {
        // Export erst ab Veröffentlichung + echten Kämpfen ("in_durchfuehrung") erlaubt.
        const pub = await request.post(`/api/turniere/${turnierId}/veroeffentlichen`);
        expect(pub.ok(), await pub.text()).toBeTruthy();
        const resp = await request.get(`/api/turniere/${turnierId}/export`);
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const vorlage = (await resp.json()).urkunden_vorlagen?.find(v => v.name === VORLAGEN_NAME);
        expect(vorlage?.felder).toEqual([FELD]);
        expect(vorlage.pdf_base64).toBe(BLANKO);
    });

    test('Turnier-Import nimmt Dateien über 15 MB an (Vorlagen-PDFs doppelt base64-kodiert)', async ({ request }) => {
        // Ungültiger Inhalt: der Import lehnt ihn mit 400 ab, BEVOR er Daten löscht — geprüft wird nur,
        // dass der Body-Parser die Größe nicht schon mit 413 abweist.
        const resp = await request.post('/api/turniere/import', {
            data: { contentBase64: Buffer.alloc(20 * 1024 * 1024, 'x').toString('base64') }
        });
        expect(resp.status()).toBe(400);
    });

    test('Designer: Blanko-PDF über „Neue Vorlage“ → „Eigenes PDF hochladen“', async ({ page, request }) => {
        await page.goto(`/urkunden-designer.html?turnierId=${turnierId}`);
        await expect(page.locator('#vorlagenAuswahl option')).not.toHaveCount(0);
        page.once('dialog', dialog => dialog.accept(`Upload ${Date.now()}`));
        await page.locator('#btnVorlageNeu').click();
        const [dateiauswahl] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('#urkundenNeueVorlageModal [data-aktion="hochladen"]').click()
        ]);
        await dateiauswahl.setFiles(path.join(__dirname, 'fixtures/urkunde-blanko.pdf'));
        await expect(page.locator('#vorlagenAuswahl option:checked')).toContainText('Upload ');
        await expect(page.locator('.canvas-container')).toBeVisible();

        const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
        const hochgeladen = liste.find(v => v.name.startsWith('Upload '));
        expect(hochgeladen.pdf_dateiname).toBe('urkunde-blanko.pdf');
        const del = await request.delete(`/api/urkunden/vorlagen/${hochgeladen.id}?turnierId=${turnierId}`);
        expect(del.ok()).toBeTruthy();
    });

    test('Designer: freies Textfeld und Linie anlegen und speichern', async ({ page, request }) => {
        await page.goto(`/urkunden-designer.html?turnierId=${turnierId}`);
        await expect(page.locator('#nav-urkunden-designer')).toHaveClass(/active/);
        await page.locator('#vorlagenAuswahl').selectOption(String(vorlageId));
        await expect(page.locator('#editorLeer')).toBeHidden();
        // Bearbeitungsfläche in halber Breite der Karte
        const [container, karte] = await Promise.all([
            page.locator('#editorContainer').boundingBox(), page.locator('.urkunden-card').boundingBox()
        ]);
        expect(container.width).toBeLessThan(karte.width * 0.55);
        expect((await page.locator('#vorlagenAuswahl').boundingBox()).width).toBeLessThanOrEqual(250);

        // Beispieldaten als Toggle-Schalter
        await expect(page.locator('#schalterBeispiel')).toHaveAttribute('role', 'switch');
        await page.locator('label.schalter').click();
        await expect(page.locator('#schalterBeispiel')).toBeChecked();
        await page.locator('label.schalter').click();

        await page.locator('#btnFeldText').click();
        await page.locator('#feldText').fill('Kreismeisterschaft 2026');
        // Schriftart + Stil: Noto Serif Kursiv; Familien mit nur einem Schnitt sperren den Stil
        await page.locator('#feldSchrift').selectOption('Cinzel (Titel)');
        await expect(page.locator('#feldStil')).toBeDisabled();
        await page.locator('#feldSchrift').selectOption('Noto Serif');
        await expect(page.locator('#feldStil')).toBeEnabled();
        await page.locator('#feldStil').selectOption('kursiv');
        await page.locator('#btnFeldLinie').click();
        await expect(page.locator('#linienWerkzeuge')).toBeVisible();
        await expect(page.locator('#textWerkzeuge')).toBeHidden();
        await page.locator('#linieStil').selectOption('gestrichelt');
        await page.locator('#linieStaerke').fill('2');
        await page.locator('#linieStaerke').dispatchEvent('change');
        await page.locator('#btnVorlageSpeichern').click();
        await expect.poll(async () => {
            const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
            return liste.find(v => v.id === vorlageId).felder.map(f => f.typ === 'linie' ? `linie:${f.stil}:${f.staerke}` : `${f.text}|${f.schrift}`);
        }).toEqual(['{Name}|noto-serif-bold', 'Kreismeisterschaft 2026|noto-serif-italic', 'linie:gestrichelt:2']);
    });

    test('Bilder: Upload prüfen, Bildfeld speichern, unbenutzte Bilder werden aufgeräumt', async ({ request }) => {
        const url = `/api/urkunden/vorlagen/${vorlageId}`;
        const kaputt = await request.post(`${url}/bilder?turnierId=${turnierId}`, { data: { turnierId, daten_base64: Buffer.from('GIF89a').toString('base64') } });
        expect(kaputt.status()).toBe(400);

        const hoch = async () => (await (await request.post(`${url}/bilder?turnierId=${turnierId}`, { data: { turnierId, daten_base64: PNG_1PX } })).json()).bild_id;
        const benutzt = await hoch();
        const unbenutzt = await hoch();
        const bildFeld = { id: 'i1', typ: 'bild', bild_id: benutzt, x: 250, y: 40, breite: 90, hoehe: 90 };

        const fremd = await request.put(`${url}?turnierId=${turnierId}`, { data: { felder: [FELD, { ...bildFeld, bild_id: 'gibtsnicht' }] } });
        expect(fremd.status()).toBe(400);
        const ok = await request.put(`${url}?turnierId=${turnierId}`, { data: { felder: [FELD, bildFeld] } });
        expect(ok.ok(), await ok.text()).toBeTruthy();

        const bild = await request.get(`${url}/bilder/${benutzt}?turnierId=${turnierId}`);
        expect(bild.headers()['content-type']).toContain('image/png');
        expect((await request.get(`${url}/bilder/${unbenutzt}?turnierId=${turnierId}`)).status()).toBe(404);

        const resp = await request.post('/api/urkunden/generieren', {
            data: { turnierId, vorlageId, platzbereich: '3', poolIds: [poolId], reihenfolge: 'absteigend' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const zurueck = await request.put(`${url}?turnierId=${turnierId}`, { data: { felder: [FELD] } });
        expect(zurueck.ok()).toBeTruthy();
    });

    test('Standard-Design: Vorlage aus Rahmen anlegen, unbekannter Rahmen → 400', async ({ request }) => {
        const resp = await request.post('/api/urkunden/vorlagen', { data: { turnierId, name: `Rahmen ${Date.now()}`, rahmen_id: 'judo' } });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        const id = (await resp.json()).id;
        const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
        const vorlage = liste.find(v => v.id === id);
        expect(vorlage.pdf_dateiname).toBe('judo.pdf');
        expect(vorlage.felder).toEqual([]);
        expect(Math.round(vorlage.seiten_breite_pt)).toBe(595);

        const falsch = await request.post('/api/urkunden/vorlagen', { data: { turnierId, name: `Falsch ${Date.now()}`, rahmen_id: 'gibtsnicht' } });
        expect(falsch.status()).toBe(400);
        await request.delete(`/api/urkunden/vorlagen/${id}?turnierId=${turnierId}`);
    });

    test('Designer: neue Vorlage aus Standard-Design, Bilder (PNG, transparentes GIF) einfügen, neue Schriften', async ({ page, request }) => {
        await page.goto(`/urkunden-designer.html?turnierId=${turnierId}`);
        await expect(page.locator('#vorlagenAuswahl option')).not.toHaveCount(0);
        for (const schrift of ['Pinyon Script', 'Alex Brush', 'UnifrakturMaguntia']) {
            await expect(page.locator('#feldSchrift option', { hasText: schrift })).toHaveCount(1);
        }

        await page.locator('#btnVorlageNeu').click();
        const dialog = page.locator('#urkundenNeueVorlageModal');
        await expect(dialog.locator('.urkunden-vorlage-karte')).toHaveCount(5);
        await expect(dialog.locator('[data-vorlage-id="klassisch"] img')).toBeVisible();
        const name = `Klassisch ${Date.now()}`;
        page.once('dialog', d => d.accept(name));
        await dialog.locator('[data-vorlage-id="klassisch"]').click();
        await expect(page.locator('#vorlagenAuswahl option:checked')).toHaveText(name);

        await page.locator('#btnFeldBild').click();
        await page.locator('#bildDatei').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') });
        // Bild wird hochgeladen und dekodiert, bevor das Feld ausgewählt ist; im Gesamtlauf der Suite dauert das länger als 5 s.
        await expect(page.locator('#textWerkzeuge')).toBeHidden({ timeout: 20_000 });
        await expect(page.locator('#farbeWerkzeug')).toBeHidden();
        await page.locator('#btnVorlageSpeichern').click();
        await expect.poll(async () => {
            const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
            return liste.find(v => v.name === name)?.felder.map(f => f.typ);
        }).toEqual(['bild']);

        // GIF wird im Browser zu PNG; der transparente Pixel bleibt transparent.
        await page.locator('#btnFeldBild').click();
        await page.locator('#bildDatei').setInputFiles({ name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from(GIF_TRANSPARENT, 'base64') });
        await page.locator('#btnVorlageSpeichern').click();
        let neu;
        await expect.poll(async () => {
            neu = (await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json()).find(v => v.name === name);
            return neu.felder.length;
        }).toBe(2);
        const gifFeld = neu.felder[1];
        const bildUrl = `/api/urkunden/vorlagen/${neu.id}/bilder/${gifFeld.bild_id}?turnierId=${turnierId}`;
        expect((await request.get(bildUrl)).headers()['content-type']).toContain('image/png');
        const alpha = await page.evaluate(async url => {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            return [g.getImageData(0, 0, 1, 1).data[3], g.getImageData(1, 0, 1, 1).data[3]];
        }, bildUrl);
        expect(alpha).toEqual([255, 0]);

        await request.delete(`/api/urkunden/vorlagen/${neu.id}?turnierId=${turnierId}`);
    });

    test('Generieren: Vorlage im Popup mit Mini-Ansicht wählen, Vorschau öffnet sich', async ({ page }) => {
        await page.goto(`/urkunden.html?turnierId=${turnierId}`);
        await expect(page.locator('#vorlagenAuswahl')).toHaveCount(0);
        await expect(page.locator('#genReihenfolge option')).toHaveText(['letzter Platz zuerst', '1. Platz zuerst']);
        await page.locator('#genVorlage').click();
        const popup = page.locator('#urkundenVorlagenAuswahlModal');
        const karte = popup.locator(`[data-vorlage-id="${vorlageId}"]`);
        await expect(karte.locator('img')).toBeVisible();
        await karte.click();
        await expect(popup).toHaveCount(0);
        await expect(page.locator('#genVorlageName')).toHaveText(VORLAGEN_NAME);

        await page.locator(`#genPoolListe input[data-pool-id="${poolId}"]`).check();
        await page.locator('#btnGenerieren').click();
        await expect(page.locator('#urkundenVorschauFrame')).toHaveAttribute('src', /^blob:/);
    });

    test('PDF je Pool: nach dem Generieren erkennbar, öffnen, neu erzeugen, löschen', async ({ page, request }) => {
        const pdfUrl = `/api/urkunden/pools/${poolId}/pdf?turnierId=${turnierId}`;
        const gespeichert = async () => (await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json())
            .pools.find(p => p.id === poolId).pdf;

        const resp = await request.post('/api/urkunden/generieren', {
            data: { turnierId, vorlageId, platzbereich: '5', poolIds: [poolId], reihenfolge: 'aufsteigend' }
        });
        expect(resp.headers()['x-urkunden-gespeichert']).toBe('1');
        const anzahl = Number(resp.headers()['x-urkunden-anzahl']);
        expect(await gespeichert()).toMatchObject({ vorlage_id: vorlageId, vorlage_name: VORLAGEN_NAME, platzbereich: '5', reihenfolge: 'aufsteigend', anzahl });
        expect(await seitenzahl(await request.get(pdfUrl))).toBe(anzahl);

        await page.goto(`/urkunden.html?turnierId=${turnierId}`);
        const marke = page.locator(`[data-pool-pdf="${poolId}"]`);
        const vorschau = page.locator('#urkundenVorschauModal');
        await expect(marke).toBeVisible();

        await marke.locator('[data-pdf-aktion="oeffnen"]').click();
        await expect(vorschau).toContainText(`(${anzahl} Seiten)`);
        await expect(page.locator('#urkundenVorschauFrame')).toHaveAttribute('src', /^blob:/);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            vorschau.locator('[data-aktion="download"]').click()
        ]);
        expect(download.suggestedFilename()).toBe('urkunden.pdf');
        const hoehen = await vorschau.locator('button.btn').evaluateAll(knoepfe => knoepfe.map(k => k.offsetHeight));
        expect(new Set(hoehen).size).toBe(1);
        await vorschau.locator('[data-aktion="schliessen"]').click();

        // Neu erzeugen übernimmt die Einstellungen des vorhandenen PDFs (1.–5.), nicht die der Seite (1.–3.).
        const vorher = (await gespeichert()).erzeugt_am;
        await marke.locator('[data-pdf-aktion="neu"]').click();
        await expect(vorschau).toContainText(`(${anzahl} Seiten)`);
        const danach = await gespeichert();
        expect(danach.platzbereich).toBe('5');
        expect(danach.erzeugt_am > vorher).toBe(true);
        await vorschau.locator('[data-aktion="schliessen"]').click();

        page.once('dialog', dialog => dialog.accept());
        await marke.locator('[data-pdf-aktion="loeschen"]').click();
        await expect(marke).toHaveCount(0);
        expect(await gespeichert()).toBeNull();
        expect((await request.get(pdfUrl)).status()).toBe(404);
    });

    // Neues Turnier (gleicher Ausrichter-Verein, also dieselbe Vorlage) durchspielen und den Pool
    // über den Kampfplan in pools.html abschließen.
    async function schliessePoolUeberOberflaecheAb(page, request) {
        const neu = await ladeUndErstelleTurnier(request, DK8);
        await spieleBracketKomplettDurch(request, neu.poolId);
        await page.goto(`/pools.html?turnierId=${neu.turnierId}`);
        await page.locator(`.btn-view-fightplan[data-id="${neu.poolId}"]`).click();
        await page.locator('#confirmFightplanBtn').click();
        await page.locator('#modalConfirmBtn').click();
        await expect.poll(async () => {
            const pools = await (await request.get(`/api/pools/details?turnierId=${neu.turnierId}`)).json();
            return pools.find(p => p.id === neu.poolId).status;
        }).toBe('abgeschlossen');
        return neu;
    }

    test('Pool abschließen bietet den Druck mit Wahl von Vorlage, Platzierungen und Reihenfolge an', async ({ page, request }) => {
        const neu = await schliessePoolUeberOberflaecheAb(page, request);
        const angebot = await (await request.get(`/api/urkunden/abschluss-angebot?turnierId=${neu.turnierId}&poolId=${neu.poolId}`)).json();
        expect(angebot.vorlagen.map(v => v.id)).toContain(vorlageId);

        const dialog = page.locator('#urkundenAngebotModal');
        await expect(dialog).toContainText('Urkunden für');
        await dialog.locator(`[data-vorlage-id="${vorlageId}"]`).click();
        await expect(dialog.locator(`[data-vorlage-id="${vorlageId}"]`)).toHaveAttribute('aria-pressed', 'true');
        await dialog.locator('[data-feld="platzbereich"]').selectOption('5');
        await dialog.locator('[data-feld="reihenfolge"]').selectOption('aufsteigend');
        await expect(dialog.locator('[data-anzahl]')).toHaveText(`${angebot.anzahl['5']} Urkunden`);
        await dialog.locator('[data-aktion="drucken"]').click();
        await expect(page.locator('#urkundenVorschauFrame')).toHaveAttribute('src', /^blob:/);
        await expect(page.locator('#urkundenVorschauModal')).toContainText(`(${angebot.anzahl['5']} Seiten)`);
    });

    test('ohne Vorlage erscheint beim Abschließen kein Dialog', async ({ page, request }) => {
        const liste = await (await request.get(`/api/urkunden/vorlagen?turnierId=${turnierId}`)).json();
        for (const v of liste) {
            const del = await request.delete(`/api/urkunden/vorlagen/${v.id}?turnierId=${turnierId}`);
            expect(del.ok()).toBeTruthy();
        }

        await schliessePoolUeberOberflaecheAb(page, request);
        await page.waitForTimeout(1000);
        await expect(page.locator('#urkundenAngebotModal')).toHaveCount(0);
    });
});
