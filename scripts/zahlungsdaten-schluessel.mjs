// Schlüsselwechsel für verschlüsselte Zahlungsdaten (IBAN des Ausrichters, Mandatsdaten):
//   node scripts/zahlungsdaten-schluessel.mjs pruefen
//   node scripts/zahlungsdaten-schluessel.mjs umschluesseln --ja
// Ablauf: neuen Schlüssel erzeugen und als ZAHLUNGSDATEN_SCHLUESSEL setzen, den bisherigen als
// ZAHLUNGSDATEN_SCHLUESSEL_ALT eintragen, Server neu starten, dann umschluesseln. Danach kann _ALT entfallen
// (vorher mit `pruefen` kontrollieren, dass kein Chiffretext mehr unter der alten Kennung steht).
// Gibt nur Zählungen und Kennungen aus, nie Klartext oder Schlüssel. Sicherungen enthalten Chiffretext: den Schlüssel
// getrennt von den Sicherungen verwahren.
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import knexLib from 'knex';
import dbVerbindung from '../src/config/dbVerbindung.cjs';
import { pruefeSchluessel, schluesseleUm } from '../src/services/zahlungsdatenSchluessel.js';

export { pruefeSchluessel, schluesseleUm };

function zeigeBericht(bericht) {
    console.log(`Verschlüsselte Einträge: ${bericht.gesamt}`);
    for (const [kid, anzahl] of Object.entries(bericht.nachKid)) {
        const rolle = kid === bericht.kennung.aktuell ? ' (aktueller Schlüssel)' : kid === bericht.kennung.alt ? ' (alter Schlüssel)' : '';
        console.log(`  Kennung ${kid}${rolle}: ${anzahl}`);
    }
    console.log(`Nicht entschlüsselbar mit den gesetzten Schlüsseln: ${bericht.nichtEntschluesselbar}`);
}

async function hauptprogramm() {
    dotenv.config({ quiet: true });
    const befehl = process.argv[2];
    const ja = process.argv.includes('--ja');
    if (befehl !== 'pruefen' && befehl !== 'umschluesseln') {
        console.error('Aufruf: node scripts/zahlungsdaten-schluessel.mjs pruefen | umschluesseln --ja');
        process.exit(1);
    }
    if (befehl === 'umschluesseln' && !ja) {
        console.error('Zum Umschlüsseln --ja angeben (alle Zahlungsdaten werden in einer Transaktion auf den aktuellen Schlüssel umgestellt).');
        process.exit(1);
    }
    const knex = knexLib({ client: 'pg', connection: dbVerbindung.baueVerbindung(process.env, { migration: false }), pool: { min: 0, max: 1 } });
    try {
        if (befehl === 'umschluesseln') {
            const r = await schluesseleUm(knex, process.env);
            console.log(`Umgeschlüsselt: ${r.vereinsKonten} Konten von Ausrichtern, ${r.mandate} Mandate.`);
        }
        zeigeBericht(await pruefeSchluessel(knex, process.env));
    } catch (fehler) {
        console.error(fehler.message);
        process.exitCode = 1;
    } finally {
        await knex.destroy();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await hauptprogramm();
