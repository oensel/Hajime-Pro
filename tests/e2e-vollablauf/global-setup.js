// Läuft einmalig vor der Vollablauf-Suite (siehe globalSetup in playwright.vollablauf.config.js): initialisiert
// die Cleanup-Statusdatei (siehe run-state.js), damit ein wiederholter Lauf nicht mit den ID-Listen eines vorherigen
// (bereits aufgeräumten) Laufs startet. Die Online-DB ist die echte Cloud-DB mit bereits existierendem Live-Schema
// und wird bewusst NICHT migriert/verändert; das frische, migrierte Offline-PostgreSQL startet
// tests/helpers/pg-dienst.mjs (erster webServer-Eintrag).
import { initialisiereStatus } from './run-state.js';

export default async function globalSetup() {
    initialisiereStatus();
}
