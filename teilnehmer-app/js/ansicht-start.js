// Startseiten: Turnierwahl (mit Offline-Zugang) und Suche innerhalb eines Turniers.
import { api } from './api.js';
import { gewichtText, kachelZeilen, klassenTitel, verbindung } from './anzeige.js';
import { bereinigeAlte, gecachteTurniere } from './speicher.js';
import { h, inhalt, setzeStatus, zeigeTabs } from './ui.js';

// Namen der zuletzt gesehenen Turniere, damit der Offline-Start sie benennen kann (bewusst außerhalb des Präfixes
// hajime-live:, das bereinigeAlte aufräumt).
const META_TURNIERE = 'hajime-live-meta:turniere';

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

export async function zeigeStart({ key }) {
    zeigeTabs(key, 'suche');
    let turnier;
    try { turnier = await api.turnier(key); } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    const v = verbindung(turnier);
    setzeStatus(v.text, !v.verbunden);

    const trefferListe = h('div', { 'data-testid': 'treffer' });
    const suchfeld = h('input', {
        type: 'search', placeholder: 'Name oder Vorname suchen', 'aria-label': 'Teilnehmer suchen', 'data-testid': 'suchfeld',
        autocomplete: 'off',
        oninput: () => {
            clearTimeout(suchTimer);
            const q = suchfeld.value.trim();
            if (q.length < 2) { trefferListe.replaceChildren(); return; }
            suchTimer = setTimeout(async () => {
                try {
                    const { treffer } = await api.suche(key, q);
                    trefferListe.replaceChildren(treffer.length
                        ? h('div', { class: 'treffer' }, treffer.map(t => trefferZeile(key, t)))
                        : h('p', { class: 'hinweis' }, 'Keine Treffer.'));
                } catch { trefferListe.replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); }
            }, 250);
        }
    });

    const vereine = h('div', { class: 'raster' }, turnier.vereine.map(x => h('a', {
        class: 'verein-kachel', 'data-testid': `verein-${x.key}`, href: `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(x.key)}`
    }, x.name, h('span', {}, String(x.anzahl)))));

    const klassen = (turnier.klassen || []).map(gruppe => {
        const id = `${gruppe.altersklasse}-${gruppe.geschlecht}`;
        const chips = h('div', { class: 'chips', hidden: true }, gruppe.pools.map(p => h('a', {
            class: 'chip', 'data-testid': `gewicht-${p.poolId}`,
            href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/teilnehmer`
        }, gewichtText(p.gewichtsklasse) || p.bezeichnung)));
        const kasten = h('div', { class: 'gruppe' });
        const knopf = h('button', {
            type: 'button', 'data-testid': `klasse-${id}`, 'aria-expanded': 'false',
            onclick: () => {
                const offen = chips.hidden;
                chips.hidden = !offen;
                kasten.classList.toggle('offen', offen);
                knopf.setAttribute('aria-expanded', String(offen));
            }
        }, klassenTitel(gruppe), h('span', {}, `${gruppe.pools.length} Pools`));
        kasten.append(knopf, chips);
        return kasten;
    });

    inhalt().replaceChildren(
        h('h1', {}, turnier.name),
        suchfeld, trefferListe,
        h('div', { class: 'abschnitt' }, 'Vereine'),
        turnier.vereine.length ? vereine : h('p', { class: 'hinweis' }, 'Noch keine Teilnehmer gemeldet.'),
        h('div', { class: 'abschnitt' }, 'Alters- und Gewichtsklassen'),
        ...(klassen.length ? klassen : [h('p', { class: 'hinweis' }, 'Noch keine Pools von der Halle gemeldet.')]));
}

function trefferZeile(key, t) {
    const z = kachelZeilen(t);
    const text = [z.titel, t.verein].filter(Boolean).join(' · ');
    const unten = [z.zeile1, z.zeile2 ?? z.zeile3].filter(Boolean).join(' · ');
    const inhaltsknoten = [text, h('small', {}, unten)];
    const hinweis = t.poolId == null || ['nicht_ausgelost', 'ohne_matte', 'verspaetet'].includes(t.zustand);
    return t.poolId != null
        ? h('a', { href: `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}`, 'data-testid': `treffer-${t.key}`, class: hinweis ? 'hinweis-zeile' : '' }, inhaltsknoten)
        : h('div', { class: 't hinweis-zeile', 'data-testid': `treffer-${t.key}` }, inhaltsknoten);
}
