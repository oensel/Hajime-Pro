// Startseiten: gemerkte Turniere (Zugang per QR-Code) und Suche innerhalb eines Turniers.
import { api } from './api.js';
import { sortiereTeams } from './uebersicht.js';
import { gewichtText, kachelZeilen, klassenTitel, verbindung } from './anzeige.js';
import { bereinigeAlte } from './speicher.js';
import { listeZugaenge } from './zugang.js';
import { h, inhalt, setzeStatus, speicherFuer, teamKachel, zeigeTabs } from './ui.js';

let suchTimer = null;

// Es gibt keine Liste aller Turniere: die App zeigt nur die Turniere, deren QR-Code dieses Gerät gescannt hat (Namen und Zugangscodes liegen im
// Gerät, der Start klappt also auch ohne Verbindung). Daten von Turnieren ohne Zugang werden aufgeräumt.
export async function zeigeTurniere() {
    setzeStatus('');
    const zugaenge = listeZugaenge();
    try { bereinigeAlte(window.localStorage, zugaenge.map((z) => z.key)); } catch { /* ohne Speicher */ }
    const hinweis = h('p', { class: 'hinweis', 'data-testid': 'qr-hinweis' }, 'Scanne den QR-Code, der in der Halle aushängt, um ein Turnier zu öffnen.');
    if (!zugaenge.length) {
        inhalt().replaceChildren(h('h1', {}, 'Teilnehmer-App'), hinweis);
        return;
    }
    const offline = navigator.onLine === false;
    if (offline) setzeStatus('Keine Verbindung', true);
    inhalt().replaceChildren(h('h1', {}, 'Deine Turniere'),
        h('ul', { class: 'knopf-liste' }, zugaenge.map((x) => h('li', {},
            h('a', { href: `#/t/${encodeURIComponent(x.key)}${offline ? '/uebersicht' : ''}`, 'data-testid': `turnier-${x.key}` }, [x.name, x.datum].filter(Boolean).join(' · ') || x.key)))),
        hinweis);
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
