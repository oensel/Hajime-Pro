// Wortlaut der Push-Nachrichten (Spec Phase 3, Entscheidung 7). Rein, ohne Datenbank.
const inKaempfen = (abstand) => {
    if (abstand === 0) return 'als Nächstes';
    return abstand === 1 ? 'in 1 Kampf' : `in ${abstand} Kämpfen`;
};

// Team: Begegnung des Teams steht an oder läuft.
export function baueTeamNachricht({ turnierKey, turnierName, team, gegner, matte, abstand }) {
    const teile = [abstand === 0 ? 'Begegnung als Nächstes' : `Begegnung ${inBegegnungen(abstand)}`];
    return {
        titel: `Hajime Pro · ${turnierName}`,
        text: `${team}${gegner ? ` gegen ${gegner}` : ''}: ${teile.join(', ')}${matte ? ` (${matte})` : ''}`,
        url: `/live/#/t/${encodeURIComponent(turnierKey)}/uebersicht`,
        tag: `hajime-${turnierKey}`
    };
}

const inBegegnungen = (abstand) => (abstand === 1 ? 'in 1 Begegnung' : `in ${abstand} Begegnungen`);

export function baueNachricht({ turnierKey, turnierName, name, poolBezeichnung, matte, pool, kampf }) {
    const teile = [];
    if (pool) teile.push(`Pool ${poolBezeichnung} startet ${inKaempfen(pool.abstand)}`);
    if (kampf) teile.push(`Kampf ${inKaempfen(kampf.abstand)}`);
    return {
        titel: `Hajime Pro · ${turnierName}`,
        text: `${name}: ${teile.join(', ')}${matte ? ` (${matte})` : ''}`,
        url: `/live/#/t/${encodeURIComponent(turnierKey)}/uebersicht`,
        tag: `hajime-${turnierKey}`
    };
}
