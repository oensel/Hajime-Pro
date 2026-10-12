// Hajime Live: Startbildschirm (Turnier, Suche mit Autovervollständigung, Verein), Pool-Ansicht, Übersicht.
// Alle Namen werden ausschließlich über textContent in die Seite gesetzt.
import { api } from './api.js';
import { kachelZeilen, verbindung } from './anzeige.js';
import { erzeugeSpeicher, bereinigeAlte } from './speicher.js';

const inhalt = document.getElementById('inhalt');
const statuszeile = document.getElementById('statuszeile');
const menue = document.getElementById('menue');
let aktualisierer = null;
let suchTimer = null;

function h(tag, attribute = {}, ...kinder) {
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

function speicherFuer(turnierKey) {
    let storage = null;
    try { storage = window.localStorage; } catch { /* privater Modus */ }
    return erzeugeSpeicher(storage || { getItem: () => null, setItem() {} }, turnierKey);
}

function setzeStatus(text, getrennt = false) {
    statuszeile.textContent = text;
    statuszeile.classList.toggle('getrennt', getrennt);
}

function stoppeAktualisierung() {
    if (aktualisierer) { clearInterval(aktualisierer); aktualisierer = null; }
}

function zeigeMenue(key) {
    menue.hidden = !key;
    if (!key) return;
    document.getElementById('menueUebersicht').href = `#/t/${encodeURIComponent(key)}/uebersicht`;
    document.getElementById('menueSuche').href = `#/t/${encodeURIComponent(key)}`;
}

function kachel(t, speicher, neuZeichnen) {
    const z = kachelZeilen(t);
    const gesternt = speicher.istGesternt(t.key);
    const glocke = speicher.hatGlocke(t.key, t.vereinKey);
    return h('div', { class: 'kachel', 'data-testid': `kachel-${t.key}` },
        h('div', { class: 'name' }, z.titel),
        h('div', { class: 'aktionen' },
            h('button', {
                class: 'icon-knopf', 'data-testid': `stern-${t.key}`, 'aria-pressed': String(gesternt),
                'aria-label': gesternt ? 'Nicht mehr verfolgen' : 'Verfolgen',
                onclick: () => { speicher.stern(t.key, !gesternt); neuZeichnen(); }
            }, gesternt ? '★' : '☆'),
            h('button', {
                class: 'icon-knopf', 'data-testid': `glocke-${t.key}`, 'aria-pressed': String(glocke),
                'aria-label': glocke ? 'Benachrichtigung aus' : 'Benachrichtigung an',
                onclick: () => { speicher.glocke(t.key, !glocke); neuZeichnen(); }
            }, glocke ? '🔔' : '🔕')),
        z.zeile1 && h('div', { class: 'zeile' }, z.zeile1),
        z.zeile2 && h('div', { class: `zeile ${z.art}` }, z.zeile2),
        z.zeile3 && h('div', { class: `zeile ${z.art}` }, z.zeile3));
}

async function zeigeStart() {
    stoppeAktualisierung();
    zeigeMenue(null);
    setzeStatus('');
    inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Lade …'));
    try {
        const { turniere } = await api.turniere();
        try { bereinigeAlte(window.localStorage, turniere.map(x => x.key)); } catch { /* ohne Speicher */ }
        if (!turniere.length) {
            inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Zurzeit ist kein Turnier freigegeben.'));
            return;
        }
        inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'),
            h('ul', { class: 'knopf-liste' }, turniere.map(x => h('li', {},
                h('a', { href: `#/t/${encodeURIComponent(x.key)}`, 'data-testid': `turnier-${x.key}` }, `${x.name} · ${x.datum}`)))));
    } catch {
        inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Keine Verbindung. Bitte später erneut versuchen.'));
    }
}

