// End-to-End: eine E-Mail (.eml) wird per Drag & Drop auf teilnehmer.html gezogen. Die Kämpfer
// daraus erscheinen zur Korrektur in der Import-Vorschau (Zellen bearbeitbar, Zeilen entfernbar) und
// werden erst mit "Import starten" gespeichert.
import { test, expect } from '@playwright/test';

const TURNIER_NAME = `E2E-Mail-Import ${Date.now()}`;
const WETTKAMPFJAHR = 2027;

const EML = [
    'From: =?UTF-8?Q?Trainer_Senden?= <trainer@example.org>',
    'Subject: Meldung',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hallo,',
    '',
    'hier unsere Meldung.',
    'Verein: JC Senden',
    '',
    'Jungen:',
    '1. Max Mustermann, *2018, 30 kg',
    '2. Ben M=C3=BCller 03.07.2019 33 kg',
    'M=C3=A4dchen:',
    '3. Lena Klein, Jg. 2018, 28 kg',
    '4. Kein Kaempfer ohne Jahrgang',
    '',
    'Viele Gr=C3=BC=C3=9Fe',
    ''
].join('\r\n');

async function ziehe(page, name, inhalt) {
    await page.evaluate(({ name, inhalt }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([inhalt], name, { type: 'message/rfc822' }));
        document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { name, inhalt });
}

test.describe.serial('Import aus E-Mail (Drag & Drop)', () => {
    let page;
    let turnierId;

    test.beforeAll(async ({ browser }) => {
        page = await (await browser.newContext()).newPage();
    });
    test.afterAll(async () => { await page.close(); });

    test('Turnier mit U11 männlich/weiblich anlegen', async () => {
        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill(TURNIER_NAME);
        await page.locator('#datum').fill(`${WETTKAMPFJAHR}-09-18`);
        await page.locator('#ort').fill('Senden');
        await page.locator('#plz').fill('48308');
        await page.locator('#ausrichter').fill('JC Senden');
        await page.locator('#anzahl_kampfflaechen').fill('2');
        await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
        await page.locator('input[name="altersklasse_cb"][value="männlich_U11"]').check();
        await page.locator('input[name="altersklasse_cb"][value="weiblich_U11"]').check();
        await page.locator('#submitBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);
        turnierId = new URL(page.url()).searchParams.get('id');
        await page.goto(`/teilnehmer.html?id=${turnierId}`);
        await expect(page.locator('#importBtn')).toBeVisible();
    });

    test('E-Mail ablegen: Kämpfer werden erkannt, korrigiert und erst per Knopf gespeichert', async () => {
        await ziehe(page, 'meldung.eml', EML);

        const modal = page.locator('#importVorschauModal');
        await expect(modal).toBeVisible();
        await expect(page.locator('#importVorschauTitel')).toContainText('E-Mail');

        const zeilen = page.locator('#importVorschauBody tr');
        await expect(zeilen).toHaveCount(3);
        await expect(zeilen.nth(0)).toContainText('Max');
        await expect(zeilen.nth(0)).toContainText('JC Senden');
        await expect(zeilen.nth(1)).toContainText('Müller');
        await expect(zeilen.nth(2)).toContainText('weiblich');

        // Noch nichts gespeichert
        await expect(page.locator('#teilnehmerTableBody')).not.toContainText('Mustermann');

        // Zelle korrigieren: Nachname von Ben
        const nachnameZelle = zeilen.nth(1).locator('td[data-mail-spalte="1"]');
        await nachnameZelle.click();
        await nachnameZelle.fill('Mueller-Korrigiert');
        await nachnameZelle.press('Enter');
        await expect(page.locator('#importVorschauBody tr').nth(1)).toContainText('Mueller-Korrigiert');

        // Lena wieder entfernen
        await page.locator('#importVorschauBody tr').nth(2).locator('[data-mail-loeschen]').click();
        await expect(page.locator('#importVorschauBody tr')).toHaveCount(2);

        await page.locator('#importVorschauStartenBtn').click();
        await expect(modal).toBeHidden();

        const liste = page.locator('#teilnehmerTableBody');
        await expect(liste).toContainText('Mustermann');
        await expect(liste).toContainText('Mueller-Korrigiert');
        await expect(liste).not.toContainText('Klein');
    });

    test('Mail ohne Kämpfer meldet das und öffnet keine Vorschau', async () => {
        await ziehe(page, 'leer.eml', 'Subject: x\r\nContent-Type: text/plain\r\n\r\nHallo, bis bald.\r\n');
        await expect(page.locator('#snackbarText')).toContainText('keine Teilnehmer');
        await expect(page.locator('#importVorschauModal')).toBeHidden();
    });
});
