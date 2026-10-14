// Wirksame Matte eines Kampfes: eine eigene Zuordnung des Kampfes (Mannschaftsbegegnungen dürfen
// auf einer anderen Matte laufen als der Pool) hat Vorrang vor der Matte des Pools.
// Rein und DB-/DOM-frei (Server, Client-Geräte, Live-Uplink).
export function kampfMatteId(kampf, pool) {
    if (kampf && kampf.kampfflaeche_id != null) return Number(kampf.kampfflaeche_id);
    if (pool && pool.kampfflaeche_id != null) return Number(pool.kampfflaeche_id);
    return null;
}
