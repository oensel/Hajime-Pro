/**
 * Antwort von GET /api/pools/zeitprognose als reine Funktion: voraussichtliches Ende je Matte und
 * Rückstand gegenüber der frühesten Matte. Gemeinsam genutzt vom Server (poolController) und von
 * Client-Geräten (clientAntworten.js / public/js/datenzugriff.js).
 */
import { baueMattenAnsicht } from './mattenAnsicht.js';
import { prognoseMatte, berechneRueckstand } from './zeitPrognose.js';

export function baueZeitprognoseAntwort({ kampfflaechen, pools, kaempfe, mannschaftskaempfe = [], mannschaften = [] }, jetztMs) {
    // Der Sammelpool "Verspätet" hat keine Matte und keinen Kampfplan.
    const echtePools = (pools || []).filter(p => !p.verspaetet);
    const sortiert = [...(kampfflaechen || [])].sort((a, b) => Number(a.id) - Number(b.id));
    const matten = sortiert.map(matte => {
        const liste = baueMattenAnsicht(
            { kaempfe, pools: echtePools, teilnehmer: [], mannschaftskaempfe, mannschaften, turnier: null },
            matte.id, jetztMs);
        const p = prognoseMatte(liste, jetztMs);
        // Voraussichtlicher Start je Pool, der auf dieser Matte noch keinen Kampf begonnen hat (Dashboard).
        const begonnen = new Set(liste.filter(k => k.status === 'gestartet' || k.status === 'beendet').map(k => k.pool_id));
        const startJePool = new Map();
        for (const k of liste) {
            if (k.voraussichtlich_um == null || begonnen.has(k.pool_id)) continue;
            if (!startJePool.has(k.pool_id) || k.voraussichtlich_um < startJePool.get(k.pool_id)) startJePool.set(k.pool_id, k.voraussichtlich_um);
        }
        const poolStarts = [...startJePool].map(([poolId, startMs]) => ({ poolId, startMs }));
        return { id: matte.id, bezeichnung: matte.bezeichnung, endeMs: p.endeMs, offeneKaempfe: p.offeneKaempfe, dauerSekunden: p.dauerSekunden, poolStarts, rueckstand: null };
    });
    const rueckstand = berechneRueckstand(matten);
    const nachId = new Map(matten.map(m => [m.id, m]));
    for (const m of matten) {
        const r = rueckstand.get(m.id);
        if (r) m.rueckstand = { ...r, bezugBezeichnung: nachId.get(r.bezugMatteId).bezeichnung };
    }
    return { jetzt: jetztMs, matten };
}
