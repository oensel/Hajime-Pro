/**
 * Wann darf ein beendeter Kampf korrigiert bzw. zurückgesetzt werden, und was muss dabei in den
 * abhängigen Kämpfen rückgängig gemacht werden? Rein und knex-/DOM-frei (Server und Client).
 *
 * - Jeder gegen Jeden: keine Abhängigkeiten, nie gesperrt.
 * - Doppel-KO: solange kein Folgekampf (Sieger- oder Verlierer-Weg, per kaempferN_quelle_kampf_id)
 *   gestartet oder beendet ist. Automatische Freilose zählen nicht als begonnen; ihre eigenen
 *   Folgekämpfe werden mitgeprüft.
 * - Gruppen-Überkreuz: Vorrundenkämpfe ('V_*'), solange kein Halbfinale gestartet ist (HF1/HF2
 *   hängen an der ganzen Vorrunde, nicht an einem einzelnen Quellkampf); Halbfinale, solange das
 *   Finale (per Quellkampf-Verknüpfung) nicht begonnen hat.
 */
const BEGONNEN = ['gestartet', 'beendet'];

function kampfName(kampf) {
    return kampf.reihenfolge_nummer || `#${kampf.id}`;
}

function istVorrunde(kampf) {
    return typeof kampf.reihenfolge_nummer === 'string' && kampf.reihenfolge_nummer.startsWith('V_');
}

/** Direkt abhängige Kämpfe: Quellkampf-Verknüpfung, bei Gruppen-Vorrunde zusätzlich HF1/HF2. */
export function ermittleAbhaengigeKaempfe(kampf, kaempfe) {
    const abhaengige = kaempfe.filter(k => k.id !== kampf.id
        && (k.kaempfer1_quelle_kampf_id === kampf.id || k.kaempfer2_quelle_kampf_id === kampf.id));
    if (istVorrunde(kampf)) {
        for (const nummer of ['HF1', 'HF2']) {
            const halbfinale = kaempfe.find(k => k.reihenfolge_nummer === nummer);
            if (halbfinale && !abhaengige.includes(halbfinale)) abhaengige.push(halbfinale);
        }
    }
    return abhaengige;
}

/**
 * @param {Object} kampf - der zu korrigierende/zurückzusetzende Kampf
 * @param {Array<Object>} kaempfe - alle Kämpfe des Pools
 * @returns {{ok: true, aufzuloesen: Array<Object>} | {ok: false, grund: string}}
 *   aufzuloesen: Patches ({id, kaempfer1_id?, kaempfer2_id?, status, sieger_id, matten_reihenfolge}),
 *   die abhängige, noch nicht begonnene Kämpfe wieder leeren; `ohneQuelle` markiert Kämpfe ohne
 *   Quellkampf-Verknüpfung (Gruppen-Halbfinale).
 */
export function pruefeKorrekturErlaubt(kampf, kaempfe) {
    const patches = new Map();
    const besucht = new Set();
    const offen = [kampf];

    while (offen.length) {
        const quelle = offen.pop();
        if (besucht.has(quelle.id)) continue;
        besucht.add(quelle.id);

        for (const abhaengig of ermittleAbhaengigeKaempfe(quelle, kaempfe)) {
            if (BEGONNEN.includes(abhaengig.status)) {
                return {
                    ok: false,
                    grund: `der Folgekampf (${kampfName(abhaengig)}) läuft bereits oder wurde bereits gewertet. Bitte zuerst dessen Ergebnis zurücksetzen.`
                };
            }
            const patch = patches.get(abhaengig.id) || {
                id: abhaengig.id, status: 'angelegt', sieger_id: null, matten_reihenfolge: null
            };
            const ueberQuelle = abhaengig.kaempfer1_quelle_kampf_id === quelle.id || abhaengig.kaempfer2_quelle_kampf_id === quelle.id;
            if (ueberQuelle) {
                if (abhaengig.kaempfer1_quelle_kampf_id === quelle.id) patch.kaempfer1_id = null;
                if (abhaengig.kaempfer2_quelle_kampf_id === quelle.id) patch.kaempfer2_id = null;
            } else {
                patch.kaempfer1_id = null;
                patch.kaempfer2_id = null;
                patch.ohneQuelle = true;
            }
            patches.set(abhaengig.id, patch);
            // Ein automatisches Freilos hängt am Ergebnis dieses Kampfes: dessen Folgekämpfe mitprüfen.
            if (abhaengig.status === 'freilos') offen.push(abhaengig);
        }
    }

    // Nur Patches, die tatsächlich etwas ändern
    const aufzuloesen = [...patches.values()].filter(patch => {
        const ist = kaempfe.find(k => k.id === patch.id);
        return ist.status !== 'angelegt' || ist.sieger_id != null || ist.matten_reihenfolge != null
            || ('kaempfer1_id' in patch && ist.kaempfer1_id != null)
            || ('kaempfer2_id' in patch && ist.kaempfer2_id != null);
    });
    return { ok: true, aufzuloesen };
}
