// Client-Knoten (SYNC_ROLLE=client, Notebook/Tablet an Matte oder Waage): keine relationale DB,
// nur eine lokale PouchDB, die per Live-Replikation mit der Turnier-DB des Hallen-Servers
// abgeglichen wird. Der Browser arbeitet ausschließlich gegen http://localhost — fällt das WLAN
// aus, läuft alles lokal weiter (Spec CouchDB-Umbau, Abschnitte 3, 4, 8).
//
// Die eigentliche Logik steckt in src/shared/clientKern.js (läuft identisch in der Android-App);
// hier kommen nur die Node-Teile hinzu: LevelDB-Dokument-DB, localhost-Schutz der /db-Schnittstelle
// und das Sichern verworfener Änderungen als Datei.
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { erzeugeDokumentDb, turnierDbName } from './dokumentDb.js';
import { erzeugeClientKonfig } from './clientKonfig.js';
import { erzeugeClientKern } from '../shared/clientKern.js';

export async function starteClientDienst({ konfig }) {
    const dokumentDb = erzeugeDokumentDb(konfig);
    const clientKonfig = await erzeugeClientKonfig(dokumentDb.PouchDB);
    const verworfenVerzeichnis = path.join(path.resolve(konfig.datenverzeichnis), 'verworfen');

    const dienst = await erzeugeClientKern({
        konfig,
        PouchDB: dokumentDb.PouchDB,
        oeffneDb: (name) => dokumentDb.oeffneSicher(name),
        clientKonfig,
        // <SYNC_DATENVERZEICHNIS>/verworfen/<alte_instanz>_<zeitstempel>.json
        async sichereVerworfene({ alteInstanzId, neueInstanzId, dokumente }) {
            mkdirSync(verworfenVerzeichnis, { recursive: true });
            const datei = path.join(verworfenVerzeichnis, `${alteInstanzId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            writeFileSync(datei, JSON.stringify({ alte_instanz_id: alteInstanzId, neue_instanz_id: neueInstanzId, dokumente }, null, 2));
            console.warn(`[Client-Sync] Turnierwechsel: ${dokumente.length} nicht übertragene Änderung(en) gesichert in ${datei}`);
        },
        holeUpdateHinweis: () => process.env.HAJIME_UPDATE_HINWEIS || null
    });

    const zustand = dienst.zustand;
    Object.assign(dienst, {
        dokumentDb,
        // Nur localhost, nur die DB der aktuellen Instanz (und GET /db/ für PouchDB im Browser).
        middleware(req, res, next) {
            const adresse = req.socket.remoteAddress || '';
            const lokal = adresse === '127.0.0.1' || adresse === '::1' || adresse === '::ffff:127.0.0.1';
            if (!lokal) return res.status(403).json({ error: 'forbidden', reason: 'Nur von diesem Gerät aus erreichbar' });
            const erstesSegment = decodeURIComponent(req.path.split('/')[1] || '');
            if (erstesSegment === '' && req.method === 'GET') return dokumentDb.middleware(req, res, next);
            if (!zustand.instanzId || erstesSegment !== turnierDbName(zustand.instanzId)) {
                return res.status(404).json({ error: 'not_found', reason: 'Keine aktuelle Turnier-DB' });
            }
            return dokumentDb.middleware(req, res, next);
        },
        verworfeneDateien() {
            try {
                return readdirSync(verworfenVerzeichnis)
                    .filter(n => n.endsWith('.json'))
                    .map(n => ({ datei: n, ...JSON.parse(readFileSync(path.join(verworfenVerzeichnis, n), 'utf-8')) }));
            } catch (err) {
                return [];
            }
        }
    });

    return dienst.starte();
}
