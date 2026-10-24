// Fenster-Platzierung der Anzeigetafel (anzeige.html) im Desktop-Client, ohne Electron-Abhängigkeit (testbar).
// Die Steuerung öffnet die Anzeige per window.open; liegt am Rechner ein zweiter Bildschirm (TV), geht sie dort in den
// Vollbildmodus, sonst bleibt sie ein normales Fenster.

export function istAnzeigeSeite(url) {
    try { return new URL(url).pathname === '/anzeige.html'; } catch { return false; }
}

/**
 * @param {{id: number, bounds: {x: number, y: number, width: number, height: number}}[]} bildschirme
 * @param {number|null} aktuellId Bildschirm, auf dem das öffnende Fenster (die Steuerung) liegt
 * @returns Fenster-Optionen für Electron (overrideBrowserWindowOptions)
 */
export function anzeigeFensterOptionen(bildschirme, aktuellId) {
    const andere = (bildschirme || []).filter(b => b.id !== aktuellId);
    if (andere.length === 0) {
        return { width: 1280, height: 720, autoHideMenuBar: true, title: 'Hajime Pro – Anzeige' };
    }
    const { x, y, width, height } = andere[0].bounds;
    return { x, y, width, height, fullscreen: true, autoHideMenuBar: true, title: 'Hajime Pro – Anzeige' };
}
