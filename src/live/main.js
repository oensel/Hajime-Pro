// Einstieg des Live-Prozesses: node src/live/main.js (systemd-Dienst hajime-live auf dem Slave).
// Verbindet sich nur mit der Rolle live_ro (nur Views), baut Snapshots und sendet sie ausgehend an die Cloud.
import knexLib from 'knex';
import { liesLiveKonfig } from './konfig.js';
import { ladeSnapshots } from './snapshot.js';
import { erzeugeUplink } from './uplink.js';
import { starteLiveDienst } from './dienst.js';

// Bewusst kein dotenv: der Prozess liest nur die Umgebung aus live.env (systemd), nie die .env der App mit deren
// Datenbank- und Steuerungs-Zugangsdaten.
let konfig;
try {
    konfig = liesLiveKonfig(process.env);
} catch (fehler) {
    console.error(`[Live] Konfiguration unvollständig: ${fehler.message}`);
    process.exit(1);
}

const knex = knexLib({ client: 'pg', connection: konfig.db, pool: { min: 0, max: 2 } });
const uplink = erzeugeUplink({ url: konfig.uplinkUrl, token: konfig.token, zustandDatei: konfig.zustandDatei });
const dienst = starteLiveDienst({
    ladeSnapshots: () => ladeSnapshots(knex, { geheimnis: konfig.geheimnis }),
    uplink,
    intervallMs: konfig.intervallMs
});

console.log(`[Live] gestartet, Intervall ${konfig.intervallMs} ms, Ziel ${new URL(konfig.uplinkUrl).host}`);
dienst.tick();

async function beende() {
    dienst.stoppe();
    await knex.destroy().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', beende);
process.on('SIGINT', beende);
