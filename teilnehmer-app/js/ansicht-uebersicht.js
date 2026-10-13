// Übersicht der verfolgten Teilnehmer nach Dringlichkeit. Offline: letzter gemerkter Stand.
import { api } from './api.js';
import { verbindung } from './anzeige.js';
import { glockeAlleKnopf, h, icon, inhalt, kachel, setzeStatus, setzeStopp, speicherFuer, zeigeTabs } from './ui.js';
import { gruppiereUebersicht } from './uebersicht.js';
import { aktuellerPushHinweis } from './push.js';

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
        const pushHinweis = aktuellerPushHinweis(speicher);
        const zeichneKachel = (t) => kachel(t, speicher, lade, {
            href: t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null
        });
        const { gruppen } = gruppiereUebersicht(antwort.teilnehmer, { ...anfrage, abgewaehlt: speicher.abgewaehlt() });
        // Ein einziger verfolgter Verein: kein Vereinsname, die Glocke für alle sitzt rechts in der Überschriftenzeile.
        const vereinsGruppen = gruppen.filter(g => g.id === 'verein');
        const einzigerVerein = vereinsGruppen.length === 1 ? vereinsGruppen[0] : null;
        const glocke = (g) => glockeAlleKnopf(
            g.eintraege.every(t => speicher.hatGlocke(t.key, g.vereinKey)),
            (an) => { speicher.vereinGlockeAlle(g.vereinKey, an); lade(); });
        inhalt().replaceChildren(
            h('h1', { class: 'mit-aktionen' }, h('span', {}, 'Übersicht'), einzigerVerein ? glocke(einzigerVerein) : null),
            ...(pushHinweis ? [h('p', { class: 'hinweis push-hinweis', 'data-testid': 'push-hinweis' }, pushHinweis)] : []),
            ...gruppen.map(g => h('div', { 'data-testid': g.id === 'verein' ? `gruppe-verein-${g.vereinKey}` : `gruppe-${g.id}` },
                g.id === 'verein' && g === einzigerVerein ? null
                    : h('div', { class: 'abschnitt' }, g.titel, g.id === 'verein' ? glocke(g) : null),
                ...(g.abschnitte && g.abschnitte.length > 1
                    ? g.abschnitte.flatMap(a => [h('div', { class: 'abschnitt trenner', 'data-testid': `abschnitt-${g.vereinKey}-${a.id}` }, a.titel), ...a.eintraege.map(zeichneKachel)])
                    : g.eintraege.map(zeichneKachel)))),
            ...(gruppen.length ? [] : [h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.')]));
    }
    await lade();
    if (!beendet) timer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}
