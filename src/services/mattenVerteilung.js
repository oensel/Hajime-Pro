// Verteilung von Pools auf Matten (Bin Packing) als reine Funktion — ohne Datenbank, damit der
// Algorithmus testbar ist. Der Controller (poolController.verteilePools) lädt die Daten, ruft
// verteilePoolsAufMatten() auf und schreibt das Ergebnis.
//
// Waage in Runden: neue Pools werden an bereits belegte Matten ANGEHÄNGT (startLasten), statt
// alles neu zu verteilen. Für "Alle neu verteilen" sind die startLasten leer.

const STANDARD_REGELN = Object.freeze({
    // Maximal tolerierte Differenz zwischen höchster und niedrigster Mattenlast: das Größere aus
    // schwelleMinuten und schwelleAnteil * durchschnittlicher Last.
    schwelleMinuten: 30,
    schwelleAnteil: 0.25,
    // Sicherheitslimit gegen Endlosschleifen beim schrittweisen Aufteilen der Gruppen.
    maxIterationen: 15
});

// Gewichtsklassen-Parser: entfernt alle Zeichen außer Ziffern und Punkt ("-64.5kg" -> 64.5).
export function parseGewicht(w) {
    const cleaned = String(w || '').replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
}

export function parseAltersklassenRang(ac) {
    const cleaned = String(ac || '').toLowerCase();
    if (cleaned.includes('u11')) return 11;
    if (cleaned.includes('u13')) return 13;
    if (cleaned.includes('u15')) return 15;
    if (cleaned.includes('u17')) return 17;
    if (cleaned.includes('u18')) return 18;
    if (cleaned.includes('u21')) return 21;
    if (cleaned.includes('sen') || cleaned.includes('männer') || cleaned.includes('frauen') || cleaned.includes('erwachsene')) return 100;
    const match = cleaned.match(/\d+/);
    return match ? parseInt(match[0], 10) : 999;
}

// Weiblich vor männlich, jüngere vor älteren Altersklassen.
function vergleicheKategorien(katA, katB) {
    const [geschlechtA, altersklasseA] = katA.split('_');
    const [geschlechtB, altersklasseB] = katB.split('_');
    if (geschlechtA !== geschlechtB) {
        return geschlechtA === 'weiblich' ? -1 : 1;
    }
    return parseAltersklassenRang(altersklasseA) - parseAltersklassenRang(altersklasseB);
}

/**
 * @param {object} p
 * @param {Array<{id:number, typ?:string, geschlecht:string, altersklasse:string, gewichtsklasse:string, dauer_minuten:number}>} p.pools
 *        zu verteilende Pools (Einzel und Mannschaft), jeweils mit geschätzter Dauer in Minuten
 * @param {Array<{id:number}>} p.matten  Matten in Reihenfolge (die erste bekommt die Sonderregel)
 * @param {Object<string, {dauer:number, anzahl:number}>} [p.startLasten]
 *        je Matten-ID: Restdauer (Minuten) und Anzahl/nächste Reihenfolge der schon zugeordneten Pools
 * @param {object} [p.regeln]  überschreibt STANDARD_REGELN
 * @returns {Array<{id:number, pools:object[], startReihenfolge:number, dauer:number}>}
 *          je Matte die NEU zugeordneten Pools in Kampfreihenfolge; matte_reihenfolge der Pools ist
 *          startReihenfolge + Index.
 */
