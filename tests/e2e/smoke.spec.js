// Grundlegender Rauchtest der Einrichtung selbst: Server startet im Offline-Modus, Seiten laden
// ohne Login-Umweg (siehe requireAuth-Bypass für IS_OFFLINE in src/middleware/auth.js) und ohne
// JS-Fehler in der Konsole.
import { test, expect } from '@playwright/test';

test('turniere.html lädt offline ohne Login und ohne Konsolenfehler', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto('/turniere.html');

    // Kein Login-Modal (siehe showGlobalLoginModal in menu.js) — STEUERUNG_PASSWORD ist für die
    // Testsuite bewusst leer (siehe test-env.js).
    await expect(page.locator('#globalLoginModal')).toHaveCount(0);

    // Sidebar aus menu.js wurde eingehängt.
    await expect(page.locator('.app-sidebar')).toBeVisible();

    // Die Test-DB wird nur EINMAL pro gesamtem Testlauf zurückgesetzt (siehe global-setup.js),
    // nicht pro Spec-Datei — je nachdem, welche anderen Dateien vorher liefen, können hier bereits
    // echte (zukünftig datierte) Turniere existieren. Bewusst NICHT auf den Leerzustand geprüft
    // (das wäre von der Ausführungsreihenfolge der Suite abhängig und brüchig), sondern nur, dass
    // die Liste tatsächlich fertig geladen hat (Leer-Hinweis ODER mindestens eine Turnierkarte).
    const container = page.locator('#tournamentsContainer');
    await expect(container.getByText('Keine anstehenden Turniere vorhanden.').or(container.locator('.tournament-card').first())).toBeVisible();

    expect(consoleErrors, `Unerwartete Konsolenfehler:\n${consoleErrors.join('\n')}`).toEqual([]);
});
