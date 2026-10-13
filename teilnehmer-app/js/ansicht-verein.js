// Vereinsansicht (Task 8 baut den Folgen-Knopf um): alle Teilnehmer des Vereins, Stern für den ganzen Verein.
import { api } from './api.js';
import { zeigeListe } from './ansicht-liste.js';
import { h } from './ui.js';

export function zeigeVerein({ key, teile }) {
    const vereinKey = teile[1];
    return zeigeListe(key, 'suche', async () => {
        const [turnier, v] = await Promise.all([api.turnier(key), api.verein(key, vereinKey)]);
        const name = turnier.vereine.find(x => x.key === vereinKey)?.name || 'Verein';
        return { titel: name, teilnehmer: v.teilnehmer };
    }, ({ teilnehmer }, speicher, zeichne) => {
        const gesternt = speicher.vereinGesternt(vereinKey);
        return [h('div', { class: 'verein-leiste' },
            h('button', {
                class: 'icon-knopf', 'data-testid': 'verein-stern', 'aria-pressed': String(gesternt),
                'aria-label': gesternt ? 'Verein nicht mehr verfolgen' : 'Ganzen Verein verfolgen',
                onclick: () => { speicher.vereinStern(vereinKey, !gesternt); zeichne(); }
            }, gesternt ? '★' : '☆'),
            gesternt && h('label', {}, h('input', {
                type: 'checkbox', 'data-testid': 'verein-glocke-alle',
                checked: teilnehmer.length > 0 && teilnehmer.every(t => speicher.hatGlocke(t.key, vereinKey)),
                onchange: (e) => { speicher.vereinGlockeAlle(vereinKey, e.target.checked); zeichne(); }
            }), ' Glocke für alle'))];
    });
}
