// Hajime Pro: Hash-Router. Die Ansichten liegen in ansicht-*.js; jede exportiert eine Funktion (kontext) → Promise.
// Routen: #/ Turniere · #/t/<k> Suche · #/t/<k>/uebersicht · #/t/<k>/verein/<vk> · #/t/<k>/pool/<poolId>
// Zugang: Die App öffnet sich über den ausgehängten QR-Code (`/live/#z=<Code>`). Der Code wird sofort aus der Adresse entfernt, gegen das
// Turnier eingetauscht und im Gerät gemerkt (zugang.js); ohne Code liefert die Cloud keine Daten (Spec docs/specs/2026-10-24-teilnehmer-app-zugang.md).
import { zeigeTabs, setzeStatus, rufeStopp, h, inhalt } from './ui.js';
import { api } from './api.js';
import { speichereZugang, entferneZugang, listeZugaenge, holeZugang } from './zugang.js';
import { bereinigeAlte } from './speicher.js';
import { zeigeTurniere, zeigeStart } from './ansicht-start.js';
import { zeigeVerein } from './ansicht-verein.js';
import { zeigeUebersicht } from './ansicht-uebersicht.js';
import { zeigePool } from './ansicht-pool.js';
import { zeigePools } from './ansicht-pools.js';
import { zeigeTurnier } from './ansicht-turnier.js';
import { zeigeMannschaft, zeigeMannschaftsPool } from './ansicht-mannschaft.js';

const ROUTEN = {
    suche: zeigeStart,
    uebersicht: zeigeUebersicht,
    verein: zeigeVerein,
    pool: zeigePool,
    pools: zeigePools,
    turnier: zeigeTurnier,
    mannschaft: zeigeMannschaft,
    mannschaftspool: zeigeMannschaftsPool
};

const QR_HASH = /^#z=([A-Za-z0-9_-]{22})$/;

function zeigeMeldung(titel, text, { erneut = null } = {}) {
    rufeStopp();
    zeigeTabs(null);
    setzeStatus('');
    inhalt().replaceChildren(
        h('h1', {}, titel),
        h('p', { class: 'hinweis', 'data-testid': 'zugang-meldung' }, text),
        ...(erneut ? [h('p', {}, h('a', { href: '#/', onclick: (e) => { e.preventDefault(); erneut(); }, 'data-testid': 'zugang-erneut' }, 'Erneut versuchen'))] : []),
        h('p', {}, h('a', { href: '#/', 'data-testid': 'zur-startseite' }, 'Zur Startseite')));
}

const SCAN_FEHLER = {
    abgelaufen: ['Aushang abgelaufen', 'Dieser Aushang ist abgelaufen: Das Turnier ist beendet oder nicht mehr freigegeben.'],
    gesperrt: ['Zugang gesperrt', 'Der Veranstalter hat den Zugang gesperrt.'],
    zugang: ['QR-Code ungültig', 'Dieser QR-Code gilt nicht (mehr). Bitte scanne den aktuellen Aushang in der Halle.']
};

// Der Code aus dem QR-Code: aus der Adresse entfernen, einlösen, merken, zum Turnier springen.
async function uebernimmQr() {
    const treffer = QR_HASH.exec(location.hash);
    if (!treffer) return false;
    const code = treffer[1];
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
    zeigeTabs(null);
    setzeStatus('');
    inhalt().replaceChildren(h('h1', {}, 'Turnier wird geöffnet …'));
    try {
        const turnier = await api.zugangAufloesen(code);
        speichereZugang(turnier.key, code, { name: turnier.name, datum: turnier.datum });
        location.hash = `#/t/${encodeURIComponent(turnier.key)}`;
    } catch (f) {
        if (f.status === 429) return zeigeMeldung('Zu viele Versuche', 'Bitte warte einen Moment und scanne den QR-Code erneut.'), true;
        const bekannt = (f.status === 401 || f.status === 403) && SCAN_FEHLER[f.code || 'zugang'];
        if (bekannt) zeigeMeldung(bekannt[0], bekannt[1]);
        else zeigeMeldung('Keine Verbindung', 'Das Turnier konnte nicht geöffnet werden. Bitte prüfe deine Verbindung.', { erneut: () => { location.hash = `#z=${code}`; uebernimmQr(); } });
    }
    return true;
}

async function route() {
    rufeStopp();
    let teile;
    try {
        teile = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
        teile = [];
    }
    if (teile[0] !== 't' || !teile[1]) { zeigeTabs(null); setzeStatus(''); return zeigeTurniere(); }
    // Ohne Zugangscode im Gerät gibt es nichts zu zeigen: erst den QR-Code in der Halle scannen.
    if (!holeZugang(teile[1])) {
        return zeigeMeldung('Zugang erforderlich', 'Scanne den QR-Code, der in der Halle aushängt, um dieses Turnier zu öffnen.');
    }
    const kontext = { key: teile[1], teile: teile.slice(2) };
    const ansicht = kontext.teile[0] || 'suche';
    return (ROUTEN[ansicht] || zeigeStart)(kontext);
}

// Verliert ein Code seine Gültigkeit (ersetzt, gesperrt, abgelaufen), räumt die App das Turnier auf diesem Gerät auf. Das Ereignis kommt aus
// api.js, bevor die Ansicht ihren Fehlertext setzt; deshalb erst danach (setTimeout) die Meldung anzeigen.
window.addEventListener('hajime:zugang-verloren', (e) => {
    const { key, grund } = e.detail;
    entferneZugang(key);
    try { bereinigeAlte(window.localStorage, listeZugaenge().map((z) => z.key)); } catch { /* ohne Speicher */ }
    const [titel, text] = grund === 'abgelaufen'
        ? ['Zugang beendet', 'Der Zugang zu diesem Turnier ist abgelaufen. Danke fürs Zuschauen!']
        : (SCAN_FEHLER[grund] || SCAN_FEHLER.zugang);
    setTimeout(() => zeigeMeldung(titel, text), 0);
});

window.addEventListener('hashchange', () => { if (!QR_HASH.test(location.hash)) route(); else uebernimmQr(); });
(async () => {
    if (!(await uebernimmQr())) route();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
