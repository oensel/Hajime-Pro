// Schleife des Live-Prozesses: alle intervallMs Snapshots laden und dem Uplink übergeben. Ein fehlgeschlagener Tick
// (Datenbank kurz weg, Cloud nicht erreichbar) wird protokolliert, der nächste läuft planmäßig.
// Die nächste Runde wird erst nach Abschluss der vorigen geplant, damit sich Abfragen nie überlappen.
export function starteLiveDienst({
    ladeSnapshots, uplink, intervallMs = 5000, log = console,
    setzeTimer = setTimeout, loescheTimer = clearTimeout
}) {
    let timer = null;
    let gestoppt = false;

    async function tick() {
        try {
            const snapshots = await ladeSnapshots();
            await uplink.sende(snapshots);
        } catch (fehler) {
            log.error(`[Live] Durchlauf fehlgeschlagen: ${fehler && fehler.message ? fehler.message : fehler}`);
        } finally {
            if (!gestoppt) timer = setzeTimer(tick, intervallMs);
        }
    }

    function stoppe() {
        gestoppt = true;
        if (timer != null) loescheTimer(timer);
    }

    return { tick, stoppe };
}
