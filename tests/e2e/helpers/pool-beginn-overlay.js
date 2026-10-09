// Das Pool-Beginn-Overlay der Steuerung (#poolBeginnOverlay) blockiert die Seite, bis jemand "Erledigt" klickt. Tests,
// die die Steuerung nur bedienen, lassen es automatisch wegklicken, sobald es einer Aktion im Weg ist
// (Playwright-Locator-Handler). Der Test des Overlays selbst (steuerung-pool-beginn-meldung.spec.js) nutzt das nicht.
export async function schliesseOverlayAutomatisch(page) {
    await page.addLocatorHandler(page.locator('#poolBeginnOverlay'), async () => {
        await page.locator('#poolBeginnErledigtBtn').click();
    });
}