export function verteilePoolsAufMatten({ pools, matten, startLasten = {}, regeln = {} }) {
    const { schwelleMinuten, schwelleAnteil, maxIterationen } = { ...STANDARD_REGELN, ...regeln };

    const einzelPools = pools.filter(p => p.typ !== 'mannschaft');
    const mannschaftsPools = pools.filter(p => p.typ === 'mannschaft');

    const startDauer = (matte) => Number(startLasten[matte.id]?.dauer) || 0;
    const startReihenfolge = (matte) => Number(startLasten[matte.id]?.anzahl) || 0;
    const mattenBelegt = matten.some(m => startReihenfolge(m) > 0);

    // Gruppierung nach Geschlecht und Altersklasse, innerhalb nach Gewicht aufsteigend
    const gruppen = {};
    for (const p of einzelPools) {
        const key = `${p.geschlecht}_${p.altersklasse}`;
        if (!gruppen[key]) gruppen[key] = [];
        gruppen[key].push(p);
    }
    for (const key in gruppen) {
        gruppen[key].sort((a, b) => parseGewicht(a.gewichtsklasse) - parseGewicht(b.gewichtsklasse));
    }

    // Jüngste weibliche Altersklasse: kommt fest auf die erste Matte — aber nur, solange noch keine
    // Matte belegt ist (erste Runde / "Alle neu verteilen"); spätere Runden gleichen nur die Last aus.
    let juengsteWeiblicheKey = null;
    if (!mattenBelegt) {
        let minRang = Infinity;
        for (const p of einzelPools) {
            if (p.geschlecht === 'weiblich') {
                const rang = parseAltersklassenRang(p.altersklasse);
                if (rang < minRang) {
                    minRang = rang;
                    juengsteWeiblicheKey = `${p.geschlecht}_${p.altersklasse}`;
                }
            }
        }
    }

    const neueDauer = einzelPools.reduce((sum, p) => sum + p.dauer_minuten, 0);
    const startGesamt = matten.reduce((sum, m) => sum + startDauer(m), 0);
    const durchschnitt = (neueDauer + startGesamt) / matten.length;
    const schwelle = Math.max(schwelleMinuten, durchschnitt * schwelleAnteil);

    // Anfangs ganze Kategorien als Items, die bei zu großer Unwucht schrittweise geteilt werden
    let items = Object.keys(gruppen).map(key => ({
        key,
        pools: [...gruppen[key]],
        duration: gruppen[key].reduce((sum, p) => sum + p.dauer_minuten, 0)
    }));

    let mattenLast = [];
    let iteration = 0;
    while (iteration < maxIterationen && items.length > 0) {
        iteration++;
        const sortierteItems = [...items].sort((a, b) => b.duration - a.duration);
        mattenLast = matten.map(m => ({ id: m.id, duration: startDauer(m), neueDauer: 0, pools: [] }));

        for (const item of sortierteItems) {
            const istJuengsteWeibliche = juengsteWeiblicheKey && (
                item.key === juengsteWeiblicheKey || item.key.startsWith(juengsteWeiblicheKey + '_part1')
            );
            if (istJuengsteWeibliche) {
                const ersteMatte = mattenLast.find(m => m.id === matten[0].id);
                if (ersteMatte) {
                    ersteMatte.pools.push(...item.pools);
                    ersteMatte.duration += item.duration;
                    continue;
                }
            }

            mattenLast.sort((a, b) => a.duration - b.duration);
            mattenLast[0].pools.push(...item.pools);
            mattenLast[0].duration += item.duration;
        }

        const lasten = mattenLast.map(m => m.duration);
        if (Math.max(...lasten) - Math.min(...lasten) <= schwelle) break;

        const teilbare = items.filter(item => item.pools.length > 1).sort((a, b) => b.duration - a.duration);
        if (teilbare.length === 0) break;

        const zuTeilen = teilbare[0];
        const mitte = Math.ceil(zuTeilen.pools.length / 2);
        const pools1 = zuTeilen.pools.slice(0, mitte);
        const pools2 = zuTeilen.pools.slice(mitte);
        items = items.filter(it => it.key !== zuTeilen.key);
        items.push(
            { key: `${zuTeilen.key}_part1`, pools: pools1, duration: pools1.reduce((s, p) => s + p.dauer_minuten, 0) },
            { key: `${zuTeilen.key}_part2`, pools: pools2, duration: pools2.reduce((s, p) => s + p.dauer_minuten, 0) }
        );
    }

    if (mattenLast.length === 0) {
        mattenLast = matten.map(m => ({ id: m.id, duration: startDauer(m), pools: [] }));
    }

    // Auf jeder Matte: gleiche Alters-/Geschlechtsklassen zusammen, Gewicht aufsteigend
    for (const matte of mattenLast) {
        matte.pools.sort((a, b) => {
            const katA = `${a.geschlecht}_${a.altersklasse}`;
            const katB = `${b.geschlecht}_${b.altersklasse}`;
            if (katA !== katB) return vergleicheKategorien(katA, katB);
            return parseGewicht(a.gewichtsklasse) - parseGewicht(b.gewichtsklasse);
        });
    }

    // Mannschafts-Pools: einfaches Greedy-Load-Balancing über die aktuelle Auslastung, je Matte ans
    // Ende angehängt (planeKaempfeFuerKampfflaeche plant sie erst nach allen niedrigeren Pools).
    const mannschaftenSortiert = [...mannschaftsPools].sort((a, b) => b.dauer_minuten - a.dauer_minuten);
    for (const pool of mannschaftenSortiert) {
        mattenLast.sort((a, b) => a.duration - b.duration);
        mattenLast[0].pools.push(pool);
        mattenLast[0].duration += pool.dauer_minuten;
    }

    return matten.map(m => {
        const eintrag = mattenLast.find(l => l.id === m.id);
        return {
            id: m.id,
            pools: eintrag.pools,
            startReihenfolge: startReihenfolge(m),
            dauer: eintrag.duration
        };
    });
}
