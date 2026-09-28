// Rollenentscheidungen des Server-Clusters als reine Funktionen (keine DB, kein Netz), damit sie
// ohne laufenden Cluster testbar sind (tests/unit/cluster-rollenLogik.test.js). Wer die VIP hält,
// entscheidet keepalived; diese Funktionen legen nur fest, was die App daraus folgert.
//
// Zustand eines Servers: { epoche, master, geaendert_am, grund, rueckstufung_erforderlich }.
// Die Epoche steigt bei jeder Beförderung; die höhere Epoche ist maßgeblich. Ein Server, dessen
// PostgreSQL Primary ist, obwohl der Partner eine höhere Epoche hat, ist veraltet und muss seine
// PostgreSQL als Standby des Partners neu aufbauen (Rückstufung).
//
// partner: null (nicht erreichbar) oder { knoten, epoche, master }.
// pgRolle: 'primary' | 'standby'.

// Gewinnt der Partner gegen mich? Höhere Epoche gewinnt. Gleichstand kann nur nach einer
// Netztrennung entstehen, in der beide befördert wurden — dann gewinnt fest server1.
export function partnerGewinnt(knoten, eigenerZustand, partner) {
    if (!partner) return false;
    const eigeneEpoche = eigenerZustand ? eigenerZustand.epoche || 0 : 0;
    if (partner.epoche > eigeneEpoche) return true;
    if (partner.epoche < eigeneEpoche) return false;
    const beideMaster = partner.master === partner.knoten && eigenerZustand && eigenerZustand.master === knoten;
    return beideMaster && partner.knoten === 'server1';
}

// Regelmäßige Prüfung gegen den Partner (und beim Start).
//  'rueckstufen' — ich bin veraltet und meine PostgreSQL ist Primary: neu aufbauen
//  'uebernehmen' — Partner ist weiter, meine PostgreSQL folgt ihm ohnehin (Standby): Zustand übernehmen
//  'ok'          — nichts zu tun
export function pruefePartner({ knoten, eigenerZustand, partner, pgRolle }) {
    if (!partner) return 'ok';
    if (partnerGewinnt(knoten, eigenerZustand, partner)) {
        if (pgRolle === 'primary') return 'rueckstufen';
        const eigeneEpoche = eigenerZustand ? eigenerZustand.epoche || 0 : 0;
        return partner.epoche > eigeneEpoche || (eigenerZustand && eigenerZustand.master !== partner.master) ? 'uebernehmen' : 'ok';
    }
    return 'ok';
}

// Zustand nach dem Start (jeder Server startet als Secondary, siehe clusterDienst.js).
export function entscheideStart({ knoten, eigenerZustand, partner, pgRolle, jetzt }) {
    const pruefung = pruefePartner({ knoten, eigenerZustand, partner, pgRolle });
    if (pruefung === 'rueckstufen') {
        const basis = eigenerZustand || { epoche: 0, master: null, geaendert_am: jetzt, grund: 'erststart' };
        return { zustand: { ...basis, rueckstufung_erforderlich: true }, aktion: 'rueckstufen' };
    }
    if (pruefung === 'uebernehmen') {
        return { zustand: uebernimmPartner(eigenerZustand, partner, jetzt), aktion: 'keine' };
    }
    if (eigenerZustand) return { zustand: { ...eigenerZustand, rueckstufung_erforderlich: !!eigenerZustand.rueckstufung_erforderlich }, aktion: 'keine' };
    // Allererster Start: server1 mit Primary wird Master (Epoche 1); server2 wartet auf den Partner.
    if (knoten === 'server1' && pgRolle === 'primary') {
        return { zustand: { epoche: 1, master: 'server1', geaendert_am: jetzt, grund: 'erststart', rueckstufung_erforderlich: false }, aktion: 'keine' };
    }
    return {
        zustand: { epoche: 0, master: null, geaendert_am: jetzt, grund: 'erststart', rueckstufung_erforderlich: false },
        aktion: 'keine'
    };
}

export function uebernimmPartner(eigenerZustand, partner, jetzt) {
    return {
        ...(eigenerZustand || {}),
        epoche: partner.epoche,
        master: partner.master,
        geaendert_am: partner.geaendert_am || jetzt,
        grund: partner.grund || (eigenerZustand && eigenerZustand.grund) || 'erststart',
        rueckstufung_erforderlich: false
    };
}

// keepalived hat mir die VIP gegeben. Liefert den neuen Zustand und ob PostgreSQL befördert werden
// muss; wirft, wenn ich veraltet bin (dann darf ich nicht Master werden).
export function entscheideBefoerderung({ knoten, eigenerZustand, partner, pgRolle, grund, jetzt }) {
    const eigen = eigenerZustand || { epoche: 0, master: null, rueckstufung_erforderlich: false };
    if (eigen.rueckstufung_erforderlich || (pgRolle === 'primary' && partnerGewinnt(knoten, eigen, partner))) {
        throw new Error('Rückstufung erforderlich: dieser Server ist veraltet und darf nicht Master werden.');
    }
    // Bisheriger Master bekommt die VIP zurück (z.B. nach kurzem Router-Ausfall): weiter wie bisher.
    if (pgRolle === 'primary' && eigen.master === knoten) {
        return { zustand: eigen, pgPromote: false, epocheErhoeht: false };
    }
    const epoche = Math.max(eigen.epoche || 0, partner ? partner.epoche || 0 : 0) + 1;
    return {
        zustand: { epoche, master: knoten, geaendert_am: jetzt, grund, rueckstufung_erforderlich: false },
        pgPromote: pgRolle === 'standby',
        epocheErhoeht: true
    };
}
