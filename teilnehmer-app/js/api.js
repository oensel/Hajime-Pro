// Dünne Schicht über die App-API der Cloud (/api/live). Wirft bei Netzfehlern und Nicht-2xx; die Oberfläche fällt dann
// auf den zuletzt gespeicherten Stand zurück.
const BASIS = '/api/live';

async function hole(pfad, optionen = {}) {
    const antwort = await fetch(BASIS + pfad, { cache: 'no-store', ...optionen });
    if (!antwort.ok) throw Object.assign(new Error(`HTTP ${antwort.status}`), { status: antwort.status });
    return antwort.json();
}

const t = (key) => `/turniere/${encodeURIComponent(key)}`;

export const api = {
    turniere: () => hole('/turniere'),
    turnier: (key) => hole(t(key)),
    suche: (key, q) => hole(`${t(key)}/suche?q=${encodeURIComponent(q)}`),
    pool: (key, poolId) => hole(`${t(key)}/pools/${encodeURIComponent(poolId)}`),
    verein: (key, vereinKey) => hole(`${t(key)}/vereine/${encodeURIComponent(vereinKey)}`),
    uebersicht: (key, anfrage) => hole(`${t(key)}/uebersicht`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anfrage)
    })
};
