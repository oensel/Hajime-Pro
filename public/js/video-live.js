// Live-Raster der Videoaufnahmen (video-live.html): für jede Matte, auf der gerade ein Kampf aufgenommen wird, eine Kachel. Jede Kachel
// verbindet sich per WebSocket mit /api/video/live?matte=<id> und spielt die vom Server weitergereichten MediaRecorder-Blöcke per
// MediaSource ab. Wer mitten im Kampf einsteigt, bekommt zuerst den bisherigen Clip und springt dann an die Live-Kante.
const raster = document.getElementById('videoLiveRaster');
const leerEl = document.getElementById('videoLiveLeer');
const kacheln = new Map(); // matteId -> Kachel

const farbeText = (l) => (l.farbe2 === 'rot' ? 'Rot' : 'Blau');

class Kachel {
    constructor(matteId) {
        this.matteId = String(matteId);
        this.medien = null;
        this.ws = null;
        this.beendet = false;

        this.element = document.createElement('div');
        this.element.className = 'video-kachel';
        this.titel = document.createElement('div');
        this.titel.className = 'video-kachel-titel';
        this.video = document.createElement('video');
        this.video.className = 'video-kachel-bild';
        this.video.muted = true;
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.controls = true;
        this.status = document.createElement('div');
        this.status.className = 'video-seite-status';
        this.element.append(this.titel, this.video, this.status);
        this.regler = setInterval(() => this.regeln(), 500);
        this.titel.addEventListener('click', () => this.element.classList.toggle('video-kachel-gross'));
        raster.appendChild(this.element);
        this.verbinde();
    }

    zeige(text) { this.status.textContent = text; }

    neuerPlayer(mime) {
        if (!window.MediaSource || !MediaSource.isTypeSupported(mime)) {
            this.zeige(`Dieser Browser kann das Format nicht live abspielen (${mime}).`);
            return;
        }
        const ms = new MediaSource();
        const m = { ms, puffer: null, warteschlange: [], ende: false };
        this.medien = m;
        this.video.src = URL.createObjectURL(ms);
        ms.addEventListener('sourceopen', () => {
            if (this.medien !== m || m.puffer) return;
            m.puffer = ms.addSourceBuffer(mime);
            m.puffer.addEventListener('updateend', () => this.pumpe(m));
            this.pumpe(m);
        });
        this.video.play().catch(() => { /* Autoplay evtl. blockiert, Bedienelemente bleiben */ });
    }

    // Hält etwa 1–2,5 s Puffer vor der Wiedergabe: Verzögerungen im Netz (Blöcke kommen in Schüben) laufen so nicht als stehendes Bild durch.
    // Zu großer Rückstand wird mit leicht erhöhter Geschwindigkeit aufgeholt, nur bei sehr großem Rückstand (Einstieg mitten im Kampf) per Sprung.
    regeln() {
        const m = this.medien;
        if (!m || !m.puffer || !m.puffer.buffered.length) return;
        const ende = m.puffer.buffered.end(m.puffer.buffered.length - 1);
        const rueckstand = ende - this.video.currentTime;
        if (m.ende) { this.video.playbackRate = 1; return; }
        if (rueckstand > 4) { this.video.currentTime = Math.max(0, ende - 1.5); this.video.playbackRate = 1; }
        else if (rueckstand > 2.5) this.video.playbackRate = 1.1;
        else if (rueckstand < 0.6) this.video.playbackRate = 0.9;
        else this.video.playbackRate = 1;
    }

    pumpe(m) {
        if (this.medien !== m || !m.puffer || m.puffer.updating) return;
        // Alte Daten (mehr als 30 s hinter der Wiedergabe) entfernen, damit der Puffer nicht wächst.
        if (m.puffer.buffered.length && this.video.currentTime - m.puffer.buffered.start(0) > 30) {
            try { m.puffer.remove(0, this.video.currentTime - 15); return; } catch { /* weiter */ }
        }
        const block = m.warteschlange.shift();
        if (block) {
            try { m.puffer.appendBuffer(block); } catch (e) { this.zeige(`Wiedergabefehler (${e.name}).`); }
            return;
        }
        if (m.ende && m.ms.readyState === 'open') { try { m.ms.endOfStream(); } catch { /* fertig */ } }
    }

    verbinde() {
        if (this.beendet) return;
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/video/live?matte=${encodeURIComponent(this.matteId)}`);
        socket.binaryType = 'arraybuffer';
        this.ws = socket;
        socket.onmessage = (e) => {
            if (typeof e.data !== 'string') {
                if (this.medien) { this.medien.warteschlange.push(e.data); this.pumpe(this.medien); }
                return;
            }
            const m = JSON.parse(e.data);
            if (m.t === 'clip') {
                this.titel.textContent = `${m.matteName || `Matte ${m.matteId}`} · ${m.pool || ''} · ${m.kaempfer1 || ''} (Weiß) gegen ${m.kaempfer2 || ''} (${farbeText(m)})`;
                this.zeige('Live');
                this.neuerPlayer(m.mime);
            } else if (m.t === 'ende') {
                if (this.medien) { this.medien.ende = true; this.pumpe(this.medien); }
                this.zeige('Der Kampf ist beendet.');
            } else if (m.t === 'leer') {
                this.zeige('Warte auf den nächsten Kampf …');
            }
        };
        socket.onclose = () => {
            if (this.ws !== socket || this.beendet) return;
            this.zeige('Verbindung getrennt – neuer Versuch …');
            setTimeout(() => this.verbinde(), 3000);
        };
    }

    schliesse() {
        this.beendet = true;
        clearInterval(this.regler);
        try { this.ws && this.ws.close(); } catch { /* weg */ }
        this.element.remove();
    }
}

async function aktualisiere() {
    try {
        const r = await fetch('/api/video/status', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const st = await r.json();
        const ids = new Set(st.live.map(l => String(l.matteId)));
        // Kacheln für neu aufnehmende Matten anlegen, für beendete entfernen (die Kachel bleibt noch kurz mit "Der Kampf ist beendet").
        for (const id of ids) if (!kacheln.has(id)) kacheln.set(id, new Kachel(id));
        for (const [id, k] of kacheln) {
            if (!ids.has(id)) {
                k.endeZaehler = (k.endeZaehler || 0) + 1;
                if (k.endeZaehler >= 3) { k.schliesse(); kacheln.delete(id); }
            } else {
                k.endeZaehler = 0;
            }
        }
        leerEl.textContent = kacheln.size ? '' : 'Gerade wird auf keiner Matte aufgenommen. Die Ansicht füllt sich von selbst.';
    } catch {
        leerEl.textContent = 'Video ist nicht verfügbar (nur am Hallen-Server).';
    }
}

aktualisiere();
setInterval(aktualisiere, 3000);
