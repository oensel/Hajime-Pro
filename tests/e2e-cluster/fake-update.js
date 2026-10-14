// Testersatz für hajime-update.sh: schreibt die Statusdatei wie das Root-Skript und merkt sich den Aufruf.
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';

const [, , statusDatei, ziel] = process.argv;
mkdirSync(path.dirname(statusDatei), { recursive: true });
appendFileSync(`${statusDatei}.aufrufe`, `${ziel}\n`);
writeFileSync(statusDatei, JSON.stringify({ zustand: 'fertig', ziel, meldung: 'Testupdate', zeit: new Date().toISOString() }));
