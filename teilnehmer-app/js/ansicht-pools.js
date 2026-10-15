// Reiter Pools: alle Einzel-Pools mit Matte, Status und Fortschritt, filterbar nach Matte.
import { api } from './api.js';
import { h, inhalt, setzeStatus, zeigeTabs } from './ui.js';
import { poolStatus, gewichtText, klassenTitel } from './anzeige.js';

// Umschalter Einzel | Mannschaften: nur, wenn das Turnier wirklich beides hat.
function umschalter(key, aktiv) {
    return h('div', { class: 'segment', 'data-testid': 'pools-umschalter' },
        h('a', { href: `#/t/${encodeURIComponent(key)}/pools/einzel`, class: aktiv === 'einzel' ? 'aktiv' : '' }, 'Einzel'),
        h('a', { href: `#/t/${encodeURIComponent(key)}/pools/mannschaften`, class: aktiv === 'mannschaften' ? 'aktiv' : '' }, 'Mannschaften'));
}

async function zeigeMannschaftsListe(key, kopf) {
    let antwort;
    try { antwort = await api.mannschaften(key); } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    setzeStatus('');
    inhalt().replaceChildren(h('h1', {}, 'Pools'), ...(kopf ? [kopf] : []),
        ...(antwort.pools.length ? antwort.pools.map(p => {
            const s = poolStatus(p);
            const anteil = p.gesamt ? Math.round((p.beendet / p.gesamt) * 100) : 0;
            const klasse = [p.altersklasse, { w: 'weiblich', m: 'männlich' }[p.geschlecht] || p.geschlecht].filter(Boolean).join(' ');
            return h('a', { class: 'pool-karte', 'data-testid': `mannschaftspool-${p.poolId}`, href: `#/t/${encodeURIComponent(key)}/mannschaftspool/${p.poolId}` },
                h('div', { class: 'kopfzeile' }, h('span', {}, `${klasse} · Team`), h('span', { class: `schild ${s.art}` }, s.text)),
                h('div', { class: 'fuss' }, [`${p.teams} Teams`, p.modus, p.matten.map(m => m.bezeichnung).filter(Boolean).join(', ')].filter(Boolean).join(' · ')),
                h('div', { class: 'balken' }, h('i', { class: s.art === 'fertig' ? 'fertig' : '', style: `width:${anteil}%` })));
        }) : [h('p', { class: 'hinweis' }, 'Noch keine Mannschafts-Pools von der Halle gemeldet.')]));
}

export async function zeigePools({ key, teile = [] }) {
    zeigeTabs(key, 'pools');
    // Ob es Einzel und/oder Mannschaften gibt, steht am Turnier; ohne diese Angabe gilt die Einzel-Ansicht wie bisher.
    let turnier = null;
    try { turnier = await api.turnier(key); } catch { /* weiter ohne Umschalter */ }
    const hatMannschaften = !!(turnier && turnier.hatMannschaften);
    const hatEinzel = turnier ? turnier.hatEinzel !== false : true;
    if (hatMannschaften) {
        const gewuenscht = teile[1] === 'mannschaften' ? 'mannschaften' : (teile[1] === 'einzel' ? 'einzel' : null);
        const modus = !hatEinzel ? 'mannschaften' : (gewuenscht || 'einzel');
        if (modus === 'mannschaften') {
            return zeigeMannschaftsListe(key, hatEinzel ? umschalter(key, 'mannschaften') : null);
        }
        return zeigeEinzelPools(key, umschalter(key, 'einzel'));
    }
    return zeigeEinzelPools(key, null);
}

async function zeigeEinzelPools(key, kopf) {
    let antwort;
    try { antwort = await api.pools(key); } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    setzeStatus('');
    const pools = antwort.pools;
    if (!pools.length) {
        inhalt().replaceChildren(h('h1', {}, 'Pools'), ...(kopf ? [kopf] : []), h('p', { class: 'hinweis' }, 'Noch keine Pools von der Halle gemeldet.'));
        return;
    }
    const matten = [...new Map(pools.filter(p => p.matteId != null).map(p => [p.matteId, p.matteBezeichnung])).entries()];
    let filter = 'alle';
    function zeichne() {
        const sichtbar = pools.filter(p => (filter === 'alle' ? true : filter === 'laeuft' ? p.laeuft > 0 : String(p.matteId) === filter));
        inhalt().replaceChildren(
            h('h1', {}, 'Pools'),
            ...(kopf ? [kopf] : []),
            h('div', { class: 'chips', style: 'padding:0 0 8px' }, [
                ['alle', 'Alle'], ...matten.map(([id, name]) => [String(id), name]), ['laeuft', 'Läuft']
            ].map(([id, titel]) => h('button', {
                class: `chip${filter === id ? ' an' : ''}`, type: 'button', 'data-testid': `filter-${id}`,
                onclick: () => { filter = id; zeichne(); }
            }, titel))),
            ...(sichtbar.length ? sichtbar.map(p => {
                const s = poolStatus(p);
                const anteil = p.gesamt ? Math.round((p.beendet / p.gesamt) * 100) : 0;
                return h('a', { class: 'pool-karte', 'data-testid': `pool-${p.poolId}`, href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/baum` },
                    h('div', { class: 'kopfzeile' }, h('span', {}, p.bezeichnung || `${klassenTitel(p)} ${gewichtText(p.gewichtsklasse)}`), h('span', { class: `schild ${s.art}` }, s.text)),
                    h('div', { class: 'fuss' }, [p.matteBezeichnung || 'noch keine Matte', `${p.teilnehmer} Teilnehmer`, p.modus].filter(Boolean).join(' · ')),
                    h('div', { class: 'balken' }, h('i', { class: s.art === 'fertig' ? 'fertig' : '', style: `width:${anteil}%` })));
            }) : [h('p', { class: 'hinweis' }, 'Keine Pools in dieser Auswahl.')]));
    }
    zeichne();
}
