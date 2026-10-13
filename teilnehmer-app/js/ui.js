// Gemeinsame Bausteine der Ansichten: DOM-Helfer, Reiterleiste, Statuszeile, Kachel. Alle Texte laufen über textContent.
import { kachelZeilen, klasseText, matteKurz, matteText } from './anzeige.js';
import { erzeugeSpeicher } from './speicher.js';

export function h(tag, attribute = {}, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'hidden') { if (v) el.setAttribute(k, ''); }
        else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kind of kinder.flat()) {
        if (kind == null || kind === false) continue;
        el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
    }
    return el;
}

export const inhalt = () => document.getElementById('inhalt');

export function icon(name) {
    const e = document.createElement('span');
    e.className = 'material-icons';
    e.setAttribute('aria-hidden', 'true');
    e.textContent = name;
    return e;
}

export function speicherFuer(turnierKey) {
    let storage = null;
    try { storage = window.localStorage; } catch { /* privater Modus */ }
    return erzeugeSpeicher(storage || { getItem: () => null, setItem() {} }, turnierKey);
}

export function setzeStatus(text, getrennt = false) {
    const zeile = document.getElementById('statuszeile');
    zeile.textContent = text || '';
    zeile.classList.toggle('getrennt', !!getrennt);
    const schild = document.getElementById('liveSchild');
    schild.textContent = getrennt ? '● Halle nicht verbunden' : '● Live';
    schild.classList.toggle('getrennt', !!getrennt);
}

// Zeitgeber der aktuellen Ansicht (Aktualisierung): der Router räumt ihn beim Wechsel auf.
let stoppFunktion = null;
export function setzeStopp(funktion) { stoppFunktion = funktion; }
export function rufeStopp() {
    if (stoppFunktion) { stoppFunktion(); stoppFunktion = null; }
}

const REITER = [
    ['suche', 'Suche', 'search', ''],
    ['pools', 'Pools', 'grid_view', '/pools'],
    ['turnier', 'Turnier', 'emoji_events', '/turnier'],
    ['uebersicht', 'Übersicht', 'star', '/uebersicht']
];

export function zeigeTabs(turnierKey, aktiv) {
    const nav = document.getElementById('reiter');
    nav.hidden = !turnierKey;
    if (!turnierKey) { nav.replaceChildren(); return; }
    nav.replaceChildren(...REITER.map(([id, titel, symbol, pfad]) => h('a', {
        href: `#/t/${encodeURIComponent(turnierKey)}${pfad}`, 'data-testid': `tab-${id}`,
        class: id === aktiv ? 'aktiv' : '', 'aria-current': id === aktiv ? 'page' : null
    }, icon(symbol), titel)));
}

// Glocke für alle Teilnehmer eines Vereins: dieselben Symbole wie an der Kachel (notifications / notifications_off).
export function glockeAlleKnopf(an, beiAenderung) {
    return h('button', {
        class: 'icon-knopf klein', type: 'button', 'data-testid': 'verein-glocke-alle', 'aria-pressed': String(an),
        'aria-label': an ? 'Benachrichtigung für alle aus' : 'Benachrichtigung für alle an',
        title: an ? 'Benachrichtigung für alle aus' : 'Benachrichtigung für alle an',
        onclick: (e) => { e.stopPropagation(); beiAenderung(!an); }
    }, icon(an ? 'notifications' : 'notifications_off'));
}

const KEINE_MATTE_MEHR = new Set(['keine_weiteren', 'abgeschlossen', 'nicht_erschienen']);

// Teilnehmerkachel mit Stern und Glocke. href: Ziel beim Antippen der Kachel (Pool des Teilnehmers).
export function kachel(t, speicher, neuZeichnen, { href = null, markiert = false } = {}) {
    const z = kachelZeilen(t);
    const gesternt = speicher.istGesternt(t.key, t.vereinKey);
    const glocke = speicher.hatGlocke(t.key, t.vereinKey);
    const klassen = ['kachel'];
    if (z.art === 'laeuft') klassen.push('laeuft');
    if (z.art === 'bald') klassen.push('bald');
    if (markiert) klassen.push('markiert');
    const knopf = (testId, an, beschriftungAn, beschriftungAus, symbolAn, symbolAus, aktion) => h('button', {
        class: 'icon-knopf', 'data-testid': `${testId}-${t.key}`, 'aria-pressed': String(an),
        'aria-label': an ? beschriftungAn : beschriftungAus,
        onclick: (e) => { e.stopPropagation(); aktion(!an); neuZeichnen(); }
    }, icon(an ? symbolAn : symbolAus));
    // Matten-Block links: die Matte ist die wichtigste Orientierung; die Farbe folgt dem Zustand (läuft/bald/sonst).
    // Wer nicht mehr kämpft (keine weiteren Kämpfe, abgeschlossen, nicht erschienen), braucht die Matte nicht mehr
    const matte = KEINE_MATTE_MEHR.has(t.zustand) ? '' : matteKurz(t.matteBezeichnung);
    if (matte) klassen.push('mit-matte');
    const zeile1 = matte || KEINE_MATTE_MEHR.has(t.zustand) ? klasseText(t) : z.zeile1;
    return h('div', {
        class: klassen.join(' '), 'data-testid': `kachel-${t.key}`,
        onclick: () => { if (href) location.hash = href; }
    },
        matte ? h('div', { class: 'matte-block', 'data-testid': `matte-${t.key}`, 'aria-label': matteText(t.matteBezeichnung) },
            h('small', {}, 'Matte'),
            h('span', { class: matte.length > 3 ? 'lang' : '' }, matte)) : null,
        h('div', { class: 'kachel-inhalt' },
            h('div', { class: 'name' }, z.titel),
            h('div', { class: 'aktionen' },
                knopf('stern', gesternt, 'Nicht mehr verfolgen', 'Verfolgen', 'star', 'star_border', (an) => speicher.stern(t.key, an, t.vereinKey)),
                // Abgeschlossene Teilnehmer haben nichts mehr zu melden: keine Glocke
                z.art === 'fertig' ? null : knopf('glocke', glocke, 'Benachrichtigung aus', 'Benachrichtigung an', 'notifications', 'notifications_off', (an) => speicher.glocke(t.key, an, t.vereinKey))),
            zeile1 && h('div', { class: 'zeile' }, zeile1),
            z.zeile2 && h('div', { class: `zeile status ${z.art}` }, z.zeile2),
            z.zeile3 && h('div', { class: `zeile status ${z.art}` }, z.zeile3)));
}
