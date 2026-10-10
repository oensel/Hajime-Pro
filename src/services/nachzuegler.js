// Nachzügler-Vorschlag (Spec docs/specs/2026-10-10-nachzuegler-pool-design.md): reine Funktion ohne DB.
// pruefeSpanne und waehleSystem übergibt der Aufrufer (poolController), damit hier kein Controller-Import nötig ist.

function gewichtsAbstand(gewicht, teilnehmer) {
    const gewichte = teilnehmer.map(t => Number.parseFloat(t.gewicht)).filter(Number.isFinite);
    if (!Number.isFinite(gewicht) || gewichte.length === 0) return Number.POSITIVE_INFINITY;
    const leicht = Math.min(...gewichte);
    const schwer = Math.max(...gewichte);
    if (gewicht >= leicht && gewicht <= schwer) return 0;
    return Math.min(Math.abs(gewicht - leicht), Math.abs(gewicht - schwer));
}

export function berechneVorschlag(nachzuegler, offenePools, { pruefeSpanne, waehleSystem }) {
    const gewicht = Number.parseFloat(nachzuegler.gewicht);
    if (!Number.isFinite(gewicht) || gewicht <= 0) return null;

    const kandidaten = [];
    for (const pool of offenePools) {
        if (pool.altersklasse !== nachzuegler.altersklasse) continue;
        if (pool.geschlecht !== 'mixed' && pool.geschlecht !== nachzuegler.geschlecht) continue;
        const nachher = pool.teilnehmer.length + 1;
        let systemNachher;
        try {
            systemNachher = waehleSystem(nachher);
        } catch {
            continue; // größer als das größte Wettkampfsystem
        }
        if (!pruefeSpanne([...pool.teilnehmer, { gewicht }], pool.altersklasse).zulaessig) continue;
        kandidaten.push({
            poolId: pool.id,
            bezeichnung: pool.bezeichnung,
            teilnehmerNachher: nachher,
            systemNachher,
            matteId: pool.kampfflaeche_id ?? null,
            klasseGleich: pool.gewichtsklasse != null && pool.gewichtsklasse === nachzuegler.gewichtsklasse ? 0 : 1,
            abstand: gewichtsAbstand(gewicht, pool.teilnehmer),
            groesse: pool.teilnehmer.length
        });
    }
    if (kandidaten.length === 0) return null;
    kandidaten.sort((a, b) => a.klasseGleich - b.klasseGleich || a.abstand - b.abstand || a.groesse - b.groesse || a.poolId - b.poolId);
    const { klasseGleich, abstand, groesse, ...vorschlag } = kandidaten[0];
    return vorschlag;
}
