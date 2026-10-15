// Hajime Live: Hash-Router. Die Ansichten liegen in ansicht-*.js; jede exportiert eine Funktion (kontext) → Promise.
// Routen: #/ Turniere · #/t/<k> Suche · #/t/<k>/uebersicht · #/t/<k>/verein/<vk> · #/t/<k>/pool/<poolId>
import { zeigeTabs, setzeStatus, rufeStopp } from './ui.js';
import { zeigeTurniere, zeigeStart } from './ansicht-start.js';
import { zeigeVerein } from './ansicht-verein.js';
import { zeigeUebersicht } from './ansicht-uebersicht.js';
import { zeigePool } from './ansicht-pool.js';
import { zeigePools } from './ansicht-pools.js';
import { zeigeTurnier } from './ansicht-turnier.js';
import { zeigeMannschaft, zeigeMannschaftsPool } from './ansicht-mannschaft.js';

const ROUTEN = {
    suche: zeigeStart,
    uebersicht: zeigeUebersicht,
    verein: zeigeVerein,
    pool: zeigePool,
    pools: zeigePools,
    turnier: zeigeTurnier,
    mannschaft: zeigeMannschaft,
    mannschaftspool: zeigeMannschaftsPool
};

async function route() {
    rufeStopp();
    let teile;
    try {
        teile = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
        teile = [];
    }
    if (teile[0] !== 't' || !teile[1]) { zeigeTabs(null); setzeStatus(''); return zeigeTurniere(); }
    const kontext = { key: teile[1], teile: teile.slice(2) };
    const ansicht = kontext.teile[0] || 'suche';
    return (ROUTEN[ansicht] || zeigeStart)(kontext);
}

window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
