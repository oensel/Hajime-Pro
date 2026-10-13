// Vereinsansicht: Stern und Glocke neben dem Vereinsnamen, Teilnehmer nach Dringlichkeit sortiert.
import { api } from './api.js';
import { teileInAbschnitte } from './uebersicht.js';
import { glockeAlleKnopf, h, icon, inhalt, kachel, setzeStatus, speicherFuer, zeigeTabs } from './ui.js';

export async function zeigeVerein({ key, teile }) {
    const vereinKey = teile[1];
    zeigeTabs(key, 'suche');
    const speicher = speicherFuer(key);
    let turnier;
    let liste;
    try {
        [turnier, liste] = await Promise.all([api.turnier(key), api.verein(key, vereinKey)]);
    } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    setzeStatus('');
    const name = (turnier.vereine.find(x => x.key === vereinKey) || {}).name || 'Verein';
    const poolLink = (t) => (t.poolId != null
        ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null);

    function zeichne() {
        const gesternt = speicher.vereinGesternt(vereinKey);
        const mitglieder = liste.teilnehmer;
        // Stern und Glocke wie an den Kämpfern, rechtsbündig neben dem Vereinsnamen
        const sternKnopf = h('button', {
            class: 'icon-knopf klein', type: 'button', 'data-testid': 'verein-stern', 'aria-pressed': String(gesternt),
            'aria-label': gesternt ? 'Verein nicht mehr verfolgen' : 'Verein verfolgen',
            title: gesternt ? 'Verein nicht mehr verfolgen' : 'Verein verfolgen',
            onclick: () => { speicher.vereinStern(vereinKey, !gesternt); zeichne(); }
        }, icon(gesternt ? 'star' : 'star_border'));
        const aktionen = h('div', { class: 'aktionen-zeile' },
            sternKnopf,
            gesternt ? glockeAlleKnopf(
                mitglieder.some(t => speicher.istGesternt(t.key, vereinKey))
                    && mitglieder.filter(t => speicher.istGesternt(t.key, vereinKey)).every(t => speicher.hatGlocke(t.key, vereinKey)),
                (an) => { speicher.vereinGlockeAlle(vereinKey, an); zeichne(); }) : null);
        inhalt().replaceChildren(
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}` }, icon('chevron_left'), 'Zurück'),
            h('h1', { class: 'mit-aktionen' }, h('span', {}, name), aktionen),
            ...teileInAbschnitte(mitglieder).flatMap(a => [
                h('div', { class: 'abschnitt trenner', 'data-testid': `abschnitt-${a.id}` }, a.titel, h('span', {}, String(a.eintraege.length))),
                ...a.eintraege.map(t => kachel(t, speicher, zeichne, { href: poolLink(t) }))
            ]));
    }
    zeichne();
}
