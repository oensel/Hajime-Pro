// Gemeinsame Teilnehmerliste für Pool- und Vereinsansicht: lädt, zeichnet Kacheln, meldet Fehler.
import { h, kachel, speicherFuer, zeigeTabs } from './ui.js';

const inhalt = () => document.getElementById('inhalt');

// ladeFunktion() → { titel, teilnehmer }; kopfBauer(daten, speicher, neuZeichnen) → Array zusätzlicher Elemente unter der Überschrift.
export async function zeigeListe(key, reiter, ladeFunktion, kopfBauer = null) {
    zeigeTabs(key, reiter);
    const speicher = speicherFuer(key);
    async function zeichne() {
        let daten;
        try { daten = await ladeFunktion(); } catch (f) {
            inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
            return;
        }
        const liste = daten.teilnehmer;
        const kopf = [h('h1', {}, daten.titel), ...(kopfBauer ? kopfBauer(daten, speicher, zeichne) : [])];
        inhalt().replaceChildren(...kopf,
            ...(liste.length
                ? liste.map(t => kachel(t, speicher, zeichne))
                : [h('p', { class: 'hinweis' }, 'Keine Teilnehmer.')]));
    }
    await zeichne();
}
