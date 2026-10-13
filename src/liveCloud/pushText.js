// Wortlaut der Push-Nachrichten (Spec Phase 3, Entscheidung 7). Rein, ohne Datenbank.
const inKaempfen = (abstand) => {
    if (abstand === 0) return 'als Nächstes';
    return abstand === 1 ? 'in 1 Kampf' : `in ${abstand} Kämpfen`;
};

export function baueNachricht({ turnierKey, turnierName, name, poolBezeichnung, matte, pool, kampf }) {
    const teile = [];
    if (pool) teile.push(`Pool ${poolBezeichnung} startet ${inKaempfen(pool.abstand)}`);
    if (kampf) teile.push(`Kampf ${inKaempfen(kampf.abstand)}`);
    return {
        titel: `Hajime Live · ${turnierName}`,
        text: `${name}: ${teile.join(', ')}${matte ? ` (${matte})` : ''}`,
        url: `/live/#/t/${encodeURIComponent(turnierKey)}/uebersicht`,
        tag: `hajime-${turnierKey}`
    };
}
