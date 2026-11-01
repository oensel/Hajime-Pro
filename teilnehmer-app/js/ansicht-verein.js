// Vereinsansicht: Stern und Glocke neben dem Vereinsnamen, Teilnehmer nach Dringlichkeit sortiert.
import { api } from './api.js';
import { teileInAbschnitte } from './uebersicht.js';
import { aktuellerPushHinweis } from './push.js';
import { glockeAlleKnopf, h, icon, inhalt, kachel, setzeStatus, setzeStopp, speicherFuer, starteAktualisierung, zeigeTabs } from './ui.js';

export async function zeigeVerein({ key, teile }) {
    const vereinKey = teile[1];
    zeigeTabs(key, 'suche');
    const speicher = speicherFuer(key);
    let timer = null;
    let beendet = false;
    const stoppe = () => { beendet = true; if (timer) { timer(); timer = null; } };
    setzeStopp(stoppe);
    let name = null;
    let liste = null;
    let gezeichnet = null;

    // Der Vereinsname steht in den Turnierdaten und ändert sich nicht: nur beim ersten Laden holen. Neu gezeichnet wird nur bei geändertem Stand.
    async function lade() {
        let neu;
        try {
            if (name == null) {
                const [turnier, mitglieder] = await Promise.all([api.turnier(key), api.verein(key, vereinKey)]);
                name = (turnier.vereine.find(x => x.key === vereinKey) || {}).name || 'Verein';
                neu = mitglieder;
            } else {
                neu = await api.verein(key, vereinKey);
            }
        } catch (f) {
            if (beendet) return;
            if (f.status === 404) stoppe();
            if (f.status === 404 || !liste) {
                inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
                setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
            } else {
                setzeStatus('Keine Verbindung · zuletzt geladener Stand', true);
            }
            return;
        }
        if (beendet) return;
        setzeStatus('');
        const stand = JSON.stringify(neu);
        if (stand === gezeichnet) return;
        liste = neu;
        gezeichnet = stand;
        zeichne();
    }
    const poolLink = (t) => (t.poolId != null
        ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null);

    function zeichne() {
        const gesternt = speicher.vereinGesternt(vereinKey);
        const mitglieder = liste.teilnehmer;
        const pushHinweis = aktuellerPushHinweis(speicher);
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
            ...(pushHinweis ? [h('p', { class: 'hinweis push-hinweis', 'data-testid': 'push-hinweis' }, pushHinweis)] : []),
            ...teileInAbschnitte(mitglieder).flatMap(a => [
                h('div', { class: 'abschnitt trenner', 'data-testid': `abschnitt-${a.id}` }, a.titel, h('span', {}, String(a.eintraege.length))),
                ...a.eintraege.map(t => kachel(t, speicher, zeichne, { href: poolLink(t) }))
            ]));
    }
    await lade();
    if (!beendet) timer = starteAktualisierung(lade, 10000);
}
