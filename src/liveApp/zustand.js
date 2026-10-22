// Reine Entscheidungen der Teilnehmer-App am Hallen-Server (Spec docs/specs/2026-10-22-teilnehmer-app-schalter-design.md):
// wer sendet und welche Farbe das Icon zeigt. Kein knex, kein DOM.
export const ERFOLG_MAX_ALTER_MS = 90000;

const TEXT_AUS = 'Teilnehmer-App ausgeschaltet';
const TEXT_ROT = 'Keine Verbindung zur Cloud – die Teilnehmer-App erhält keine Daten';
const TEXT_GELB = 'Cloud erreichbar, aber es können keine Daten gesendet werden';

// Genau ein Server sendet. Ohne Cluster der einzige. Im Cluster bevorzugt der Secondary (dort hängt in der Regel das
// Tethering-Handy), der Master sendet nur, wenn der Secondary die Cloud nicht erreicht; beide leiten dieselbe Antwort aus
// ihrer eigenen Erreichbarkeit und der des Partners ab. partner: { rolle, cloud_erreichbar } oder null (unbekannt/aus).
export function entscheideSender({ clusterAktiv, rolle, eigenErreichbar, partner }) {
    if (!clusterAktiv) return eigenErreichbar ? 'eigener' : 'keiner';
    if (rolle === 'secondary') {
        if (eigenErreichbar) return 'eigener';
        return partner && partner.rolle === 'master' && partner.cloud_erreichbar ? 'partner' : 'keiner';
    }
    if (partner && partner.rolle === 'secondary' && partner.cloud_erreichbar) return 'partner';
    return eigenErreichbar ? 'eigener' : 'keiner';
}

export function berechneAnzeige({ verfuegbar, aktiv, cloudErreichbar, letzterErfolgMs, letzterFehler, jetztMs }) {
    if (!verfuegbar || !aktiv) return { zustand: 'grau', text: TEXT_AUS };
    if (!cloudErreichbar) return { zustand: 'rot', text: TEXT_ROT };
    const alter = letzterErfolgMs == null ? null : jetztMs - letzterErfolgMs;
    if (letzterFehler || alter == null || alter > ERFOLG_MAX_ALTER_MS) return { zustand: 'gelb', text: TEXT_GELB };
    return { zustand: 'gruen', text: `Teilnehmer-App läuft – letzter Abgleich vor ${Math.max(0, Math.round(alter / 1000))} s` };
}
