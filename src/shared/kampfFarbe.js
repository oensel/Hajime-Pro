/**
 * Farbe von Kämpfer 2 (Kämpfer 1 trägt immer Weiß): 'blau' oder 'rot'.
 * Die feinste Einstellung gewinnt: Kampf (Scoreboard, live_farbe) > Pool > Turnier > 'blau'.
 */
export function gueltigeFarbe(wert) {
    return wert === 'rot' || wert === 'blau' ? wert : null;
}

export function bestimmeFarbeKaempfer2({ kampf, pool, turnier } = {}) {
    return gueltigeFarbe(kampf && kampf.live_farbe)
        || gueltigeFarbe(pool && pool.farbe_kaempfer2)
        || gueltigeFarbe(turnier && turnier.farbe_kaempfer2)
        || 'blau';
}
