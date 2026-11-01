// Reiter Turnier: das Dashboard der Halle fürs Handy (Variante B: eine Matte je Ansicht, Wechsel per Chip).
import { api } from './api.js';
import { h, icon, inhalt, setzeStatus, setzeStopp, starteAktualisierung, zeigeTabs } from './ui.js';
import { kaempferAnzeige, kampfLink, verbindung, poolStatus, poolName } from './anzeige.js';

const MERKER = 'hajime-live-meta:matte';

function paarung(k) {
    const eins = kaempferAnzeige(k.k1);
    const zwei = kaempferAnzeige(k.k2);
    return h('div', { class: 'paarung' },
        h('div', { class: `farbe ${k.farbe2 === 'rot' ? 'rot' : 'blau'}` }, zwei.name, zwei.verein && h('small', {}, zwei.verein)),
        h('div', { class: 'weiss' }, eins.name, eins.verein && h('small', {}, eins.verein)));
}

function matteKarte(key, m) {
    const teile = [h('div', { class: 'matte-kopf' }, h('span', {}, m.bezeichnung))];
    if (m.laufend) {
        teile.push(h('div', {
            class: 'laufend', 'data-testid': `laufend-${m.id}`, role: 'link', tabindex: '0',
            onclick: () => { location.hash = kampfLink(key, m.laufend); }
        }, h('span', { class: 'etikett' }, 'Laufender Kampf'), h('div', { class: 'klasse' }, poolName(m.laufend.poolBezeichnung)), paarung(m.laufend)));
    } else {
        teile.push(h('div', { class: 'laufend' }, h('span', { class: 'etikett' }, 'Pause'), h('div', { class: 'klasse' }, 'Kein aktiver Kampf')));
    }
    teile.push(h('div', { class: 'abschnitt' }, 'Als Nächstes'));
    if (m.naechste.length) {
        m.naechste.forEach((k, i) => teile.push(h('div', {
            class: 'naechster', 'data-testid': `naechster-${k.id}`, onclick: () => { location.hash = kampfLink(key, k); }
        }, h('span', { class: 'nr' }, String(i + 1)),
            h('span', { class: 'namen' },
                h('span', { class: `chip ${k.farbe2 === 'rot' ? 'rot' : 'blau'}`, title: k.farbe2 === 'rot' ? 'Rot' : 'Blau' }, kaempferAnzeige(k.k2).name),
                h('span', { class: 'chip weiss', title: 'Weiß' }, kaempferAnzeige(k.k1).name)),
            h('em', {}, poolName(k.poolBezeichnung)))));
    } else teile.push(h('p', { class: 'hinweis' }, 'Keine anstehenden Kämpfe.'));
    teile.push(h('div', { class: 'abschnitt' }, 'Pools und Fortschritt'));
    if (m.pools.length) {
        m.pools.forEach(p => {
            const s = poolStatus(p);
            const anteil = p.gesamt ? Math.round((p.beendet / p.gesamt) * 100) : 0;
            teile.push(h('a', { class: 'fortschritt', href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/baum`, style: 'display:block;color:inherit;text-decoration:none' },
                h('div', { class: 'zeile' }, h('span', {}, poolName(p.bezeichnung)), h('span', {}, s.text)),
                h('div', { class: 'balken' }, h('i', { class: s.art === 'fertig' ? 'fertig' : '', style: `width:${anteil}%` }))));
        });
    } else teile.push(h('p', { class: 'hinweis' }, 'Keine Pools zugeordnet.'));
    return h('div', { class: 'matte-karte', 'data-testid': `matte-karte-${m.id}` }, teile);
}

export async function zeigeTurnier({ key, teile }) {
    zeigeTabs(key, 'turnier');
    let auswahl = teile[1] || null;
    if (!auswahl) { try { auswahl = localStorage.getItem(`${MERKER}:${key}`); } catch { /* ohne Speicher */ } }
    let letzte = null;
    let timer = null;
    let beendet = false;
    const stoppeTimer = () => { beendet = true; if (timer) { timer(); timer = null; } };
    setzeStopp(stoppeTimer);

    async function lade() {
        let antwort;
        let ausCache = false;
        try { antwort = await api.dashboard(key); letzte = antwort; } catch (f) {
            if (f.status === 404) {
                stoppeTimer();
                inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Das Turnier ist nicht mehr verfügbar.'));
                setzeStatus('');
                return;
            }
            antwort = letzte;
            ausCache = true;
        }
        if (beendet) return;
        if (!antwort) { inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Keine Verbindung.')); setzeStatus('Keine Verbindung', true); return; }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        if (!antwort.matten.length) {
            inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Noch keine Matten oder Kampfdaten von der Halle.'));
            return;
        }
        const gueltig = auswahl === 'alle' || antwort.matten.some(m => String(m.id) === String(auswahl));
        const aktiv = gueltig && auswahl ? String(auswahl) : String(antwort.matten[0].id);
        const sichtbar = aktiv === 'alle' ? antwort.matten : antwort.matten.filter(m => String(m.id) === aktiv);
        const chip = (id, titel) => h('button', {
            type: 'button', class: `chip${aktiv === String(id) ? ' an' : ''}`, 'data-testid': `matte-${id}`,
            onclick: () => { auswahl = String(id); try { localStorage.setItem(`${MERKER}:${key}`, auswahl); } catch { /* ohne Speicher */ } lade(); }
        }, titel);
        inhalt().replaceChildren(
            h('h1', {}, 'Turnier'),
            h('div', { class: 'chips', style: 'padding:0 0 10px' }, chip('alle', 'Alle Matten'), ...antwort.matten.map(m => chip(m.id, m.bezeichnung))),
            ...sichtbar.map(m => matteKarte(key, m)),
            ...(antwort.warteschlange.length ? [
                h('div', { class: 'abschnitt' }, 'Warteschlange ohne Matte'),
                h('div', { class: 'chips', style: 'padding:0' }, antwort.warteschlange.map(p => h('a', {
                    class: 'chip', href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/teilnehmer`
                }, poolName(p.bezeichnung))))
            ] : []));
    }
    await lade();
    if (!beendet) timer = starteAktualisierung(lade, 5000);
}
