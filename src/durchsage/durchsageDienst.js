// Live-Durchsage: WebSocket /api/durchsage. Der Browser (Scoreboard) schickt {t:'start'}, dann binäre PCM-Blöcke
// (16 kHz, 16 Bit, Mono), am Ende {t:'ende'}. Der Server spielt sie über audioAusgabe.js ab. Ein Client-Knoten
// (Desktop) leitet den WebSocket an den Hallen-Server weiter und setzt dabei SYNC_SECRET ein.
import { WebSocketServer, WebSocket } from 'ws';

export const DURCHSAGE_PFAD = '/api/durchsage';

function sende(ws, objekt) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(objekt));
}

// Sprecherdienst des Servers: genau ein Sprecher gleichzeitig, Zeitlimit, Ende bei Verbindungsabbruch.
export function erzeugeDurchsageDienst({ ausgabe, darfSenden = () => true, maxSekunden = 60 }) {
    let sprecher = null; // { ws, out, timer }

    function beende(grund) {
        if (!sprecher) return;
        const s = sprecher;
        sprecher = null;
        clearTimeout(s.timer);
        s.out.schliesse();
        if (grund) sende(s.ws, { t: 'ende', grund });
    }

    function start(ws) {
        if (sprecher && sprecher.ws === ws) return;
        if (!darfSenden()) return sende(ws, { t: 'fehler', grund: 'Dieser Server ist nur Secondary – Durchsagen sind nur am Master möglich.' });
        if (sprecher) return sende(ws, { t: 'fehler', grund: 'Es spricht gerade jemand anderes (besetzt).' });
        const st = ausgabe.status();
        if (!st.verfuegbar) return sende(ws, { t: 'fehler', grund: st.grund });
        let out;
        try {
            out = ausgabe.oeffne({ onEnde: (grund) => { if (sprecher && sprecher.out === out) beende(grund); } });
        } catch (e) {
            return sende(ws, { t: 'fehler', grund: e.message });
        }
        sprecher = { ws, out, timer: setTimeout(() => beende('Zeitlimit erreicht'), maxSekunden * 1000) };
        sende(ws, { t: 'bereit' });
    }

    return {
        status() {
            const st = ausgabe.status();
            const master = darfSenden();
            return {
                verfuegbar: st.verfuegbar && master,
                grund: !master ? 'Dieser Server ist nur Secondary.' : st.grund,
                besetzt: sprecher !== null
            };
        },
        verbinde(ws) {
            ws.on('message', (daten, istBinaer) => {
                if (istBinaer) {
                    if (sprecher && sprecher.ws === ws) sprecher.out.schreibe(daten);
                    return;
                }
                let m;
                try { m = JSON.parse(daten.toString()); } catch { return; }
                if (m.t === 'start') start(ws);
                else if (m.t === 'ende' && sprecher && sprecher.ws === ws) beende(null);
            });
            ws.on('close', () => { if (sprecher && sprecher.ws === ws) beende(null); });
            ws.on('error', () => { if (sprecher && sprecher.ws === ws) beende(null); });
        },
        beendeAlles() { beende(null); }
    };
}

// Client-Knoten: reicht den WebSocket des Browsers an den Hallen-Server weiter.
// `pfad` mit Query (z. B. '/api/video/live?matte=3') erlaubt, andere Dienste (Video) nutzen dieselbe Weiterleitung.
export function verbindeAlsProxy(browserWs, { serverUrl, secret, pfad = DURCHSAGE_PFAD }) {
    const ziel = new WebSocket(serverUrl.replace(/^http/, 'ws') + pfad, {
        headers: secret ? { 'x-hajime-sync-secret': secret } : {}
    });
    const wartend = [];
    let offen = false;
    ziel.on('open', () => { offen = true; wartend.forEach(([d, b]) => ziel.send(d, { binary: b })); wartend.length = 0; });
    // Text- und Binärnachrichten werden unverändert zum Browser durchgereicht (Video-Live schickt beides).
    ziel.on('message', (d, istBinaer) => { if (browserWs.readyState === WebSocket.OPEN) browserWs.send(istBinaer ? d : d.toString()); });
    ziel.on('error', () => sende(browserWs, { t: 'fehler', grund: 'Hallen-Server nicht erreichbar.' }));
    ziel.on('close', () => { if (browserWs.readyState === WebSocket.OPEN) browserWs.close(); });
    browserWs.on('message', (d, istBinaer) => {
        if (offen) ziel.send(d, { binary: istBinaer });
        else if (ziel.readyState === WebSocket.CONNECTING) wartend.push([d, istBinaer]);
    });
    browserWs.on('close', () => { if (ziel.readyState <= WebSocket.OPEN) ziel.close(); });
    browserWs.on('error', () => { if (ziel.readyState <= WebSocket.OPEN) ziel.close(); });
}

// Zugriffsregel wie bei /db: Browser der eigenen Seite (Sec-Fetch-Site: same-origin) sind ausgenommen, alle anderen
// brauchen SYNC_SECRET (Header, für Tests/Werkzeuge auch ?secret=). Ohne konfiguriertes Secret ist der Zugriff offen.
export function istErlaubt(req, secret) {
    if (!secret) return true;
    if (req.headers['sec-fetch-site'] === 'same-origin') return true;
    // WebSocket-Handshakes tragen nicht überall Sec-Fetch-Site: Origin == Host heißt, die Seite stammt von diesem Server.
    try { if (req.headers.origin && new URL(req.headers.origin).host === req.headers.host) return true; } catch { /* ungültiger Origin */ }
    const url = new URL(req.url, 'http://x');
    return req.headers['x-hajime-sync-secret'] === secret || url.searchParams.get('secret') === secret;
}

// Hängt einen WebSocket-Pfad an den HTTP-Server. `verbinde(ws, req)` bekommt jede angenommene Verbindung (req für die Query).
// Der Zugriff folgt istErlaubt(); andere Pfade lässt der Handler unberührt (mehrere Dienste hängen am selben Server).
export function haengeWebSocketAn(httpServer, { pfad, verbinde, secret = () => '', maxPayload = 64 * 1024 }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload });
    httpServer.on('upgrade', (req, socket, head) => {
        if (new URL(req.url, 'http://x').pathname !== pfad) return;
        if (!istErlaubt(req, secret())) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => verbinde(ws, req));
    });
    return wss;
}

export function haengeDurchsageAn(httpServer, { verbinde, secret = () => '' }) {
    return haengeWebSocketAn(httpServer, { pfad: DURCHSAGE_PFAD, verbinde, secret });
}
