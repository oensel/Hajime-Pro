import { defineConfig } from '@playwright/test';
// Rauchtest des Server-Pakets: der GEBAUTEN App (Pfad per HAJIME_APP_PFAD) oder per Entwicklungsstart
// ("electron desktop/server/main.js"). Läuft nicht als root (PostgreSQL verweigert das).
export default defineConfig({ testDir: './tests/electron-server', workers: 1, retries: 0, reporter: [['list']], timeout: 240_000 });
