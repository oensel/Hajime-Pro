// Übersicht der verfolgten Teilnehmer (Task 8 gruppiert nach Dringlichkeit). Offline: letzter gemerkter Stand.
import { api } from './api.js';
import { verbindung } from './anzeige.js';
import { h, kachel, setzeStatus, setzeStopp, speicherFuer, zeigeTabs } from './ui.js';

const inhalt = () => document.getElementById('inhalt');

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
                h('p', { class: 'hinweis' }, 'Noch niemand verfolgt. Suche einen Teilnehmer und setze den Stern ☆.'));
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
        if (!antwort) {
            inhalt().replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Keine Verbindung.'));
            setzeStatus('Keine Verbindung', true);
            return;
        }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        const liste = antwort.teilnehmer;
        inhalt().replaceChildren(h('h1', {}, 'Übersicht'),
            ...(liste.length ? liste.map(t => kachel(t, speicher, lade))
                : [h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.')]));
    }
    await lade();
    if (!beendet) timer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}
