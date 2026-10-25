// Der Dialog "Neuer Verein: Rechnungsdaten jetzt erfassen?" (#vorOrtDialog) erscheint am Hallen-Server nach dem Anlegen
// eines Kämpfers eines neuen Vereins bei Startgeld > 0 und blockiert die Seite. Tests, die nur Teilnehmer anlegen,
// lassen ihn automatisch mit "Später an der Kasse" wegklicken (Playwright-Locator-Handler).
export async function schliesseVorOrtDialogAutomatisch(page) {
    await page.addLocatorHandler(page.locator('#vorOrtDialog'), async () => {
        await page.locator('#vorOrtSpaeterBtn').click();
    });
}
