// Test-Ersatz für deploy/linux/hajime-rueckstufen.sh (CLUSTER_RUECKSTUFEN_BEFEHL der Cluster-Suite):
// eigene PostgreSQL stoppen und als Standby des Partners (dem neuen Master) neu aufbauen.
// Aufruf: node tests/e2e-cluster/rueckstufen.js <server1|server2>
import { KNOTEN } from './test-env.js';
import { stoppe, starte, baueStandby } from './pgInstanz.js';

const name = process.argv[2];
const eigen = KNOTEN[name];
if (!eigen) {
    console.error(`Unbekannter Knoten: ${name}`);
    process.exit(2);
}
const partner = KNOTEN[eigen.partner];

stoppe(eigen.pgDir, 'fast');
await baueStandby({ quellePort: partner.pgPort, quelleDir: partner.pgDir, zielDir: eigen.pgDir, name });
starte(eigen.pgDir, eigen.pgPort);
console.log(`${name}: PostgreSQL als Standby von ${partner.name} neu aufgebaut.`);
