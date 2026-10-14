// Kachelzustand je Teilnehmer für die Teilnehmer-App (Spec docs/specs/2026-10-12-teilnehmer-app-design.md, Abschnitt 4).
// Rein und DB-/DOM-frei wie die übrigen Module in src/shared/: der Live-Prozess füttert sie mit Zeilen aus den
// Views des Schemas "live", die Cloud kann dieselbe Funktion für Tests nutzen.
//
// Abstand n = Zahl noch nicht beendeter Kämpfe (bereit/vorbereiten/gestartet) vor dem nächsten eigenen Kampf auf
// derselben Matte, sortiert wie die Mattenansicht (matten_reihenfolge, ohne Position zuletzt, dann id). Nur
// 'bereit'-Kämpfe bekommen von der Matten-Planung eine Position; 'angelegt' (Gegner offen) hat keine.
const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);

function sortiereWarteschlange(kaempfe) {
    return [...kaempfe].sort((a, b) => {
        const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
        const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
        return ra !== rb ? ra - rb : Number(a.id) - Number(b.id);
    });
}

const beteiligt = (kampf, id) => kampf.kaempfer1_id === id || kampf.kaempfer2_id === id;

export function berechneKacheln({ pools = [], teilnehmer = [], kaempfe = [], platzierungen = {} }) {
    const poolById = new Map(pools.map(p => [p.id, p]));

    // Warteschlange je Matte über alle Pools der Matte (auch Mannschafts-Einzelkämpfe: sie belegen die Matte).
    const queueJeMatte = new Map();
    for (const kampf of kaempfe) {
        if (!OFFEN.has(kampf.status)) continue;
        const pool = poolById.get(kampf.pool_id);
        // Mannschafts-Begegnungen können einzeln einer anderen Matte zugeordnet sein.
        const matteId = pool ? (kampf.kampfflaeche_id != null ? kampf.kampfflaeche_id : pool.kampfflaeche_id) : null;
        if (!pool || matteId == null) continue;
        if (!queueJeMatte.has(matteId)) queueJeMatte.set(matteId, []);
        queueJeMatte.get(matteId).push(kampf);
    }
    for (const [matte, liste] of queueJeMatte) queueJeMatte.set(matte, sortiereWarteschlange(liste));

    const angelegtJePool = new Map();
    for (const kampf of kaempfe) {
        if (kampf.status !== 'angelegt') continue;
        if (!angelegtJePool.has(kampf.pool_id)) angelegtJePool.set(kampf.pool_id, []);
        angelegtJePool.get(kampf.pool_id).push(kampf);
    }

    const ergebnis = new Map();
    const setze = (t, zustand, extra = {}) =>
        ergebnis.set(t.id, { zustand, abstand: null, naechsterKampfId: null, platz: null, ...extra });

    for (const t of teilnehmer) {
        const pool = t.pool_id != null ? poolById.get(t.pool_id) : null;
        if (pool && pool.typ === 'mannschaft') continue;
        if (t.status === 'nicht_erschienen') { setze(t, 'nicht_erschienen'); continue; }
        if (!pool) { setze(t, 'nicht_ausgelost'); continue; }
        if (pool.verspaetet) { setze(t, 'verspaetet'); continue; }
        if (pool.status === 'abgeschlossen') {
            const platz = platzierungen[pool.id] ? platzierungen[pool.id][t.id] : null;
            setze(t, 'abgeschlossen', { platz: platz >= 1 && platz <= 3 ? platz : null });
            continue;
        }
        if (pool.kampfflaeche_id == null) { setze(t, 'ohne_matte'); continue; }

        const queue = queueJeMatte.get(pool.kampfflaeche_id) || [];
        const index = queue.findIndex(kampf => beteiligt(kampf, t.id));
        if (index >= 0) {
            const kampf = queue[index];
            if (kampf.status === 'gestartet') setze(t, 'laeuft', { naechsterKampfId: kampf.id });
            else if (index === 0) setze(t, 'als_naechstes', { naechsterKampfId: kampf.id });
            else setze(t, 'in_n', { abstand: index, naechsterKampfId: kampf.id });
            continue;
        }
        const wartet = (angelegtJePool.get(pool.id) || []).some(kampf => beteiligt(kampf, t.id));
        setze(t, wartet ? 'wartet_auf_gegner' : 'keine_weiteren');
    }
    return ergebnis;
}
