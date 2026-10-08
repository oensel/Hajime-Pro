// Dunkelmodus der Steuerung (steuerung.html). Gleicher Schlüssel wie das Seitenmenü (menu.js) und das
// Menü der Android-App (handy.js), damit die Wahl überall gilt. Das Theme wird sofort beim Parsen gesetzt
// (Script im <head>), damit die Seite nicht erst hell aufblitzt; der Umschalter wird nach dem Laden angebunden.
(function () {
    const SCHLUESSEL = 'hajime-theme';
    const lies = () => { try { return localStorage.getItem(SCHLUESSEL) || 'light'; } catch (e) { return 'light'; } };
    const setze = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(SCHLUESSEL, theme); } catch (e) { /* ohne Speicher */ }
    };
    document.documentElement.setAttribute('data-theme', lies());

    document.addEventListener('DOMContentLoaded', () => {
        const knopf = document.getElementById('steuerungThemeToggle');
        if (!knopf) return;
        const aktualisiere = () => {
            const dunkel = document.documentElement.getAttribute('data-theme') === 'dark';
            knopf.textContent = dunkel ? '☀️ Hell' : '🌙 Dunkel';
            knopf.title = dunkel ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln';
        };
        aktualisiere();
        knopf.addEventListener('click', (e) => {
            e.stopPropagation(); // sitzt im klappbaren Kopf — nicht den Abschnitt ein-/ausklappen
            setze(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
            aktualisiere();
        });
    });
})();
