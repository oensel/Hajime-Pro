// Pool: Reiter Baum, Kämpfe, Teilnehmer. Startreiter und Markierung kommen aus der Route:
// #/t/<k>/pool/<poolId>/<baum|kaempfe|teilnehmer>/<markierung>
import { api } from './api.js';
import { h, icon, inhalt, kachel, setzeStatus, speicherFuer, zeigeTabs } from './ui.js';
import { kampfStatus, poolName } from './anzeige.js';
import { baueBaumModell } from './baum.js';
import { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } from '/js/shared/poolRunden.js';

const REITER = [['baum', 'Baum'], ['kaempfe', 'Kämpfe'], ['teilnehmer', 'Teilnehmer']];
const defs = { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE };

function kartenZeichnung(k, sterne, markierterKampf) {
    const klassen = ['karte'];
    if (k.laeuft) klassen.push('laeuft');
    if (markierterKampf != null && String(k.id) === String(markierterKampf)) klassen.push('markiert');
    return h('div', { class: klassen.join(' '), 'data-testid': `kampf-${k.id}` },
        k.zeilen.map(z => h('div', { class: `z${z.sieger ? ' sieger' : ''}${z.name === 'offen' ? ' offen' : ''}${z.key && sterne.has(z.key) ? ' stern' : ''}` },
            h('span', {}, z.key && sterne.has(z.key) ? `${z.name} ★` : z.name),
            z.punkte != null ? h('span', {}, String(z.punkte)) : null)));
}

function abschnittZeichnen(a, sterne, markierterKampf) {
    if (a.art === 'runden') {
        const leer = a.runden.every(r => r.kaempfe.every(k => k === null));
        return h('div', {},
            h('div', { class: 'abschnitt' }, a.titel),
            leer ? h('p', { class: 'hinweis' }, 'Noch keine Paarungen.')
                : h('div', { class: 'scroll' }, h('div', { class: 'runden' }, a.runden.map(r => h('div', { class: 'runde' },
                    h('div', { class: 'runde-titel' }, r.titel),
                    h('div', { class: 'runde-liste' }, r.kaempfe.map(k => (k ? kartenZeichnung(k, sterne, markierterKampf)
                        : h('div', { class: 'karte', style: 'visibility:hidden' }, h('div', { class: 'z' }, '–'))))))))));
    }
    if (!a.teilnehmer.length) return h('div', {}, a.titel && h('div', { class: 'abschnitt' }, a.titel), h('p', { class: 'hinweis' }, 'Noch keine Paarungen.'));
    return h('div', {},
        a.titel && h('div', { class: 'abschnitt' }, a.titel),
        h('div', { class: 'scroll' }, h('table', { class: 'bogen' },
            h('tr', {}, h('th', {}), ...a.teilnehmer.map((_, i) => h('th', {}, String(i + 1))), h('th', {}, 'Siege')),
            ...a.teilnehmer.map((t, i) => h('tr', {},
                h('th', { class: 'name' }, `${i + 1} ${t.name}${sterne.has(t.key) ? ' ★' : ''}`),
                ...a.zellen[i].map(z => (z === null ? h('td', { class: 'diagonale' }) : h('td', {
                    class: `${z.art}${markierterKampf != null && String(z.kampfId) === String(markierterKampf) ? ' markiert' : ''}`
                }, z.text, ...z.zusatz.map(x => h('span', { class: 'zusatz' }, x.text))))),
                h('td', {}, String(a.siege[i])))))));
}

export async function zeigePool({ key, teile }) {
    const poolId = teile[1];
    const startReiter = REITER.some(([id]) => id === teile[2]) ? teile[2] : 'baum';
    const markierung = teile[3] ?? null;
    zeigeTabs(key, 'pools');
    const speicher = speicherFuer(key);
    const cacheName = `hajime-live:cache-pool:${key}:${poolId}`;
    let daten;
    let ausCache = false;
    try {
        daten = await api.pool(key, poolId);
        try { localStorage.setItem(cacheName, JSON.stringify(daten)); } catch { /* ohne Speicher */ }
    } catch (f) {
        if (f.status === 404) { inhalt().replaceChildren(h('p', { class: 'hinweis' }, 'Pool nicht gefunden.')); return; }
        try { daten = JSON.parse(localStorage.getItem(cacheName)); } catch { daten = null; }
        ausCache = true;
        if (!daten) { inhalt().replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); setzeStatus('Keine Verbindung', true); return; }
    }
    if (ausCache) setzeStatus('Keine Verbindung · zuletzt geladener Stand', true); else setzeStatus('');

    let reiter = startReiter;
    function zeichne() {
        const sterne = new Set(daten.teilnehmer.filter(t => speicher.istGesternt(t.key, t.vereinKey)).map(t => t.key));
        const kopf = [
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}/pools` }, icon('chevron_left'), 'Pools'),
            h('h1', {}, poolName(daten.pool.bezeichnung), daten.pool.matteBezeichnung ? h('small', {}, daten.pool.matteBezeichnung) : null),
            h('div', { class: 'segment' }, REITER.map(([id, titel]) => h('a', {
                href: '#', 'data-testid': `reiter-${id}`, class: id === reiter ? 'aktiv' : '',
                onclick: (e) => { e.preventDefault(); reiter = id; zeichne(); }
            }, titel)))
        ];
        let rumpf;
        if (reiter === 'teilnehmer') {
            rumpf = daten.teilnehmer.length
                ? daten.teilnehmer.map(t => kachel(t, speicher, zeichne, { markiert: markierung === t.key }))
                : [h('p', { class: 'hinweis' }, 'Keine Teilnehmer.')];
        } else if (!daten.kaempfe || !daten.kaempfe.length) {
            rumpf = [h('p', { class: 'hinweis' }, daten.pool.modus || daten.pool.status ? 'Noch nicht ausgelost.' : 'Noch keine Kampfdaten von der Halle.')];
        } else if (reiter === 'kaempfe') {
            rumpf = daten.kaempfe.map(k => {
                const s = kampfStatus(k);
                const name = (f, slot) => (f ? f.name : (k.status === 'freilos' && slot === 2 ? 'Freilos' : 'offen'));
                const klasse = (f) => (f && k.sieger === f.key ? 'sieger' : '');
                return h('div', {
                    class: `kampfzeile${markierung != null && String(k.id) === String(markierung) && startReiter === 'kaempfe' ? ' markiert' : ''}`,
                    'data-testid': `kampf-${k.id}`,
                    onclick: () => { reiter = 'baum'; zeichne(); }
                }, h('span', { class: 'nr' }, k.nr), h('span', { class: klasse(k.k1) }, name(k.k1, 1)), '–', h('span', { class: klasse(k.k2) }, name(k.k2, 2)),
                h('span', { class: 'rechts' }, s.text));
            });
            rumpf.push(h('button', { class: 'knopf', type: 'button', 'data-testid': 'baum-oeffnen', onclick: () => { reiter = 'baum'; zeichne(); } },
                icon('account_tree'), 'Turnierbaum öffnen'));
        } else {
            const modell = baueBaumModell(daten.pool.modus, daten.kaempfe, defs);
            rumpf = modell.abschnitte.map(a => abschnittZeichnen(a, sterne, markierung));
        }
        inhalt().replaceChildren(...kopf, ...rumpf);
    }
    zeichne();
}
