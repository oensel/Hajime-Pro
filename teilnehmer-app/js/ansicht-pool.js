// Pool-Ansicht (Task 6 ersetzt sie durch Baum, Kämpfe und Teilnehmer): vorerst die Teilnehmerliste des Pools.
import { api } from './api.js';
import { zeigeListe } from './ansicht-liste.js';

export function zeigePool({ key, teile }) {
    return zeigeListe(key, 'pools', async () => {
        const p = await api.pool(key, teile[1]);
        const matte = p.pool.matteBezeichnung ? ` · ${p.pool.matteBezeichnung}` : '';
        return { titel: `${p.pool.bezeichnung}${matte}`, teilnehmer: p.teilnehmer };
    });
}