async function zeigeTurnier(key) {
    stoppeAktualisierung();
    zeigeMenue(key);
    let turnier;
    try { turnier = await api.turnier(key); } catch {
        inhalt.replaceChildren(h('p', { class: 'hinweis' }, 'Das Turnier ist nicht (mehr) verfügbar.'));
        setzeStatus('');
        return;
    }
    const v = verbindung(turnier);
    setzeStatus(v.text, !v.verbunden);

    const trefferListe = h('div', { 'data-testid': 'treffer' });
    function trefferEintrag(t) {
        const z = kachelZeilen(t);
        const text = `${z.titel} · ${[z.zeile1, z.zeile2 ?? z.zeile3].filter(Boolean).join(' · ')}`;
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
    const vereinsauswahl = h('select', {
        'data-testid': 'vereinsauswahl', 'aria-label': 'Verein wählen',
        onchange: () => { if (vereinsauswahl.value) location.hash = `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(vereinsauswahl.value)}`; }
    }, h('option', { value: '' }, 'Verein wählen …'),
        turnier.vereine.map(x => h('option', { value: x.key }, `${x.name} (${x.anzahl})`)));

    inhalt.replaceChildren(h('h1', {}, turnier.name), suchfeld, trefferListe, vereinsauswahl);
}

async function zeigeListe(key, ladeFunktion, vereinKey = null) {
    stoppeAktualisierung();
    zeigeMenue(key);
    const speicher = speicherFuer(key);
    async function zeichne() {
        let daten;
        try { daten = await ladeFunktion(); } catch (f) {
            inhalt.replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
            return;
        }
        const liste = daten.teilnehmer;
        const kopf = [h('h1', {}, daten.titel)];
        if (vereinKey) {
            const gesternt = speicher.vereinGesternt(vereinKey);
            kopf.push(h('div', { class: 'verein-leiste' },
                h('button', {
                    class: 'icon-knopf', 'data-testid': 'verein-stern', 'aria-pressed': String(gesternt),
                    'aria-label': gesternt ? 'Verein nicht mehr verfolgen' : 'Ganzen Verein verfolgen',
                    onclick: () => { speicher.vereinStern(vereinKey, !gesternt); zeichne(); }
                }, gesternt ? '★' : '☆'),
                gesternt && h('label', {}, h('input', {
                    type: 'checkbox', 'data-testid': 'verein-glocke-alle',
                    checked: liste.length > 0 && liste.every(t => speicher.hatGlocke(t.key, vereinKey)),
                    onchange: (e) => { speicher.vereinGlockeAlle(vereinKey, e.target.checked); zeichne(); }
                }), ' Glocke für alle')));
        }
        inhalt.replaceChildren(...kopf,
            ...(liste.length ? liste.map(t => kachel(t, speicher, zeichne)) : [h('p', { class: 'hinweis' }, 'Keine Teilnehmer.')]));
    }
    await zeichne();
}

async function zeigeUebersicht(key) {
    stoppeAktualisierung();
    zeigeMenue(key);
    const speicher = speicherFuer(key);
    const cacheName = `hajime-live:cache:${key}`;

    async function lade() {
        const anfrage = speicher.anfrage();
        if (!anfrage.teilnehmer.length && !anfrage.vereine.length) {
            inhalt.replaceChildren(h('h1', {}, 'Übersicht'),
                h('p', { class: 'hinweis' }, 'Noch niemand verfolgt. Suche einen Teilnehmer und setze den Stern ☆.'));
            setzeStatus('');
            return;
        }
        let antwort;
        let ausCache = false;
        try {
            antwort = await api.uebersicht(key, anfrage);
            try { localStorage.setItem(cacheName, JSON.stringify(antwort)); } catch { /* ohne Speicher */ }
        } catch {
            try { antwort = JSON.parse(localStorage.getItem(cacheName)); } catch { antwort = null; }
            ausCache = true;
        }
        if (!antwort) {
            inhalt.replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Keine Verbindung.'));
            setzeStatus('Keine Verbindung', true);
            return;
        }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        const liste = antwort.teilnehmer;
        inhalt.replaceChildren(h('h1', {}, 'Übersicht'),
            ...(liste.length ? liste.map(t => kachel(t, speicher, lade))
                : [h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.')]));
    }
    await lade();
    aktualisierer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}

function route() {
    const teile = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (teile[0] !== 't' || !teile[1]) return zeigeStart();
    const key = teile[1];
    if (teile[2] === 'uebersicht') return zeigeUebersicht(key);
    if (teile[2] === 'pool' && teile[3]) {
        return zeigeListe(key, async () => {
            const p = await api.pool(key, teile[3]);
            const matte = p.pool.matteBezeichnung ? ` · ${p.pool.matteBezeichnung}` : '';
            return { titel: `${p.pool.bezeichnung}${matte}`, teilnehmer: p.teilnehmer };
        });
    }
    if (teile[2] === 'verein' && teile[3]) {
        return zeigeListe(key, async () => {
            const [turnier, v] = await Promise.all([api.turnier(key), api.verein(key, teile[3])]);
            const name = turnier.vereine.find(x => x.key === teile[3])?.name || 'Verein';
            return { titel: name, teilnehmer: v.teilnehmer };
        }, teile[3]);
    }
    return zeigeTurnier(key);
}

window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
