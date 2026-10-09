// Videoaufnahme für den Videoschiedsrichter (steuerung.html): Die USB-Kamera des Clients wird in ein Canvas gezeichnet (mit
// Kampf-Overlay: Zeit, Wertungen, Strafen, Haltegriff, Namen, Uhrzeit) und je Kampf als Clip aufgenommen: von "Kampf geladen" bis
// "Ergebnis senden". Jeder Clip liegt zuerst lokal (Arbeitsspeicher und IndexedDB des Browsers) und wird über den WebSocket
// /api/video zum Hallen-Server übertragen: bei bestehender Verbindung schon während der Aufnahme (Live-Ansicht am Server), sonst
// später. Nach einem Abbruch geht es an der Stelle weiter, bis zu der der Server den Clip hat; am Ende liegt dort das vollständige
// Video. Marken (START/STOPP/Ergebnis) gehen mit dem Ende des Clips mit. Während des Kampfes kann die Steuerung den bisherigen
// Stand ansehen und spulen (die Aufnahme läuft weiter). Ereignisse liefert scoreboard.js als 'hajime:kampf'.
const el = (id) => document.getElementById(id);
const aktivBox = el('videoAktiv');
if (aktivBox) starte();

function starte() {
    const kameraSelect = el('videoKamera');
    const aufloesungSelect = el('videoAufloesung');
    const statusEl = el('videoStatus');
    const vorschau = el('videoVorschau');
    const ctx = vorschau.getContext('2d');

    const AUFLOESUNGEN = { 480: [854, 480, 1.2e6], 720: [1280, 720, 2.5e6], 1080: [1920, 1080, 5e6] };
    const MIME_KANDIDATEN = ['video/webm;codecs=vp8', 'video/webm;codecs=h264', 'video/webm', 'video/mp4'];
    const SPEICHER_KEY = 'hajimeVideoEinstellungen';
    const MAX_CLIP_MS = 45 * 60 * 1000;
    const WIEDERHOLUNG_MS = 15000;

    let einst = { aktiv: false, kamera: '', aufloesung: '720' };
    try { einst = { ...einst, ...JSON.parse(localStorage.getItem(SPEICHER_KEY) || '{}') }; } catch { /* Standardwerte */ }
    const speichereEinst = () => { try { localStorage.setItem(SPEICHER_KEY, JSON.stringify(einst)); } catch { /* ohne Speicher */ } };

    let stream = null;          // Kamera
    let videoEl = null;         // verstecktes <video> für die Kamera
    let zeichenTimer = null;
    let kampf = null;           // Daten des geladenen Kampfes (für das Overlay im Bild)
    let clip = null;            // laufende Aufnahme { recorder, chunks, t0, marken, mime, meta, grenze }
    const alleClips = new Map(); // Clips, die noch nicht vollständig am Server sind (laufende und wartende), id -> Clip
    let idbOk = true;            // Zwischenspeicher im Browser verfügbar
    const UEBERTRAGUNG_PARALLEL = 2; // so viele nachgelieferte Clips gleichzeitig (der laufende Clip hat immer Vorrang)

    // Messwerte der laufenden Aufnahme (Bildrate des Canvas, Datenrate des Encoders, Rückstand der Übertragung): zeigen am echten Gerät,
    // ob es am Rechner (zu wenige Bilder), am Encoder oder am Netz liegt, wenn die Aufnahme oder das Live-Bild ruckelt.
    const messung = { bilder: 0, bytes: 0 };

    // Wirksame Farbe von Kämpfer 2 (Turnier, Pool oder Kampf): die Steuerung hält sie aktuell, sonst gilt der Wert beim Laden.
    const farbe2Name = () => (window.hajimeScoreboardState && window.hajimeScoreboardState.fighter2Color) || (kampf && kampf.farbe2) || 'blau';
    const farbe2Code = () => (farbe2Name() === 'rot' ? '#dc3545' : '#1e5bff');

    function zeige(text, fehler = false) {
        statusEl.textContent = text;
        statusEl.style.color = fehler ? '#ff8a80' : '';
    }

    // --- Kamera und Bild ---------------------------------------------------------------------------------------------
    async function fuelleKameras() {
        try {
            const geraete = (await navigator.mediaDevices.enumerateDevices()).filter(g => g.kind === 'videoinput');
            kameraSelect.replaceChildren();
            geraete.forEach((g, i) => {
                const opt = document.createElement('option');
                opt.value = g.deviceId;
                opt.textContent = g.label || `Kamera ${i + 1}`;
                kameraSelect.appendChild(opt);
            });
            if (einst.kamera && geraete.some(g => g.deviceId === einst.kamera)) kameraSelect.value = einst.kamera;
        } catch { /* Liste bleibt leer */ }
    }

    async function starteKamera() {
        stoppeKamera();
        const [breite, hoehe] = AUFLOESUNGEN[einst.aufloesung] || AUFLOESUNGEN[720];
        const video = { width: { ideal: breite }, height: { ideal: hoehe }, frameRate: { ideal: 30 } };
        if (einst.kamera) video.deviceId = { exact: einst.kamera };
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (e) {
            if (einst.kamera) { einst.kamera = ''; speichereEinst(); return starteKamera(); } // gemerkte Kamera nicht mehr da
            throw e;
        }
        await fuelleKameras();
        const spur = stream.getVideoTracks()[0];
        const id = spur && spur.getSettings().deviceId;
        if (id) kameraSelect.value = id;
        vorschau.width = breite;
        vorschau.height = hoehe;
        videoEl = document.createElement('video');
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.srcObject = stream;
        await videoEl.play();
        zeichenTimer = setInterval(zeichne, 1000 / 30);
    }

    function stoppeKamera() {
        clearInterval(zeichenTimer);
        zeichenTimer = null;
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        videoEl = null;
        ctx.clearRect(0, 0, vorschau.width, vorschau.height);
    }

    function zeichne() {
        if (!videoEl || videoEl.readyState < 2) return;
        messung.bilder++;
        const b = vorschau.width;
        const h = vorschau.height;
        ctx.drawImage(videoEl, 0, 0, b, h);
        const schrift = Math.round(h / 24);
        // Uhrzeit oben rechts: hilft, Clip und Wettkampfprotokoll abzugleichen.
        ctx.font = `bold ${schrift}px Arial, sans-serif`;
        const zeit = new Date().toLocaleTimeString('de-DE');
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(b - ctx.measureText(zeit).width - schrift, 0, ctx.measureText(zeit).width + schrift, schrift * 1.6);
        ctx.fillStyle = '#fff';
        ctx.fillText(zeit, b - ctx.measureText(zeit).width - schrift / 2, schrift * 1.15);
        if (!kampf) return;
        zeichneOverlay(b, h);
    }

    // Overlay unten im Bild: links Kämpfer 1 (Weiß), rechts Kämpfer 2 (Blau oder Rot, wie auf der Anzeigetafel), in der Mitte
    // Kampfzeit und Pool. Je Kämpfer Wertungen (Ippon/Waza-ari/Yuko) und Strafen (Shido, Behandlung) aus dem Zustand der Steuerung.
    function zeichneOverlay(b, h) {
        const st = window.hajimeScoreboardState || {};
        const basis = Math.round(h / 30);
        const leiste = basis * 5.2;
        const y0 = h - leiste;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(0, y0, b, leiste);

        const mitteBreite = b * 0.26;
        const seitenBreite = (b - mitteBreite) / 2 - basis * 2;

        const kuerze = (text, max) => {
            if (ctx.measureText(text).width <= max) return text;
            let t = text;
            while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
            return t + '…';
        };
        // Shido als gelbe Karten, Behandlung als grünes Plus (je höchstens 3 sichtbar; die Anzeigetafel kennt auch nicht mehr).
        const symbole = (links, textX, y, shido, beh) => {
            const groesse = basis * 1.1;
            const schritt = groesse * 1.4;
            const items = [...Array(Math.min(shido || 0, 3)).fill('karte'), ...Array(Math.min(beh || 0, 3)).fill('plus')];
            items.forEach((art, n) => {
                const x = links ? textX + n * schritt : textX - groesse - n * schritt;
                if (art === 'karte') {
                    ctx.fillStyle = '#ffd400';
                    ctx.fillRect(x + groesse * 0.1, y, groesse * 0.8, groesse);
                    ctx.strokeStyle = '#6b5a00';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + groesse * 0.1, y, groesse * 0.8, groesse);
                } else {
                    ctx.fillStyle = '#2ecc71';
                    const dicke = groesse * 0.32;
                    ctx.fillRect(x, y + (groesse - dicke) / 2, groesse, dicke);
                    ctx.fillRect(x + (groesse - dicke) / 2, y, dicke, groesse);
                }
            });
        };
        const seite = (links, farbe, name, i, w, y, shido, beh) => {
            const kante = links ? basis * 0.6 : b - basis * 0.6;
            const textX = links ? kante + basis * 1.5 : kante - basis * 1.5;
            ctx.textAlign = links ? 'left' : 'right';
            ctx.fillStyle = farbe;
            ctx.fillRect(links ? kante : kante - basis * 0.9, y0 + basis * 0.7, basis * 0.9, leiste - basis * 1.4);
            ctx.font = `bold ${Math.round(basis * 1.15)}px Arial, sans-serif`;
            ctx.fillStyle = '#fff';
            ctx.fillText(kuerze(name, seitenBreite), textX, y0 + basis * 1.6);
            ctx.font = `${Math.round(basis * 1.05)}px Arial, sans-serif`;
            ctx.fillText(`Ippon ${i ?? 0}   Waza-ari ${w ?? 0}   Yuko ${y ?? 0}`, textX, y0 + basis * 3.1);
            symbole(links, textX, y0 + basis * 3.55, shido, beh);
        };
        seite(true, '#ffffff', kampf.kaempfer1, st.ipponW, st.wazaW, st.yukoW, st.shidoW, st.behandlungW);
        seite(false, farbe2Code(), kampf.kaempfer2, st.ipponB, st.wazaB, st.yukoB, st.shidoB, st.behandlungB);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffc107';
        ctx.font = `bold ${Math.round(basis * 2.6)}px Arial, sans-serif`;
        ctx.fillText(`${st.isGoldenScore ? 'GS ' : ''}${st.timeString || ''}`, b / 2, y0 + basis * 2.5);
        // Haltegriff (Osaekomi): läuft mit, solange er aktiv ist bzw. bis zum Zurücksetzen; in der Farbe des haltenden Kämpfers.
        const haltW = (st.osaeW > 0 || st.osaeRunningW) ? 'W' : ((st.osaeB > 0 || st.osaeRunningB) ? 'B' : null);
        if (haltW) {
            ctx.fillStyle = haltW === 'W' ? '#ffffff' : farbe2Code();
            ctx.font = `bold ${Math.round(basis * 1.5)}px Arial, sans-serif`;
            ctx.fillText(`OSAEKOMI ${st['osae' + haltW] || 0} s`, b / 2, y0 + basis * 4.45);
        } else {
            ctx.fillStyle = '#fff';
            ctx.font = `${Math.round(basis * 0.95)}px Arial, sans-serif`;
            ctx.fillText(kuerze(kampf.pool, mitteBreite), b / 2, y0 + basis * 4.3);
        }
        ctx.textAlign = 'left';
    }

    // --- Zwischenspeicher im Browser (IndexedDB) --------------------------------------------------------------------------
    // Clips überstehen so ein Neuladen der Seite und viele offline gesammelte Clips belegen nicht den Arbeitsspeicher.
    let dbVersprechen = null;
    function db() {
        if (!dbVersprechen) {
            dbVersprechen = new Promise((ok, fehler) => {
                const r = indexedDB.open('hajime-video', 1);
                r.onupgradeneeded = () => {
                    r.result.createObjectStore('clips', { keyPath: 'id' });
                    r.result.createObjectStore('chunks', { keyPath: ['clipId', 'nr'] });
                };
                r.onsuccess = () => ok(r.result);
                r.onerror = () => fehler(r.error);
            });
        }
        return dbVersprechen;
    }
    // Führt fn(transaktion) aus; fn darf ein Promise liefern (Lesezugriffe). Ohne Zwischenspeicher liefert das null.
    async function idb(speicher, modus, fn) {
        if (!idbOk) return null;
        try {
            const d = await db();
            return await new Promise((ok, fehler) => {
                const t = d.transaction(speicher, modus);
                let ergebnis;
                t.oncomplete = () => ok(ergebnis);
                t.onerror = t.onabort = () => fehler(t.error);
                ergebnis = fn(t);
            }).then(async (ergebnis) => ergebnis);
        } catch (e) {
            if (idbOk) console.warn('Zwischenspeicher im Browser nicht verfügbar:', e);
            idbOk = false;
            return null;
        }
    }
    // Lesen: die Anfrage selbst liefern, das Ergebnis steht nach Abschluss der Transaktion bereit.
    async function idbLies(speicher, erzeuge) {
        if (!idbOk) return [];
        try {
            const d = await db();
            return await new Promise((ok, fehler) => {
                const t = d.transaction(speicher, 'readonly');
                const anfrage = erzeuge(t);
                t.oncomplete = () => ok(anfrage.result || []);
                t.onerror = t.onabort = () => fehler(t.error);
            });
        } catch (e) {
            if (idbOk) console.warn('Zwischenspeicher im Browser nicht verfügbar:', e);
            idbOk = false;
            return [];
        }
    }
    const datensatz = (c) => ({ id: c.id, status: c.abschluss ? 'fertig' : 'aufnahme', meta: c.meta, mime: c.mime, marken: c.marken, abschluss: c.abschluss, bytes: c.bytes, chunkAnzahl: c.chunks.length });
    const speichereClip = (c) => idb('clips', 'readwrite', t => { t.objectStore('clips').put(datensatz(c)); });
    const speichereChunk = (c, nr, blob) => idb('chunks', 'readwrite', t => { t.objectStore('chunks').put({ clipId: c.id, nr, blob }); });
    const loescheClipAusSpeicher = (id) => idb(['clips', 'chunks'], 'readwrite', t => {
        t.objectStore('clips').delete(id);
        t.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    });
    async function ladeChunks(c) {
        const liste = await idbLies('chunks', t => t.objectStore('chunks').getAll(IDBKeyRange.bound([c.id, 0], [c.id, Number.MAX_SAFE_INTEGER])));
        c.chunks = liste.sort((a, b) => a.nr - b.nr).map(d => d.blob);
        c.bytes = c.chunks.reduce((summe, b) => summe + b.size, 0);
        c.geladen = true;
    }

    // --- Clips ---------------------------------------------------------------------------------------------------------
    function waehleMime() {
        return MIME_KANDIDATEN.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    }

    const neueClipId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    function neuerClip(id, meta, mime) {
        return {
            id, meta, mime, chunks: [], bytes: 0, marken: [], abschluss: null, geladen: true, recorder: null, t0: performance.now(), grenze: null,
            sync: { ws: null, bereit: false, gesendet: 0, pumpt: false, fertig: false, naechsterVersuch: 0 }
        };
    }

    function marke(typ, text) {
        if (!clip) return;
        clip.marken.push({ typ, ms: Math.round(performance.now() - clip.t0), ...(text ? { text } : {}) });
        speichereClip(clip);
    }

    function beginneClip(detail) {
        if (!stream) return;
        if (clip) beendeClip('abgebrochen (neuer Kampf geladen)', { abgebrochen: true });
        kampf = { pool: detail.pool || '', kaempfer1: detail.kaempfer1 || '', kaempfer2: detail.kaempfer2 || '', farbe2: detail.farbe2 || 'blau' };
        const mime = waehleMime();
        const [, , bitrate] = AUFLOESUNGEN[einst.aufloesung] || AUFLOESUNGEN[720];
        let recorder;
        try {
            recorder = new MediaRecorder(vorschau.captureStream(30), { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrate });
        } catch (e) {
            zeige(`Aufnahme nicht möglich (${e.message}).`, true);
            return;
        }
        const id = neueClipId();
        const c = neuerClip(id, {
            clipId: id, turnierId: detail.turnierId, matteId: detail.matteId, matteName: detail.matteName, kampfId: detail.kampfId,
            pool: kampf.pool, kaempfer1: kampf.kaempfer1, kaempfer2: kampf.kaempfer2, farbe2: kampf.farbe2, beginn: new Date().toISOString()
        }, recorder.mimeType || mime || 'video/webm');
        c.recorder = recorder;
        c.meta.mime = c.mime;
        c.grenze = setTimeout(() => { if (clip === c) { marke('stopp', 'Zeitlimit'); beendeClip('abgebrochen (Zeitlimit)', { abgebrochen: true }); } }, MAX_CLIP_MS);
        clip = c;
        alleClips.set(id, c);
        recorder.ondataavailable = (e) => {
            if (!e.data || !e.data.size) return;
            c.chunks.push(e.data);
            c.bytes += e.data.size;
            messung.bytes += e.data.size;
            speichereChunk(c, c.chunks.length - 1, e.data);
            pumpe(c); // bei bestehender Verbindung geht der neue Block sofort zum Server (Live-Ansicht)
        };
        recorder.onstart = () => { c.t0 = performance.now(); marke('geladen'); if (c.pendingStart) marke('start'); };
        recorder.start(500); // kurze Blöcke: gleichmäßigerer Strom zum Server und zur Live-Ansicht
        speichereClip(c);
        plane();
        zeige(`● Aufnahme läuft: ${kampf.pool}`);
    }

    // Beendet die laufende Aufnahme. Mit hochladen (Standard) wird der Clip zum Server übertragen (oder bleibt bis dahin lokal).
    async function beendeClip(ergebnisText, { abgebrochen = false, hochladen = true } = {}) {
        if (!clip) return;
        const c = clip;
        clip = null;
        clearTimeout(c.grenze);
        const farbe2 = farbe2Name();
        const ende = new Date().toISOString();
        await new Promise((fertig) => {
            if (c.recorder.state === 'inactive') return fertig();
            c.recorder.addEventListener('stop', () => fertig(), { once: true });
            try { c.recorder.stop(); } catch { fertig(); }
        });
        if (!hochladen || !c.chunks.length) {
            verwirf(c);
            return;
        }
        c.abschluss = { marken: c.marken, ergebnis: ergebnisText || '', farbe2, ende, abgebrochen };
        await speichereClip(c);
        plane();
        pumpe(c);
    }

    function verwirf(c) {
        alleClips.delete(c.id);
        clearTimeout(c.grenze);
        if (c.sync.ws) { const w = c.sync.ws; c.sync.ws = null; try { w.close(); } catch { /* weg */ } }
        loescheClipAusSpeicher(c.id);
    }

    // --- Übertragung zum Server -------------------------------------------------------------------------------------------
    const DAUERHAFTE_FEHLER = /zu groß|leer|Matte fehlt/i;

    function verbindeClip(c) {
        const s = c.sync;
        if (s.ws || s.fertig) return;
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/video`);
        ws.binaryType = 'arraybuffer';
        s.ws = ws;
        s.bereit = false;
        ws.onopen = () => ws.send(JSON.stringify({ t: 'start', meta: { ...c.meta, live: !c.abschluss } }));
        ws.onmessage = (e) => {
            if (typeof e.data !== 'string' || s.ws !== ws) return;
            const m = JSON.parse(e.data);
            if (m.t === 'bereit') {
                s.bereit = true;
                s.gesendet = Math.min(m.empfangen || 0, c.bytes); // ab hier fehlt dem Server etwas
                pumpe(c);
            } else if (m.t === 'fehlt') {
                s.gesendet = Math.min(m.empfangen || 0, c.bytes);
                pumpe(c);
            } else if (m.t === 'fertig') {
                s.fertig = true;
                alleClips.delete(c.id);
                loescheClipAusSpeicher(c.id);
                try { ws.close(); } catch { /* weg */ }
            } else if (m.t === 'fehler') {
                const grund = m.grund || 'Fehler am Server';
                if (DAUERHAFTE_FEHLER.test(grund)) {
                    zeige(`Clip abgelehnt: ${grund}`, true);
                    if (clip !== c) verwirf(c);
                } else {
                    s.naechsterVersuch = Date.now() + 15000; // z. B. Secondary: später noch einmal
                }
                try { ws.close(); } catch { /* weg */ }
            }
            zeigeUebertragung();
        };
        ws.onclose = () => {
            if (s.ws !== ws) return;
            s.ws = null;
            s.bereit = false;
            if (!s.naechsterVersuch || s.naechsterVersuch < Date.now()) s.naechsterVersuch = Date.now() + 5000;
            zeigeUebertragung();
        };
        ws.onerror = () => { /* onclose folgt */ };
    }

    // Schickt, was dem Server noch fehlt, in Stücken; ist der Clip abgeschlossen und alles gesendet, kommt die Endmeldung.
    async function pumpe(c) {
        const s = c.sync;
        if (!s.bereit || s.pumpt || !s.ws) return;
        s.pumpt = true;
        try {
            let gesamt = new Blob(c.chunks);
            while (s.ws && s.ws.readyState === WebSocket.OPEN && s.bereit && s.gesendet < c.bytes) {
                if (s.ws.bufferedAmount > 4 * 1024 * 1024) { await new Promise(r => setTimeout(r, 100)); continue; }
                if (gesamt.size < c.bytes) gesamt = new Blob(c.chunks);
                const teil = await gesamt.slice(s.gesendet, Math.min(s.gesendet + 512 * 1024, gesamt.size)).arrayBuffer();
                if (!s.ws || s.ws.readyState !== WebSocket.OPEN || !s.bereit) break;
                s.ws.send(teil);
                s.gesendet += teil.byteLength;
            }
            if (c.abschluss && s.ws && s.ws.readyState === WebSocket.OPEN && s.bereit && s.gesendet >= c.bytes) {
                s.ws.send(JSON.stringify({ t: 'ende', groesse: c.bytes, meta: c.abschluss }));
            }
        } finally {
            s.pumpt = false;
        }
        zeigeUebertragung();
    }

    // Verbindet laufende und wartende Clips: der laufende Clip immer, nachzuliefernde höchstens UEBERTRAGUNG_PARALLEL gleichzeitig.
    async function plane() {
        const jetzt = Date.now();
        let nachlieferungen = [...alleClips.values()].filter(c => c.sync.ws && c.abschluss).length;
        for (const c of alleClips.values()) {
            const s = c.sync;
            if (s.ws || s.fertig || jetzt < s.naechsterVersuch) continue;
            if (c.abschluss) {
                if (nachlieferungen >= UEBERTRAGUNG_PARALLEL) continue;
                nachlieferungen++;
            }
            if (!c.geladen) await ladeChunks(c);
            verbindeClip(c);
        }
        zeigeUebertragung();
    }

    let aufnahmeBegonnen = false;
    function zeigeUebertragung() {
        const feld = el('videoUebertragung');
        if (!feld) return;
        const clips = [...alleClips.values()];
        const laufend = clips.find(c => !c.abschluss);
        const wartend = clips.filter(c => c.abschluss).length;
        const teile = [];
        if (laufend) teile.push(laufend.sync.bereit ? 'Live zum Server ✓' : 'Keine Verbindung zum Server – der Clip wird lokal aufgenommen und später übertragen');
        if (wartend) teile.push(`${wartend} ${wartend === 1 ? 'Clip wartet' : 'Clips warten'} auf die Übertragung`);
        if (!teile.length && aufnahmeBegonnen) teile.push('Alle Clips sind am Server gespeichert.');
        feld.textContent = teile.join(' · ');
        feld.style.color = (laufend && !laufend.sync.bereit) || wartend ? '#ffb74d' : '';
    }

    // Wird die Aufnahme eingeschaltet, während schon ein Kampf geladen ist (oder läuft), beginnt der Clip sofort für diesen Kampf.
    function beginneFuerGeladenenKampf() {
        const d = window.hajimeAktuellerKampf && window.hajimeAktuellerKampf();
        if (!d || clip || !stream) return;
        aufnahmeBegonnen = true;
        beginneClip(d);
        if (clip && window.hajimeScoreboardState && window.hajimeScoreboardState.timeRunning) clip.pendingStart = true;
    }

    window.addEventListener('hajime:kampf', (e) => {
        if (!einst.aktiv) return;
        const d = e.detail || {};
        if (d.typ === 'geladen') { aufnahmeBegonnen = true; beginneClip(d); }
        else if (d.typ === 'start') marke('start');
        else if (d.typ === 'stopp') marke('stopp');
        else if (d.typ === 'ergebnis') {
            marke('ergebnis');
            const farbe2Text = (d.farbe2 || farbe2Name()) === 'rot' ? 'Rot' : 'Blau';
            beendeClip(d.sieger === 'W' ? 'Sieger Weiß' : d.sieger === 'B' ? `Sieger ${farbe2Text}` : 'Ergebnis gesendet');
            kampf = null;
            zeige('Kamera bereit. Der nächste geladene Kampf wird aufgenommen.');
        } else if (d.typ === 'abbruch') {
            marke('stopp', 'Kampf freigegeben');
            beendeClip('Kampf freigegeben (ohne Ergebnis)', { abgebrochen: true });
            kampf = null;
        }
    });

    // --- Ansehen während des Kampfes ---------------------------------------------------------------------------------
    const panel = el('videoReview');
    const spieler = el('videoReviewPlayer');
    const markenEl = el('videoReviewMarken');
    const hinweisEl = el('videoReviewHinweis');
    let reviewUrl = null;

    async function momentaufnahme() {
        const c = clip;
        if (!c) return null;
        if (c.recorder.state === 'recording') {
            await new Promise((fertig) => {
                c.recorder.addEventListener('dataavailable', () => fertig(), { once: true });
                try { c.recorder.requestData(); } catch { fertig(); }
            });
        }
        return new Blob(c.chunks, { type: c.mime });
    }

    // Lädt den Stand in den Player. zielZeit: Sekunde oder 'ende' (kurz vor dem aktuellen Ende, damit man den letzten Moment sieht).
    function ladeInSpieler(blob, zielZeit) {
        if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        reviewUrl = URL.createObjectURL(blob);
        const setze = () => {
            const dauer = spieler.duration;
            const t = zielZeit === 'ende' ? Math.max(0, dauer - 8) : Math.min(zielZeit, dauer);
            spieler.currentTime = Number.isFinite(t) ? Math.max(0, t) : 0;
        };
        spieler.onloadedmetadata = () => {
            // MediaRecorder-Dateien haben keine Länge: einmal ans Ende springen, damit der Browser sie ermittelt und das Spulen geht.
            if (spieler.duration === Infinity) {
                spieler.ontimeupdate = () => { spieler.ontimeupdate = null; setze(); };
                spieler.currentTime = 1e101;
            } else {
                setze();
            }
        };
        spieler.src = reviewUrl;
    }

    function zeigeMarken() {
        markenEl.replaceChildren();
        const namen = { geladen: 'Kampf geladen', start: 'START', stopp: 'STOPP', ergebnis: 'Ergebnis' };
        (clip ? clip.marken : []).forEach((m) => {
            const knopf = document.createElement('button');
            knopf.type = 'button';
            knopf.className = 'video-review-knopf';
            knopf.textContent = `${namen[m.typ] || m.typ} ${Math.floor(m.ms / 60000)}:${String(Math.floor(m.ms / 1000) % 60).padStart(2, '0')}`;
            knopf.addEventListener('click', () => { spieler.currentTime = Math.max(0, m.ms / 1000 - 3); spieler.play().catch(() => {}); });
            markenEl.appendChild(knopf);
        });
    }

    async function oeffneAnsicht(zielZeit = 'ende') {
        const blob = await momentaufnahme();
        if (!blob || !blob.size) { zeige('Es gibt noch keine Aufnahme zum Ansehen.', true); return; }
        panel.hidden = false;
        hinweisEl.textContent = 'Die Aufnahme läuft im Hintergrund weiter. „Aktualisieren“ lädt den neuesten Stand.';
        zeigeMarken();
        ladeInSpieler(blob, zielZeit);
    }

    function schliesseAnsicht() {
        panel.hidden = true;
        spieler.pause();
        spieler.removeAttribute('src');
        spieler.load();
        if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        reviewUrl = null;
    }

    // Der Knopf "Video ansehen" sitzt in der eingebetteten Anzeige (oben links neben Klasse und Gewicht, siehe scoreboard.js) und
    // fragt diese beiden Funktionen ab: sichtbar nur, solange tatsächlich aufgezeichnet wird.
    window.hajimeVideoLaeuft = () => !!(clip && clip.recorder.state === 'recording');
    window.hajimeVideoAnsehen = () => oeffneAnsicht('ende');
    el('videoReviewSchliessen').addEventListener('click', schliesseAnsicht);
    el('videoReviewAktualisieren').addEventListener('click', async () => {
        const zeit = spieler.currentTime;
        const blob = await momentaufnahme();
        if (blob) { zeigeMarken(); ladeInSpieler(blob, zeit); } else { hinweisEl.textContent = 'Der Kampf ist beendet – der Clip wurde an den Server übertragen (Video-Archiv).'; }
    });
    el('videoReviewLive').addEventListener('click', async () => {
        const blob = await momentaufnahme();
        if (blob) { zeigeMarken(); ladeInSpieler(blob, 'ende'); }
    });
    panel.querySelectorAll('[data-sprung]').forEach((knopf) => knopf.addEventListener('click', () => {
        const ziel = spieler.currentTime + Number(knopf.dataset.sprung);
        spieler.currentTime = Math.max(0, Number.isFinite(spieler.duration) ? Math.min(ziel, spieler.duration) : ziel);
    }));
    el('videoReviewBildVor').addEventListener('click', () => { spieler.pause(); spieler.currentTime += 1 / 30; });
    el('videoReviewBildZurueck').addEventListener('click', () => { spieler.pause(); spieler.currentTime = Math.max(0, spieler.currentTime - 1 / 30); });
    el('videoReviewTempo').addEventListener('change', (e) => { spieler.playbackRate = Number(e.target.value); });
    spieler.addEventListener('loadeddata', () => { spieler.playbackRate = Number(el('videoReviewTempo').value); });

    // --- Bedienung und Status --------------------------------------------------------------------------------------------
    async function aktualisiereServerStatus() {
        let st;
        try {
            const r = await fetch('/api/video/status', { cache: 'no-store' });
            if (!r.ok) throw Object.assign(new Error(String(r.status)), { http: true });
            st = await r.json();
        } catch (e) {
            if (e.http) { aktivBox.disabled = true; zeige('Videoaufnahme ist hier nicht verfügbar.', true); return; }
            // Kein Netz zum Server: Aufnahme bleibt möglich, die Clips werden später übertragen.
            aktivBox.disabled = false;
            el('videoSpeicherInfo').textContent = 'Server nicht erreichbar – Clips werden lokal gesammelt und später übertragen.';
            return;
        }
        aktivBox.disabled = false;
        const frei = st.speicher && st.speicher.frei != null ? ` · frei: ${(st.speicher.frei / 1e9).toFixed(1)} GB` : '';
        const belegt = st.speicher ? ` · gespeichert: ${st.speicher.clips} Clips, ${(st.speicher.belegt / 1e9).toFixed(2)} GB` : '';
        el('videoSpeicherInfo').textContent = st.verfuegbar ? `Server${frei}${belegt}` : `${st.grund || 'Dieser Server nimmt keine Clips an.'} Clips werden lokal gesammelt.`;
    }

    async function schalte(aktiv) {
        einst.aktiv = aktiv;
        speichereEinst();
        if (!aktiv) {
            await beendeClip('Aufnahme ausgeschaltet', { hochladen: false });
            schliesseAnsicht();
            stoppeKamera();
            zeige('');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            zeige('Kamera nicht verfügbar (nur über localhost oder HTTPS).', true);
            aktivBox.checked = false;
            einst.aktiv = false;
            return;
        }
        try {
            await starteKamera();
            zeige('Kamera bereit. Der nächste geladene Kampf wird aufgenommen.');
            beginneFuerGeladenenKampf();
        } catch (e) {
            zeige(`Kamera nicht nutzbar (${e.name || e.message}).`, true);
            aktivBox.checked = false;
            einst.aktiv = false;
            speichereEinst();
        }
    }

    aktivBox.checked = einst.aktiv;
    aufloesungSelect.value = einst.aufloesung;
    aktivBox.addEventListener('change', () => schalte(aktivBox.checked));
    kameraSelect.addEventListener('change', async () => {
        einst.kamera = kameraSelect.value;
        speichereEinst();
        if (einst.aktiv && !clip) await starteKamera().catch(e => zeige(`Kamera nicht nutzbar (${e.name}).`, true));
    });
    aufloesungSelect.addEventListener('change', async () => {
        einst.aufloesung = aufloesungSelect.value;
        speichereEinst();
        if (einst.aktiv && !clip) await starteKamera().catch(e => zeige(`Kamera nicht nutzbar (${e.name}).`, true));
    });
    // Ohne Zwischenspeicher im Browser gehen laufende und wartende Clips beim Schließen verloren: Rückfrage.
    window.addEventListener('beforeunload', (e) => {
        if (!idbOk && alleClips.size) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('pagehide', () => stoppeKamera());

    // Clips aus früheren Sitzungen (nicht übertragen): wiederherstellen und nachliefern. Eine unterbrochene Aufnahme gilt als abgebrochen.
    (async () => {
        const gespeichert = await idbLies('clips', t => t.objectStore('clips').getAll());
        for (const rec of gespeichert) {
            const c = neuerClip(rec.id, rec.meta, rec.mime);
            c.marken = rec.marken || [];
            c.geladen = false;
            c.abschluss = rec.abschluss || { marken: c.marken, ergebnis: 'unterbrochen (Seite geschlossen)', farbe2: (rec.meta && rec.meta.farbe2) || 'blau', ende: new Date().toISOString(), abgebrochen: true };
            alleClips.set(c.id, c);
        }
        if (alleClips.size) { aufnahmeBegonnen = true; plane(); }
    })();
    setInterval(plane, 3000);
    setInterval(() => {
        const feld = el('videoMessung');
        if (!feld) return;
        if (!clip) { feld.textContent = ''; messung.bilder = 0; messung.bytes = 0; return; }
        const s = clip.sync;
        const rueckstand = Math.max(0, clip.bytes - (s.bereit ? s.gesendet : 0));
        feld.textContent = `Bild: ${messung.bilder} fps · Aufnahme: ${(messung.bytes * 8 / 1e6).toFixed(1)} MBit/s · ${s.bereit ? `Rückstand zum Server: ${Math.round(rueckstand / 1024)} KB` : 'nicht mit dem Server verbunden'}`;
        feld.style.color = messung.bilder < 20 ? '#ffb74d' : '';
        messung.bilder = 0;
        messung.bytes = 0;
    }, 1000);
    aktualisiereServerStatus().then(() => { if (einst.aktiv && !aktivBox.disabled) schalte(true); });
    setInterval(aktualisiereServerStatus, 30000);
}
