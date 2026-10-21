// End-to-End: Beim Wechsel über das Menü steht die Seitenleiste schon im ersten Bild der neuen Seite (gemerkter
// Menüstand als Platzhalter aus menu.js), statt erst nach den Serverabfragen aufzutauchen; das echte Menü
// übernimmt danach ohne sichtbaren Sprung (kein Ausblenden, kein Einblenden der Hervorhebung, kein Springen der
// Icons) und korrigiert veraltete Punkte.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn, loseAus, verteileAufMatten } from './helpers/turnier-aufbau.js';

// Hält ab dem ersten gezeichneten Bild mit Inhalt für 90 Bilder fest, welche Menüpunkte wie sichtbar sind (vor
// jedem Zeichnen laufen die requestAnimationFrame-Rückrufe).
async function beobachteBilder(page) {
    await page.addInitScript(() => {
        window.__menueBilder = [];
        const pruefe = () => {
            if (document.body && document.body.childElementCount > 0) {
                window.__menueBilder.push({
                    platzhalter: !!document.querySelector('.menue-platzhalter'),
                    punkte: Array.from(document.querySelectorAll('.app-sidebar .menu-item'))
                        .filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible')
                        .map(el => ({
                            id: el.id || el.getAttribute('data-platzhalter-id'),
                            gesperrt: el.classList.contains('disabled'),
                            aktiv: el.classList.contains('active'),
                            hintergrund: getComputedStyle(el).backgroundColor,
                            unterpunkt: el.classList.contains('menu-subitem'),
                            iconBreite: el.querySelector('.material-icons')?.offsetWidth
                        }))
                });
            }
            if (window.__menueBilder.length < 90) requestAnimationFrame(pruefe);
        };
        requestAnimationFrame(pruefe);
    });
}

const holeBilder = async (page) => {
    await page.waitForFunction(() => window.__menueBilder.length >= 90);
    return page.evaluate(() => window.__menueBilder);
};

async function warteAufFertigesMenue(page) {
    await expect(page.locator('#sidebarNavPrimary')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.menue-platzhalter')).toHaveCount(0);
}

test('Nach einem Klick im Menü ist die Seitenleiste sofort da und wird dann vom echten Menü abgelöst', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Menü Seitenwechsel' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 3, gewichtStart: 66 });
    await loseAus(request, turnierId, ['U18']);
    await verteileAufMatten(request, turnierId);
    await beobachteBilder(page);

    await page.goto(`/turnier.html?id=${turnierId}`);
    await warteAufFertigesMenue(page);

    await page.locator('#nav-matten').click();
    await expect(page).toHaveURL(u => u.pathname === '/matten.html');
    await warteAufFertigesMenue(page);
    const bilder = await holeBilder(page);
    expect(bilder[0].platzhalter).toBe(true);
    expect(bilder.at(-1).platzhalter).toBe(false);
    expect(bilder[0].punkte.map(p => p.id)).toEqual(expect.arrayContaining(['nav-turniere', 'nav-turnier', 'nav-teilnehmer', 'nav-matten', 'nav-kampf']));
    // Vom ersten Bild an bis nach der Übergabe an das echte Menü bleibt jeder Punkt unverändert stehen.
    for (const bild of bilder) expect(bild.punkte).toEqual(bilder[0].punkte);
    // Unterpunkte (z. B. Urkunden-Designer in der Gruppe Orga) haben bewusst kein Icon
    expect(bilder[0].punkte.filter(p => !p.unterpunkt).every(p => p.iconBreite === 20)).toBe(true);
    expect(bilder[0].punkte.find(p => p.id === 'nav-matten')).toMatchObject({ aktiv: true, gesperrt: false });

    await expect(page.locator('.app-sidebar')).toHaveCount(1);
    await expect(page.locator('#nav-matten')).toHaveClass(/active/);
    await expect(page.locator('#nav-turnier')).not.toHaveClass(/active/);
});

test('Ein veralteter gemerkter Stand wird nach dem Laden korrigiert', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, { name: 'Menü veraltet' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 3, gewichtStart: 66 });
    await beobachteBilder(page);

    // Ohne Pools ist "Matten" gesperrt — so wird der Stand gemerkt.
    await page.goto(`/turnier.html?id=${turnierId}`);
    await warteAufFertigesMenue(page);
    await expect(page.locator('#nav-matten')).toHaveClass(/disabled/);

    // Pools entstehen außerhalb dieser Seite; der nächste Seitenwechsel zeigt zuerst den alten Stand.
    await loseAus(request, turnierId, ['U18']);
    await page.locator('#nav-teilnehmer').click();
    await expect(page).toHaveURL(u => u.pathname === '/teilnehmer.html');
    await warteAufFertigesMenue(page);
    const bilder = await holeBilder(page);
    expect(bilder[0].punkte.find(p => p.id === 'nav-matten')).toMatchObject({ gesperrt: true });

    await expect(page.locator('#nav-matten')).not.toHaveClass(/disabled/);
    await expect(page.locator('#nav-teilnehmer')).toHaveClass(/active/);
});
