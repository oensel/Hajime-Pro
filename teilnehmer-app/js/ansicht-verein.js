// Vereinsansicht: Verein verfolgen (deutlich abgesetzter Knopf), "Glocke für alle", Teilnehmer nach Pools gruppiert.
import { api } from './api.js';
import { h, icon, inhalt, kachel, setzeStatus, speicherFuer, zeigeTabs } from './ui.js';

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
        const nachPool = new Map();
        for (const t of mitglieder) {
            const id = t.poolId == null ? 'ohne' : String(t.poolId);
            if (!nachPool.has(id)) nachPool.set(id, { titel: t.poolBezeichnung || 'Noch nicht eingeteilt', matte: t.matteBezeichnung, eintraege: [] });
            nachPool.get(id).eintraege.push(t);
        }
        const kopf = h('div', { class: 'verein-kopf' },
            gesternt
                ? h('button', {
                    class: 'knopf leise', type: 'button', 'data-testid': 'verein-stern', 'aria-pressed': 'true',
                    onclick: () => { speicher.vereinStern(vereinKey, false); zeichne(); }
                }, icon('star'), 'Verein wird verfolgt')
                : h('button', {
                    class: 'knopf', type: 'button', 'data-testid': 'verein-stern', 'aria-pressed': 'false',
                    onclick: () => { speicher.vereinStern(vereinKey, true); zeichne(); }
                }, icon('star_border'), 'Verein verfolgen'),
            gesternt ? h('label', { class: 'schalter' }, 'Glocke für alle', h('input', {
                type: 'checkbox', 'data-testid': 'verein-glocke-alle',
                checked: mitglieder.length > 0 && mitglieder.every(t => speicher.hatGlocke(t.key, vereinKey)),
                onchange: (e) => { speicher.vereinGlockeAlle(vereinKey, e.target.checked); zeichne(); }
            })) : null);
        inhalt().replaceChildren(
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}` }, icon('chevron_left'), 'Zurück'),
            h('h1', {}, name, h('small', {}, `${mitglieder.length} Teilnehmer`)),
            kopf,
            ...[...nachPool.values()].flatMap(g => [
                h('div', { class: 'abschnitt' }, g.titel, h('span', {}, g.matte || '')),
                ...g.eintraege.map(t => kachel(t, speicher, zeichne, { href: poolLink(t) }))
            ]));
    }
    zeichne();
}
