import { defineConfig } from '@playwright/test';
// Rauchtest der GEBAUTEN App (Pfad per HAJIME_APP_PFAD, sonst Entwicklungsstart per "electron .").
export default defineConfig({ testDir: './tests/electron', workers: 1, retries: 0, reporter: [['list']], timeout: 90_000 });
