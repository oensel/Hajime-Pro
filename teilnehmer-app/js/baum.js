// Rein: Modell für Turnierbaum und Kampfbogen eines Pools (Darstellung in ansicht-pool.js). Die Rundendefinitionen
// (POOL_RUNDEN usw. aus src/shared/poolRunden.js) werden übergeben, damit das Modul in Node und im Browser läuft.
const BEENDET = new Set(['beendet', 'freilos']);

function karte(k) {
    if (!k) return null;
    const zeile = (kaempfer, slot) => {
        const freilos = k.status === 'freilos' && !kaempfer;
        return {
            key: kaempfer ? kaempfer.key : null,
            name: kaempfer ? kaempfer.name : (freilos ? 'Freilos' : 'offen'),
            sieger: BEENDET.has(k.status) && !!kaempfer && k.sieger === kaempfer.key,
            punkte: k.status === 'beendet' ? (slot === 1 ? k.p1 : k.p2) : null
        };
    };
    return { id: k.id, nr: k.nr, status: k.status, laeuft: k.status === 'gestartet', zeilen: [zeile(k.k1, 1), zeile(k.k2, 2)] };
}

function rundenAbschnitt(titel, rundenDef, nachNr) {
    return {
        titel, art: 'runden',
        runden: rundenDef.map(r => ({ titel: r.title, kaempfe: r.nummern.map(n => karte(nachNr.get(String(n)))) }))
    };
}

function kampfbogen(titel, kaempfe) {
    const sortiert = [...kaempfe].sort((a, b) => a.id - b.id);
    const teilnehmer = [];
    const bekannt = new Set();
    for (const k of sortiert) {
        for (const f of [k.k1, k.k2]) {
            if (f && !bekannt.has(f.key)) { bekannt.add(f.key); teilnehmer.push({ key: f.key, name: f.name, verein: f.verein || '' }); }
        }
    }
    const paarKey = (a, b) => [a, b].sort().join('|');
    const nachPaar = new Map();
    for (const k of sortiert) {
        if (!k.k1 || !k.k2) continue;
        const s = paarKey(k.k1.key, k.k2.key);
        nachPaar.set(s, [...(nachPaar.get(s) || []), k]);
    }
    const siege = teilnehmer.map(() => 0);
    const zellen = teilnehmer.map((zeile, i) => teilnehmer.map((spalte, j) => {
        if (i === j) return null;
        const paarung = nachPaar.get(paarKey(zeile.key, spalte.key)) || [];
        if (!paarung.length) return { text: '', art: 'offen', kampfId: null, zusatz: [] };
        const zelle = { text: '', art: 'offen', kampfId: paarung[0].id, zusatz: [] };
        paarung.forEach((k, idx) => {
            const ichBinK1 = k.k1 && k.k1.key === zeile.key;
            let text; let gewonnen = false; let art;
            if (k.status === 'freilos') { text = 'FL'; art = 'freilos'; }
            else if (k.status === 'beendet') {
                gewonnen = k.sieger === zeile.key;
                if (gewonnen) siege[i] += 1;
                text = `${ichBinK1 ? k.p1 : k.p2}:${ichBinK1 ? k.p2 : k.p1}`;
                art = gewonnen ? 'gewonnen' : 'verloren';
            } else { text = k.status === 'gestartet' ? 'läuft' : `#${k.nr}`; art = k.status === 'gestartet' ? 'laeuft' : 'offen'; }
            if (idx === 0) { zelle.text = text; zelle.art = art; } else zelle.zusatz.push({ text, gewonnen });
        });
        return zelle;
    }));
    return { titel, art: 'bogen', teilnehmer, zellen, siege };
}

export function baueBaumModell(modus, kaempfe, defs) {
    const { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } = defs;
    const nachNr = new Map(kaempfe.map(k => [String(k.nr), k]));
    if (POOL_RUNDEN[modus]) {
        return { abschnitte: [
            rundenAbschnitt('Hauptrunde', POOL_RUNDEN[modus].winner, nachNr),
            rundenAbschnitt(String(modus).startsWith('KO-Repechage') ? 'Hoffnungsrunde' : 'Trostrunde', POOL_RUNDEN[modus].loser, nachNr)
        ] };
    }
    if (/^Gruppen-((Ü|ue|Ue)berkreuz|KO)$/.test(modus)) {
        const abschnitte = [];
        for (const g of UEBERKREUZ_GRUPPEN) {
            const teil = kaempfe.filter(k => String(k.nr).startsWith(g.praefix));
            if (teil.length) abschnitte.push(kampfbogen(g.titel, teil));
        }
        const finale = UEBERKREUZ_FINALRUNDE.filter(r => r.nummern.some(n => nachNr.has(n)));
        if (finale.length) abschnitte.push(rundenAbschnitt('Finalrunde', finale, nachNr));
        return { abschnitte };
    }
    return { abschnitte: [kampfbogen('', kaempfe)] };
}
