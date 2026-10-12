// Sendet Snapshots ausgehend an die Cloud (Spec Abschnitt 5.3). Nur Statuscodes zählen: die Antwort wird weder
// gelesen noch ausgewertet, es gibt keinen Rückkanal. Gesendet wird bei Änderung (Hash ohne Zeitstempel), spätestens
// alle 60 s als Lebenszeichen; Fehler führen zu Backoff, der letzte erfolgreich gesendete Hash bleibt unverändert.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export function erzeugeUplink({
    url, token, fetchFn = fetch, jetzt = Date.now,
    lebenszeichenMs = 60_000, backoffStartMs = 2000, backoffMaxMs = 60_000, timeoutMs = 10_000,
    log = console
}) {
    const gesendet = new Map(); // turnierKey -> { hash, zeit }
    let backoffMs = 0;
    let naechsterVersuch = 0;
    let letzterErfolg = null;
    let letzterFehler = null;

    const hashVon = (snapshot) => crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

    async function poste(nutzlast) {
        const zeit = jetzt();
        const koerper = zlib.gzipSync(Buffer.from(JSON.stringify({
            ...nutzlast, stand: new Date(zeit).toISOString(), sequenz: zeit
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

    async function sende(snapshots) {
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
        for (const key of gesendet.keys()) {
            if (!aktuelle.has(key)) auftraege.push({ art: 'rueck', key, nutzlast: { version: 1, turnierKey: key, zurueckgezogen: true } });
        }

        for (const auftrag of auftraege) {
            try {
                await poste(auftrag.nutzlast);
                if (auftrag.art === 'snapshot') {
                    gesendet.set(auftrag.key, { hash: auftrag.hash, zeit: jetzt() });
                    ergebnis.gesendet += 1;
                } else {
                    gesendet.delete(auftrag.key);
                    ergebnis.zurueckgezogen += 1;
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
