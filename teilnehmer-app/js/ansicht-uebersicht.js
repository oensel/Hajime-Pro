// Übersicht der verfolgten Teilnehmer nach Dringlichkeit. Offline: letzter gemerkter Stand.
import { api } from './api.js';
import { verbindung } from './anzeige.js';
import { h, icon, inhalt, kachel, setzeStatus, setzeStopp, speicherFuer, zeigeTabs } from './ui.js';
import { gruppiereUebersicht } from './uebersicht.js';

export async function zeigeUebersicht({ key }) {
    zeigeTabs(key, 'uebersicht');
    const speicher = speicherFuer(key);
    const cacheName = `hajime-live:cache:${key}`;
    let timer = null;
    let beendet = false;
    const stoppe = () => { beendet = true; if (timer) { clearInterval(timer); timer = null; } };
    setzeStopp(stoppe);

    async function lade() {
        const anfrage = speicher.anfrage();
        if (!anfrage.teilnehmer.length && !anfrage.vereine.length) {
            inhalt().replaceChildren(h('h1', {}, 'Übersicht'),
                h('div', { class: 'leer' }, icon('star_border'), 'Noch niemand verfolgt.', h('br'),
                    'Suche einen Teilnehmer oder wähle einen Verein und setze den Stern.',
                    h('div', { style: 'margin-top:16px' }, h('a', { class: 'knopf', href: `#/t/${encodeURIComponent(key)}` }, 'Teilnehmer suchen'))));
            setzeStatus('');
            return;
        }
        let antwort;
        let ausCache = false;
        try {
            antwort = await api.uebersicht(key, anfrage);
            try { localStorage.setItem(cacheName, JSON.stringify(antwort)); } catch { /* ohne Speicher */ }
        } catch (f) {
            if (f.status === 404) {
                // Die Cloud kennt das Turnier nicht mehr (Freigabe zurückgenommen): keine alten Namen weiter anzeigen.
                stoppe();
                try { localStorage.removeItem(cacheName); } catch { /* ohne Speicher */ }
                inhalt().replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Das Turnier ist nicht mehr verfügbar.'));
                setzeStatus('');
                return;
            }
            try { antwort = JSON.parse(localStorage.getItem(cacheName)); } catch { antwort = null; }
            ausCache = true;
        }
        if (beendet) return;
        if (!antwort) {
            inhalt().replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Keine Verbindung.'));
            setzeStatus('Keine Verbindung', true);
            return;
        }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        const { gruppen } = gruppiereUebersicht(antwort.teilnehmer, anfrage);
        inhalt().replaceChildren(
            h('h1', {}, 'Übersicht'),
            ...gruppen.flatMap(g => [
                h('div', { class: 'abschnitt', 'data-testid': g.id === 'verein' ? `gruppe-verein-${g.vereinKey}` : `gruppe-${g.id}` },
                    g.titel,
                    g.id === 'verein' ? h('label', { style: 'display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:12px' },
                        'Glocke für alle',
                        h('input', {
                            type: 'checkbox', checked: g.eintraege.every(t => speicher.hatGlocke(t.key, g.vereinKey)),
                            onchange: (e) => { speicher.vereinGlockeAlle(g.vereinKey, e.target.checked); lade(); }
                        })) : null),
                ...g.eintraege.map(t => kachel(t, speicher, lade, {
                    href: t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null
                }))
            ]),
            gruppen.length ? null : h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.'));
    }
    await lade();
    if (!beendet) timer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}
