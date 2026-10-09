// Fake-Audioplayer für die E2E-Suite (DURCHSAGE_PLAYER_BEFEHL): schreibt das PCM der Live-Durchsage in eine Datei,
// statt es abzuspielen. Der Pfad kommt aus DURCHSAGE_TESTDATEI.
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

const datei = process.env.DURCHSAGE_TESTDATEI;
mkdirSync(path.dirname(datei), { recursive: true });
process.stdin.pipe(createWriteStream(datei));
