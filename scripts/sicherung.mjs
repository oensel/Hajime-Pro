// Komplettsicherung der Datenbank (gleiches Dateiformat wie die Seite „Sicherung“, siehe src/services/datensicherung.js):
//   node scripts/sicherung.mjs sichern [datei]                 schreibt eine Sicherung (Standard: ./data/sicherungen/sicherung-<Zeit>.hajime-sicherung.gz[.enc])
//   node scripts/sicherung.mjs wiederherstellen <datei> --ja   ersetzt ALLE Daten durch die Sicherung (legt vorher eine Sicherung an)
//   node scripts/sicherung.mjs liste                           zeigt die Sicherungen im Verzeichnis
//   node scripts/sicherung.mjs pruefen <datei>                 prüft eine Sicherung ohne Datenbank (Entschlüsseln, Aufbau, Zählung), z. B. eine Kopie aus der Ablage
//   node scripts/sicherung.mjs entschluesseln <datei> [ziel]   schreibt die entschlüsselte .hajime-sicherung.gz (ohne Datenbank)
// Mit SICHERUNG_PASSWORT bzw. SICHERUNG_PASSWORT_DATEI (siehe src/services/sicherungsVerschluesselung.js) entstehen Sicherungen verschlüsselt und
// verschlüsselte lassen sich mit demselben Passwort einspielen, prüfen und entschlüsseln. Die Datenbank (DB_URL bzw. DB_HOST/DB_USER/
// DB_PASSWORD/DB_NAME aus .env) braucht nur: sichern, wiederherstellen. Für Cron geeignet.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import dotenv from 'dotenv';
import knexLib from 'knex';
import dbVerbindung from '../src/config/dbVerbindung.cjs';
import {
    schreibeSicherung, schreibeSicherungsdatei, stelleWiederHer, listeSicherungsdateien, sicherungsVerzeichnis, pruefeSicherung
} from '../src/services/datensicherung.js';
import { leseSicherungsPasswort, erzeugeEntschluesselung, istVerschluesselt } from '../src/services/sicherungsVerschluesselung.js';

dotenv.config({ quiet: true });
const [befehl, argument, ...optionen] = process.argv.slice(2);
const BEFEHLE = ['sichern', 'wiederherstellen', 'liste', 'pruefen', 'entschluesseln'];
if (!BEFEHLE.includes(befehl)) {
    console.error('Aufruf: node scripts/sicherung.mjs sichern [datei] | wiederherstellen <datei> --ja | liste | pruefen <datei> | entschluesseln <datei> [ziel]');
    process.exit(1);
}

let knex = null;
const datenbank = () => {
    knex ||= knexLib({ client: 'pg', connection: dbVerbindung.baueVerbindung(process.env, { migration: false }), pool: { min: 0, max: 2 } });
    return knex;
};

try {
    const verzeichnis = sicherungsVerzeichnis();
    if (befehl === 'sichern') {
        if (argument) {
            await schreibeSicherung(datenbank(), fs.createWriteStream(path.resolve(argument), { mode: 0o600 }));
            console.log(`Sicherung geschrieben: ${path.resolve(argument)}${leseSicherungsPasswort() ? ' (verschlüsselt)' : ' (NICHT verschlüsselt: SICHERUNG_PASSWORT setzen)'}`);
        } else {
            const datei = await schreibeSicherungsdatei(datenbank(), verzeichnis);
            console.log(`Sicherung geschrieben: ${datei.pfad} (${datei.groesse} Bytes${datei.verschluesselt ? ', verschlüsselt' : ', NICHT verschlüsselt: SICHERUNG_PASSWORT setzen'})`);
        }
    } else if (befehl === 'wiederherstellen') {
        if (!argument || !optionen.includes('--ja')) {
            console.error('Das ersetzt ALLE Daten der Datenbank. Aufruf: node scripts/sicherung.mjs wiederherstellen <datei> --ja');
            process.exit(1);
        }
        const ergebnis = await stelleWiederHer(datenbank(), fs.createReadStream(path.resolve(argument)), {
            vorher: async () => {
                const vorher = await schreibeSicherungsdatei(datenbank(), verzeichnis, 'vor-wiederherstellung', { ohneSperre: true });
                console.log(`Aktueller Stand gesichert: ${vorher.pfad}`);
            }
        });
        console.log(`Wiederhergestellt: ${ergebnis.tabellen} Tabellen, ${ergebnis.zeilen} Zeilen.`);
    } else if (befehl === 'pruefen') {
        if (!argument) { console.error('Aufruf: node scripts/sicherung.mjs pruefen <datei>'); process.exit(1); }
        const r = await pruefeSicherung(fs.createReadStream(path.resolve(argument)));
        console.log(`In Ordnung: ${r.verschluesselt ? 'verschlüsselt, ' : 'unverschlüsselt, '}erstellt ${r.erstellt}, ${r.tabellen} Tabellen, ${r.zeilen} Zeilen, ${r.migrationen} Migrationen.`);
    } else if (befehl === 'entschluesseln') {
        if (!argument) { console.error('Aufruf: node scripts/sicherung.mjs entschluesseln <datei> [ziel]'); process.exit(1); }
        const quelle = path.resolve(argument);
        const ziel = path.resolve(optionen[0] && !optionen[0].startsWith('--') ? optionen[0] : (argument.replace(/\.enc$/, '') || `${argument}.gz`));
        if (ziel === quelle) throw new Error('Das Ziel darf nicht die Quelldatei sein.');
        if (fs.existsSync(ziel)) throw new Error(`Das Ziel existiert schon: ${ziel}`);
        const kopf = Buffer.alloc(8);
        const handle = await fs.promises.open(quelle, 'r');
        await handle.read(kopf, 0, 8, 0);
        await handle.close();
        if (!istVerschluesselt(kopf)) throw new Error('Die Datei ist nicht verschlüsselt.');
        const passwort = leseSicherungsPasswort();
        if (!passwort) throw new Error('Kein Passwort: SICHERUNG_PASSWORT oder SICHERUNG_PASSWORT_DATEI setzen.');
        try {
            await pipeline(fs.createReadStream(quelle), erzeugeEntschluesselung(passwort), fs.createWriteStream(ziel, { mode: 0o600 }));
        } catch (err) {
            await fs.promises.rm(ziel, { force: true });
            throw err;
        }
        // die entschlüsselte Datei muss ein vollständiges gzip sein
        await pipeline(fs.createReadStream(ziel), zlib.createGunzip(), async function verwerfen(strom) { for await (const _ of strom) { /* nur prüfen */ } });
        console.log(`Entschlüsselt: ${ziel} (enthält Personendaten, sicher aufbewahren).`);
    } else {
        const dateien = await listeSicherungsdateien(verzeichnis);
        if (dateien.length === 0) console.log(`Keine Sicherungen in ${verzeichnis}.`);
        for (const d of dateien) console.log(`${d.erstellt}  ${String(d.groesse).padStart(12)}  ${d.verschluesselt ? '🔒 ' : '   '}${d.name}`);
    }
} catch (fehler) {
    console.error(fehler.message);
    process.exitCode = 1;
} finally {
    if (knex) await knex.destroy();
}
