// Sendet Snapshots ausgehend an die Cloud (Spec Abschnitt 5.3). Nur Statuscodes zählen: die Antwort wird weder
// gelesen noch ausgewertet, es gibt keinen Rückkanal. Gesendet wird bei Änderung (Hash ohne Zeitstempel), spätestens
// alle 60 s als Lebenszeichen; Fehler führen zu Backoff, der letzte erfolgreich gesendete Hash bleibt unverändert.
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

export function erzeugeUplink({
    url, token, fetchFn = fetch, jetzt = Date.now,
    lebenszeichenMs = 60_000, backoffStartMs = 2000, backoffMaxMs = 60_000, timeoutMs = 10_000,
    zustandDatei = null, log = console
}) {
    const gesendet = new Map(); // turnierKey -> { hash, zeit }
    // Auf Zuruf zurückgenommene Turniere (in diesem Prozess), damit eine Rücknahme-Liste nicht bei jedem Durchlauf neu sendet.
    const zurueckgenommen = new Set();
    let backoffMs = 0;
    let naechsterVersuch = 0;
    let letzterErfolg = null;
    let letzterFehler = null;
    // Streng monoton, auch wenn die Uhr stehen bleibt oder zurückspringt (NTP, Failover): die Cloud verwirft Pakete
    // mit kleinerer oder gleicher Sequenz.
    let letzteSequenz = 0;

    // Zuletzt gesendete Turniere überleben einen Neustart, damit eine in der Zwischenzeit zurückgenommene Freigabe
    // trotzdem als Rücknahme in der Cloud ankommt (Spec 5.3/10). Ohne Datei läuft der Uplink wie bisher nur im Speicher.
    if (zustandDatei) {
        try {
            for (const key of JSON.parse(fs.readFileSync(zustandDatei, 'utf8'))) gesendet.set(String(key), { hash: null, zeit: 0 });
        } catch { /* noch keine Datei */ }
    }
    function speichereZustand() {
        if (!zustandDatei) return;
        try {
            fs.writeFileSync(zustandDatei, JSON.stringify([...gesendet.keys()]));
        } catch (fehler) {
            log.warn(`[Live] Zustandsdatei nicht beschreibbar (${fehler.message}); Rücknahmen gehen bei einem Neustart verloren`);
        }
    }

    const hashVon = (snapshot) => crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

    async function poste(nutzlast) {
        const zeit = jetzt();
        letzteSequenz = Math.max(zeit, letzteSequenz + 1);
        const koerper = zlib.gzipSync(Buffer.from(JSON.stringify({
            ...nutzlast, stand: new Date(zeit).toISOString(), sequenz: letzteSequenz
        }), 'utf8'));
        const antwort = await fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                Authorization: `Bearer ${token}`
            },
            body: koerper,
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
        });
        try { await antwort.body?.cancel(); } catch { /* Antwort wird bewusst nicht gelesen */ }
        if (!antwort.ok) throw new Error(`Cloud antwortete mit Status ${antwort.status}`);
    }

    // zurueckzunehmen: Turnier-Schlüssel, die in der Cloud zurückgenommen werden sollen, auch wenn dieser Prozess sie nie gesendet hat
    // (z. B. nach einem Wechsel des sendenden Knotens im Cluster).
    async function sende(snapshots, { zurueckzunehmen = [] } = {}) {
        const ergebnis = { gesendet: 0, zurueckgezogen: 0, fehler: 0 };
        const jetztMs = jetzt();
        if (jetztMs < naechsterVersuch) return ergebnis;

        const aktuelle = new Set(snapshots.map(s => s.turnierKey));
        const auftraege = [];
        for (const snapshot of snapshots) {
            const hash = hashVon(snapshot);
            const bisher = gesendet.get(snapshot.turnierKey);
            const faellig = !bisher || bisher.hash !== hash || jetztMs - bisher.zeit >= lebenszeichenMs;
            if (faellig) auftraege.push({ art: 'snapshot', key: snapshot.turnierKey, hash, nutzlast: snapshot });
        }
        for (const key of aktuelle) zurueckgenommen.delete(key);
        const rueckKeys = new Set([...gesendet.keys(), ...zurueckzunehmen.map(String)]);
        for (const key of rueckKeys) {
            if (aktuelle.has(key) || zurueckgenommen.has(key)) continue;
            auftraege.push({ art: 'rueck', key, nutzlast: { version: 1, turnierKey: key, zurueckgezogen: true } });
        }

        for (const auftrag of auftraege) {
            try {
                await poste(auftrag.nutzlast);
                if (auftrag.art === 'snapshot') {
                    gesendet.set(auftrag.key, { hash: auftrag.hash, zeit: jetzt() });
                    ergebnis.gesendet += 1;
                    speichereZustand();
                } else {
                    gesendet.delete(auftrag.key);
                    zurueckgenommen.add(auftrag.key);
                    ergebnis.zurueckgezogen += 1;
                    speichereZustand();
                }
                letzterErfolg = jetzt();
                letzterFehler = null;
                backoffMs = 0;
                naechsterVersuch = 0;
            } catch (fehler) {
                ergebnis.fehler += 1;
                letzterFehler = String(fehler && fehler.message ? fehler.message : fehler);
                backoffMs = backoffMs ? Math.min(backoffMs * 2, backoffMaxMs) : backoffStartMs;
                naechsterVersuch = jetzt() + backoffMs;
                log.warn(`[Live] Uplink fehlgeschlagen (${letzterFehler}), nächster Versuch in ${Math.round(backoffMs / 1000)} s`);
                break; // weitere Turniere im Backoff nicht überrollen
            }
        }
        return ergebnis;
    }

    return {
        sende,
        zustand: () => ({ letzterErfolg, letzterFehler, naechsterVersuch })
    };
}
