// Nachzügler-Vorschlag (Spec docs/specs/2026-10-10-nachzuegler-pool-design.md): reine Funktion ohne DB.
// pruefeSpanne und waehleSystem übergibt der Aufrufer (poolController), damit hier kein Controller-Import nötig ist.
// Pools mit bereits begonnenen Kämpfen kommen nur in Frage, wenn bewerteEinfuegen sie zulässt (laufender
// Jeder-gegen-Jeden-Pool ohne Systemwechsel, Spec docs/specs/2026-10-14-nachzuegler-laufender-pool.md).
import { bewerteEinfuegen } from '../shared/nachzueglerEinfuegen.js';

function bewertePool(pool, waehleSystem) {
    const nachher = pool.teilnehmer.length + 1;
    let systemNachher = null;
    try {
        systemNachher = waehleSystem(nachher, pool.modus);
    } catch {
        return { systemNachher: null, nachher, bewertung: null }; // größer als das größte Wettkampfsystem
    }
    const bewertung = bewerteEinfuegen({
        modus: pool.modus, poolStatus: pool.status, teilnehmerAnzahl: pool.teilnehmer.length,
        kaempfe: pool.kaempfe || [], systemNachher
    });
    return { systemNachher, nachher, bewertung };
}

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
        const { systemNachher, nachher, bewertung } = bewertePool(pool, waehleSystem);
        if (!bewertung || !bewertung.moeglich) continue;
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

// Alle offenen Einzel-Pools als Auswahl für einen Nachzügler (Dialog nach dem Speichern): der Vorschlag
// steht vorn, danach Pools der gleichen Altersklasse, dann nach Gewichtsabstand. Pools, deren System
// mit dem Nachzügler größer als das größte Wettkampfsystem würde, entfallen; eine überschrittene
// Gewichtsspanne wird markiert statt den Pool zu verbergen (die Turnierleitung entscheidet).
export function listeOffenePools(nachzuegler, offenePools, { pruefeSpanne, waehleSystem }) {
    const vorschlag = berechneVorschlag(nachzuegler, offenePools, { pruefeSpanne, waehleSystem });
    const gewicht = Number.parseFloat(nachzuegler.gewicht);
    const eintraege = [];
    for (const pool of offenePools) {
        const { systemNachher, nachher, bewertung } = bewertePool(pool, waehleSystem);
        if (!bewertung) continue;
        const ueberschritten = !(Number.isFinite(gewicht) && gewicht > 0)
            || !pruefeSpanne([...pool.teilnehmer, { gewicht }], pool.altersklasse).zulaessig;
        eintraege.push({
            poolId: pool.id,
            bezeichnung: pool.bezeichnung,
            teilnehmerNachher: nachher,
            systemNachher,
            matteId: pool.kampfflaeche_id ?? null,
            // laeuft: im Pool wurde schon gekämpft. moeglich/grund erklären, warum der Nachzügler dort
            // (nicht) mehr hineinkommt; art 'einfuegen' = er bekommt neueKaempfe zusätzliche Kämpfe.
            laeuft: bewertung.art !== 'neuaufbau',
            moeglich: bewertung.moeglich,
            art: bewertung.art,
            grund: bewertung.grund,
            neueKaempfe: bewertung.neueKaempfe ?? null,
            hinweis: bewertung.hinweis ?? null,
            gewichtsspanneUeberschritten: ueberschritten,
            gleicheAltersklasse: pool.altersklasse === nachzuegler.altersklasse,
            istVorschlag: vorschlag != null && vorschlag.poolId === pool.id,
            abstand: gewichtsAbstand(gewicht, pool.teilnehmer),
            groesse: pool.teilnehmer.length
        });
    }
    eintraege.sort((a, b) =>
        Number(b.istVorschlag) - Number(a.istVorschlag)
        || Number(b.moeglich) - Number(a.moeglich)
        || Number(b.gleicheAltersklasse) - Number(a.gleicheAltersklasse)
        || Number(a.gewichtsspanneUeberschritten) - Number(b.gewichtsspanneUeberschritten)
        || a.abstand - b.abstand || a.groesse - b.groesse || a.poolId - b.poolId);
    return eintraege.map(({ istVorschlag, abstand, groesse, ...rest }) => rest);
}
