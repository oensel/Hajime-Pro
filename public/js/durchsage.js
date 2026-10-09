// Live-Durchsage: Strg gedrückt halten, ins Mikrofon sprechen, die Stimme kommt am Audioausgang des Hallen-Servers heraus
// (Server: src/durchsage/). Mono-PCM, 16 kHz, 16 Bit, in 20-ms-Blöcken über den WebSocket /api/durchsage.
const statusText = document.getElementById('durchsageStatus');

const RATE = 16000;
const MIKRO_OFFEN_MS = 30000; // nach dem Loslassen bleibt das Mikrofon kurz offen, damit der nächste Druck nichts abschneidet

const WORKLET = `
class Erfasser extends AudioWorkletProcessor {
    constructor() { super(); this.puffer = new Int16Array(320); this.fuell = 0; }
    process(eingaben) {
        const kanal = eingaben[0] && eingaben[0][0];
        if (!kanal) return true;
        for (let i = 0; i < kanal.length; i++) {
            const s = Math.max(-1, Math.min(1, kanal[i]));
            this.puffer[this.fuell++] = s < 0 ? s * 0x8000 : s * 0x7fff;
            if (this.fuell === this.puffer.length) {
                const block = this.puffer.slice();
                this.port.postMessage(block.buffer, [block.buffer]);
                this.fuell = 0;
            }
        }
        return true;
    }
}
registerProcessor('erfasser', Erfasser);
`;

let mikro = null;       // { stream, ctx, knoten, abschaltTimer }
let verbindung = null;  // WebSocket der laufenden Durchsage
let phase = 'bereit';   // bereit | verbinde | sendet | gesperrt
let gedrueckt = false;  // Knopf ist (noch) unten
let wartend = [];       // PCM-Blöcke, bis der Server 'bereit' meldet
let gesendetBytes = 0;

function zeige(text, fehler = false) {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.style.color = fehler ? '#ff8a80' : '';
    statusText.classList.toggle('durchsage-aktiv', phase === 'sendet' || phase === 'verbinde');
}

// Die Statuszeile zeigt nur Sendezustand und Fehler; im Bereitschaftszustand bleibt sie leer (die Taste steht in der Hotkey-Legende).
function setzePhase(neu, text, fehler = false) {
    phase = neu;
    if (statusText) statusText.dataset.phase = neu;
    zeige(text || '', fehler);
}

async function holeStatus() {
    try {
        const r = await fetch('/api/durchsage/status', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        return await r.json();
    } catch {
        return { verfuegbar: false, grund: 'Server nicht erreichbar.' };
    }
}

async function pruefeStatus() {
    if (phase === 'sendet' || phase === 'verbinde') return;
    const st = await holeStatus();
    if (!st.verfuegbar) setzePhase('gesperrt', `🎙 Durchsage nicht verfügbar: ${st.grund || 'unbekannter Grund'}`, true);
    else if (phase === 'gesperrt' || !statusText.dataset.phase) setzePhase('bereit', st.besetzt ? 'Es spricht gerade jemand.' : '');
}

async function oeffneMikro() {
    if (mikro) { clearTimeout(mikro.abschaltTimer); mikro.abschaltTimer = null; return mikro; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const quelle = ctx.createMediaStreamSource(stream);
    const knoten = new AudioWorkletNode(ctx, 'erfasser');
    knoten.port.onmessage = (e) => blockErfasst(e.data);
    quelle.connect(knoten); // kein Anschluss an ctx.destination: nichts wird lokal wiedergegeben
    mikro = { stream, ctx, knoten, abschaltTimer: null };
    return mikro;
}

function schliesseMikro() {
    if (!mikro) return;
    const m = mikro;
    mikro = null;
    m.stream.getTracks().forEach(t => t.stop());
    m.ctx.close().catch(() => {});
}

function blockErfasst(buffer) {
    if (!gedrueckt && phase !== 'sendet') return;
    if (phase === 'sendet' && verbindung?.readyState === WebSocket.OPEN) {
        verbindung.send(buffer);
        gesendetBytes += buffer.byteLength;
    } else if (phase === 'verbinde') {
        wartend.push(buffer);
        if (wartend.length > 100) wartend.shift(); // höchstens ~2 s Vorlauf
    }
}

function beendeVerbindung() {
    const v = verbindung;
    verbindung = null;
    wartend = [];
    if (v && v.readyState === WebSocket.OPEN) { try { v.send(JSON.stringify({ t: 'ende' })); } catch { /* weg */ } }
    if (v) setTimeout(() => { try { v.close(); } catch { /* weg */ } }, 150);
}

async function starten() {
    if (phase !== 'bereit' || gedrueckt) return;
    gedrueckt = true;
    gesendetBytes = 0;
    wartend = [];
    setzePhase('verbinde', 'Verbinde …');
    try {
        await oeffneMikro();
    } catch (e) {
        gedrueckt = false;
        const verweigert = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setzePhase('bereit', verweigert ? 'Kein Mikrofon-Zugriff (Berechtigung erteilen).' : `Mikrofon nicht nutzbar (${e?.name || e}).`, true);
        return;
    }
    if (!gedrueckt) { setzePhase('bereit', ''); planeMikroAus(); return; } // schon wieder losgelassen

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/durchsage`);
    verbindung = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'start' }));
    ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data);
        if (m.t === 'bereit') {
            if (!gedrueckt) { beendeVerbindung(); setzePhase('bereit', ''); return; }
            phase = 'sendet';
            zeige('Sendet … (Taste halten)');
            wartend.forEach(b => ws.send(b));
            wartend = [];
        } else if (m.t === 'fehler' || m.t === 'ende') {
            ende(m.grund || '', m.t === 'fehler');
        }
    };
    ws.onerror = () => { if (verbindung === ws && phase === 'verbinde') ende('Server nicht erreichbar.', true); };
    ws.onclose = () => { if (verbindung === ws) ende(phase === 'sendet' ? 'Verbindung unterbrochen.' : '', phase === 'sendet'); };
}

// Beendet die Durchsage (loslassen oder Server-Meldung).
function ende(grund = '', fehler = false) {
    gedrueckt = false;
    beendeVerbindung();
    planeMikroAus();
    setzePhase('bereit', grund, fehler);
    if (fehler) pruefeStatus();
}

function planeMikroAus() {
    if (!mikro) return;
    clearTimeout(mikro.abschaltTimer);
    mikro.abschaltTimer = setTimeout(schliesseMikro, MIKRO_OFFEN_MS);
}

function loslassen() {
    if (!gedrueckt) return;
    gedrueckt = false;
    if (phase === 'sendet' || phase === 'verbinde') ende('');
}

if (statusText) {
    // Strg (links oder rechts) als Sprechtaste: halten = senden, loslassen = Ende. Tastatur-Wiederholung wird ignoriert.
    document.addEventListener('keydown', (e) => { if (e.key === 'Control' && !e.repeat) starten(); });
    document.addEventListener('keyup', (e) => { if (e.key === 'Control') loslassen(); });
    window.addEventListener('blur', loslassen);
    document.addEventListener('visibilitychange', () => { if (document.hidden) loslassen(); });
    window.addEventListener('pagehide', () => { loslassen(); schliesseMikro(); });

    if (!navigator.mediaDevices?.getUserMedia) {
        setzePhase('gesperrt', '🎙 Durchsage nicht verfügbar: Mikrofon nur über localhost oder HTTPS.', true);
    } else {
        pruefeStatus();
        setInterval(pruefeStatus, 15000);
    }
}
