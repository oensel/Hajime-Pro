// Startseiten: Turnierwahl (mit Offline-Zugang) und Suche innerhalb eines Turniers.
import { api } from './api.js';
import { sortiereTeams } from './uebersicht.js';
import { gewichtText, kachelZeilen, klassenTitel, verbindung } from './anzeige.js';
import { bereinigeAlte, gecachteTurniere } from './speicher.js';
import { h, inhalt, setzeStatus, speicherFuer, teamKachel, zeigeTabs } from './ui.js';

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

    const speicher = speicherFuer(key);
    const trefferListe = h('div', { 'data-testid': 'treffer' });
    let letzteTreffer = null;
    // Mannschaften zuerst, dann Kämpfer in Mannschaften (führen zum Team, ohne eigenen Stern), dann Einzelstarter.
    function zeichneTreffer() {
        const t = letzteTreffer;
        if (!t) { trefferListe.replaceChildren(); return; }
        const teile = [];
        if (t.mannschaften.length) {
            teile.push(h('div', { class: 'abschnitt' }, 'Mannschaften'),
                ...sortiereTeams(t.mannschaften).map(m => teamKachel(m, speicher, zeichneTreffer, { href: `#/t/${encodeURIComponent(key)}/mannschaft/${encodeURIComponent(m.key)}` })));
        }
        if (t.mitglieder.length) {
            teile.push(h('div', { class: 'abschnitt' }, 'Kämpfer in Mannschaften'),
                h('div', { class: 'treffer' }, t.mitglieder.map(m => h('a', {
                    href: `#/t/${encodeURIComponent(key)}/mannschaft/${encodeURIComponent(m.mannschaft.key)}`,
                    'data-testid': `mitglied-${m.mannschaft.key}`
                }, `${m.nachname}, ${m.vorname}`,
                h('small', {}, [`Mannschaft ${m.mannschaft.bezeichnung}`, m.gewichtsklasse ? `${String(m.gewichtsklasse).replace(/^-/, '−')} kg` : null].filter(Boolean).join(' · '))))));
        }
        if (t.treffer.length) {
            if (teile.length) teile.push(h('div', { class: 'abschnitt' }, 'Einzelstarter'));
            teile.push(h('div', { class: 'treffer' }, t.treffer.map(x => trefferZeile(key, x))));
        }
        trefferListe.replaceChildren(...(teile.length ? teile : [h('p', { class: 'hinweis' }, 'Keine Treffer.')]));
    }
    const suchfeld = h('input', {
        type: 'search', placeholder: 'Name oder Vorname suchen', 'aria-label': 'Teilnehmer suchen', 'data-testid': 'suchfeld',
        autocomplete: 'off',
        oninput: () => {
            clearTimeout(suchTimer);
            const q = suchfeld.value.trim();
            if (q.length < 2) { trefferListe.replaceChildren(); return; }
            suchTimer = setTimeout(async () => {
                try {
                    const antwort = await api.suche(key, q);
                    letzteTreffer = {
                        treffer: antwort.treffer || [], mannschaften: antwort.mannschaften || [], mitglieder: antwort.mitglieder || []
                    };
                    zeichneTreffer();
                } catch { trefferListe.replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); }
            }, 250);
        }
    });

    const vereine = h('div', { class: 'raster' }, turnier.vereine.map(x => h('a', {
        class: 'verein-kachel', 'data-testid': `verein-${x.key}`, href: `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(x.key)}`
    }, x.name, h('span', {}, String(x.anzahl)))));

    const klassen = (turnier.klassen || []).map(gruppe => {
        const id = `${gruppe.altersklasse}-${gruppe.geschlecht}`;
        const chips = h('div', { class: 'chips' }, gruppe.pools.map(p => h('a', {
            class: 'chip', 'data-testid': `gewicht-${p.poolId}`,
            href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/teilnehmer`
        }, gewichtText(p.gewichtsklasse) || p.bezeichnung)));
        const titel = h('div', { class: 'gruppen-titel', 'data-testid': `klasse-${id}` }, klassenTitel(gruppe), h('span', {}, `${gruppe.pools.length} Pools`));
        return h('div', { class: 'gruppe' }, titel, chips);
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
