// Leitet http://<name>.local/... (Port 80) auf den eigentlichen Port weiter, damit Helfer
// "turnier.local/download" ohne Portangabe öffnen können. Fehlen die Rechte für Port 80 (Linux ohne
// CAP_NET_BIND_SERVICE) oder ist er belegt, wird das nur geloggt — alles läuft weiter unter :PORT.
import http from 'http';

export function starteWeiterleitung({ zielPort }) {
    const server = http.createServer((req, res) => {
        const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
        res.writeHead(302, { Location: `http://${host}:${zielPort}${req.url}` });
        res.end();
    });
    server.on('error', (err) => console.warn(`[Port 80] Weiterleitung nicht aktiv (${err.code || err.message}) – erreichbar unter :${zielPort}.`));
    server.listen(80);
    return { stoppe: () => server.close() };
}
