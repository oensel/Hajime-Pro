// Startseiten: Turnierwahl (mit Offline-Zugang) und Suche innerhalb eines Turniers.
import { api } from './api.js';
import { kachelZeilen, verbindung } from './anzeige.js';
import { bereinigeAlte, gecachteTurniere } from './speicher.js';
import { h, setzeStatus, zeigeTabs } from './ui.js';

// Namen der zuletzt gesehenen Turniere, damit der Offline-Start sie benennen kann (bewusst außerhalb des Präfixes
// hajime-live:, das bereinigeAlte aufräumt).
const META_TURNIERE = 'hajime-live-meta:turniere';

const inhalt = () => document.getElementById('inhalt');
let suchTimer = null;

export async function zeigeTurniere() {
    setzeStatus('');
    inhalt().replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Lade …'));
    try {
        const { turniere } = await api.turniere();
        try {
            bereinigeAlte(window.localStorage, turniere.map(x => x.key));
            window.localStorage.setItem(META_TURNIERE, JSON.stringify(turniere.map(x => ({ key: x.key, name: x.name, datum: x.datum }))));
        } catch { /* ohne Speicher */ }
        if (!turniere.length) {
            inhalt().replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Zurzeit ist kein Turnier freigegeben.'));
            return;
        }
        inhalt().replaceChildren(h('h1', {}, 'Turnier wählen'),
            h('ul', { class: 'knopf-liste' }, turniere.map(x => h('li', {},
                h('a', { href: `#/t/${encodeURIComponent(x.key)}`, 'data-testid': `turnier-${x.key}` }, `${x.name} · ${x.datum}`)))));
    } catch {
        // Ohne Verbindung (typisch in der Halle): die zuletzt geladene Übersicht je Turnier anbieten.
        let gemerkt = [];
        try { gemerkt = gecachteTurniere(window.localStorage); } catch { /* ohne Speicher */ }
        let namen = [];
        try { namen = JSON.parse(window.localStorage.getItem(META_TURNIERE)) || []; } catch { /* ohne Meta */ }
        const hinweis = h('p', { class: 'hinweis' }, 'Keine Verbindung. Bitte später erneut versuchen.');
        if (!gemerkt.length) { inhalt().replaceChildren(h('h1', {}, 'Turnier wählen'), hinweis); return; }
        setzeStatus('Keine Verbindung', true);
        inhalt().replaceChildren(h('h1', {}, 'Turnier wählen'), hinweis, h('p', {}, 'Zuletzt geladen:'),
            h('ul', { class: 'knopf-liste' }, gemerkt.map(k => {
                const meta = namen.find(x => x.key === k);
                return h('li', {}, h('a', { href: `#/t/${encodeURIComponent(k)}/uebersicht`, 'data-testid': `zuletzt-${k}` },
                    meta ? `${meta.name} · ${meta.datum}` : k));
            })));
    }
}

// Suche mit Autovervollständigung; die Vereine stehen als Link-Raster darunter (Task 5 baut die Ansicht vollständig um).
export async function zeigeStart({ key }) {
    zeigeTabs(key, 'suche');
    let turnier;
    try { turnier = await api.turnier(key); } catch {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, 'Das Turnier ist nicht (mehr) verfügbar.'));
        setzeStatus('');
        return;
    }
    const v = verbindung(turnier);
    setzeStatus(v.text, !v.verbunden);

    const trefferListe = h('div', { class: 'treffer-liste', 'data-testid': 'treffer' });
    function trefferEintrag(t) {
        const z = kachelZeilen(t);
        const text = [z.titel, t.verein, z.zeile1, z.zeile2 ?? z.zeile3].filter(Boolean).join(' · ');
        const ziel = t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}` : null;
        return h('ul', { class: 'knopf-liste' }, h('li', {},
            ziel ? h('a', { href: ziel, 'data-testid': `treffer-${t.key}` }, text)
                : h('div', { class: 'hinweis', 'data-testid': `treffer-${t.key}` }, text)));
    }
    const suchfeld = h('input', {
        type: 'search', placeholder: 'Name oder Vorname', 'aria-label': 'Teilnehmer suchen', 'data-testid': 'suchfeld',
        autocomplete: 'off',
        oninput: () => {
            clearTimeout(suchTimer);
            const q = suchfeld.value.trim();
            if (q.length < 2) { trefferListe.replaceChildren(); return; }
            suchTimer = setTimeout(async () => {
                try {
                    const { treffer } = await api.suche(key, q);
                    trefferListe.replaceChildren(...(treffer.length ? treffer.map(trefferEintrag) : [h('p', { class: 'hinweis' }, 'Keine Treffer.')]));
                } catch { trefferListe.replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); }
            }, 250);
        }
    });
    const vereine = h('div', { class: 'raster' }, turnier.vereine.map(x => h('a', {
        class: 'verein-kachel', href: `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(x.key)}`, 'data-testid': `verein-${x.key}`
    }, x.name, h('span', {}, String(x.anzahl)))));

    inhalt().replaceChildren(h('h1', {}, turnier.name), suchfeld, trefferListe, h('div', { class: 'abschnitt' }, 'Vereine'), vereine);
}
