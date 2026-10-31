// Video-Archiv (videobeweis.html): Liste der Kampf-Clips, Abspielen mit Marken (Start/Stopp/Wertung/Strafe/Haltegriff/Ergebnis), Einzelbild, Zeitlupe.
const liste = document.getElementById('vbListe');
const matteSelect = document.getElementById('vbMatte');
const sucheEl = document.getElementById('vbSuche');
const speicherEl = document.getElementById('vbSpeicher');
const player = document.getElementById('vbPlayer');
const video = document.getElementById('vbVideo');
const markenEl = document.getElementById('vbMarken');
const titelEl = document.getElementById('vbTitel');
const VORLAUF_S = 3; // beim Sprung zu einer Marke etwas früher beginnen
const BILDRATE = 30;
// Das Archiv gehört zum gewählten Turnier (?turnierId= wie bei den anderen Seiten); ohne Turnier zeigt die Seite nur einen Hinweis.
const gewaehltesTurnier = new URLSearchParams(location.search).get('turnierId') || new URLSearchParams(location.search).get('id');
const turnierQuery = gewaehltesTurnier ? `?turnierId=${encodeURIComponent(gewaehltesTurnier)}` : '';

let clips = [];
let liveIds = new Set(); // Clips, die gerade live aufgenommen werden
let aktuelleUrl = null;

const MARKEN_NAMEN = { geladen: 'Kampf geladen', start: 'START', stopp: 'STOPP', ergebnis: 'Ergebnis', wertung: 'Wertung', strafe: 'Strafe', haltegriff: 'Haltegriff' };
const spurEl = document.getElementById('vbSpur');
const standEl = document.getElementById('vbStand');
let aktuelleMarken = [];

const farbeText = (c) => (c.farbe2 === 'rot' ? 'Rot' : 'Blau');
const kaempferText = (c) => `${c.kaempfer1} (Weiß) gegen ${c.kaempfer2} (${farbeText(c)})`;
// Kämpfer untereinander, je mit Farbmarke (Weiß, Blau oder Rot).
function kaempferZelle(c) {
    const td = document.createElement('td');
    td.className = 'video-kaempfer';
    [[c.kaempfer1, 'weiss', 'Weiß'], [c.kaempfer2, c.farbe2 === 'rot' ? 'rot' : 'blau', farbeText(c)]].forEach(([name, farbe, text]) => {
        const zeile = document.createElement('div');
        const marke = document.createElement('span');
        marke.className = `video-farbmarke video-farbmarke-${farbe}`;
        marke.title = text;
        zeile.append(marke, document.createTextNode(name));
        td.appendChild(zeile);
    });
    return td;
}
const zeit = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const uhr = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const mb = (b) => (b / 1e6).toFixed(1) + ' MB';

function zelle(text, klasse) {
    const td = document.createElement('td');
    td.textContent = text;
    if (klasse) td.className = klasse;
    return td;
}

function zeichneListe() {
    const matte = matteSelect.value;
    const suche = sucheEl.value.trim().toLowerCase();
    const treffer = clips.filter(c => (!matte || String(c.matteId) === matte)
        && (!suche || `${c.pool} ${c.kaempfer1} ${c.kaempfer2}`.toLowerCase().includes(suche)));
    liste.replaceChildren();
    if (!treffer.length) {
        liste.textContent = clips.length ? 'Keine Clips für diese Auswahl.' : 'Noch keine Aufnahmen.';
        return;
    }
    const tabelle = document.createElement('table');
    tabelle.className = 'video-tabelle';
    const kopf = tabelle.createTHead().insertRow();
    ['Uhrzeit', 'Matte', 'Pool', 'Kämpfer', 'Ergebnis', 'Größe', ''].forEach(t => {
        const th = document.createElement('th');
        th.textContent = t;
        kopf.appendChild(th);
    });
    const body = tabelle.createTBody();
    treffer.forEach(c => {
        const tr = body.insertRow();
        tr.dataset.clipId = c.id;
        tr.append(
            zelle(uhr(c.beginn)),
            zelle(c.matteName || `Matte ${c.matteId}`),
            zelle(c.pool),
            kaempferZelle(c),
            zelle(c.ende ? (c.abgebrochen ? `abgebrochen${c.ergebnis ? ` (${c.ergebnis})` : ''}` : c.ergebnis || 'beendet') : (liveIds.has(c.id) ? 'läuft …' : 'unvollständig (Übertragung offen)')),
            zelle(mb(c.groesse))
        );
        const aktionen = document.createElement('td');
        const ansehen = document.createElement('button');
        ansehen.type = 'button';
        ansehen.className = 'video-knopf video-ansehen';
        ansehen.textContent = 'Ansehen';
        ansehen.addEventListener('click', () => oeffne(c));
        const loeschen = document.createElement('button');
        loeschen.type = 'button';
        loeschen.className = 'video-knopf video-knopf-gefahr';
        loeschen.textContent = 'Löschen';
        loeschen.addEventListener('click', async () => {
            if (!confirm('Diesen Clip endgültig löschen?')) return;
            await fetch(`/api/video/clips/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
            if (player.dataset.clipId === c.id) schliesse();
            lade();
        });
        const knoepfe = document.createElement('div');
        knoepfe.className = 'video-aktionen';
        knoepfe.append(ansehen, loeschen);
        aktionen.appendChild(knoepfe);
        tr.appendChild(aktionen);
    });
    liste.appendChild(tabelle);
}

function schliesse() {
    player.hidden = true;
    video.removeAttribute('src');
    video.load();
    if (aktuelleUrl) URL.revokeObjectURL(aktuelleUrl);
    aktuelleUrl = null;
}

function springeZu(m) {
    video.currentTime = Math.max(0, m.ms / 1000 - VORLAUF_S);
    video.playbackRate = Number(document.getElementById('vbTempo').value);
    video.play().catch(() => {});
}

// Zeitleiste mit einer Marke je Ereignis (MediaRecorder-Dateien melden die Länge erst spät, bis dahin gilt die letzte Marke)
function spurDauer() {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return Math.max(1, ...aktuelleMarken.map(m => m.ms / 1000)) + 1;
}
function zeichneSpur() {
    spurEl.querySelectorAll('i').forEach(i => i.remove());
    const dauer = spurDauer();
    aktuelleMarken.filter(m => m.typ !== 'geladen').forEach(m => {
        const tick = document.createElement('i');
        tick.className = `vb-tick video-marke-${m.typ}`;
        tick.style.left = `${Math.min(100, (m.ms / 1000 / dauer) * 100)}%`;
        tick.title = `${m.text || MARKEN_NAMEN[m.typ] || m.typ} ${zeit(m.ms)}`;
        tick.addEventListener('click', (e) => { e.stopPropagation(); springeZu(m); });
        spurEl.appendChild(tick);
    });
}
video.addEventListener('durationchange', zeichneSpur);
video.addEventListener('timeupdate', () => { standEl.style.width = `${Math.min(100, (video.currentTime / spurDauer()) * 100)}%`; });
spurEl.addEventListener('click', (e) => {
    const r = spurEl.getBoundingClientRect();
    video.currentTime = ((e.clientX - r.left) / r.width) * spurDauer();
});

async function oeffne(c) {
    titelEl.textContent = `${c.matteName || ''} · ${c.pool} · ${kaempferText(c)}`;
    player.dataset.clipId = c.id;
    player.hidden = false;
    markenEl.replaceChildren();
    const antwort = await fetch(`/api/video/clips/${encodeURIComponent(c.id)}/datei`);
    if (!antwort.ok) { titelEl.textContent = 'Clip konnte nicht geladen werden.'; return; }
    const blob = await antwort.blob();
    if (aktuelleUrl) URL.revokeObjectURL(aktuelleUrl);
    aktuelleUrl = URL.createObjectURL(blob);
    document.getElementById('vbDownload').href = aktuelleUrl;
    document.getElementById('vbDownload').download = `${c.id}.${/mp4/i.test(c.mime) ? 'mp4' : 'webm'}`;

    // MediaRecorder-Dateien haben keine Länge: einmal ans Ende springen, damit der Browser sie ermittelt und das Spulen geht.
    const vorbereitet = () => {
        video.removeEventListener('timeupdate', vorbereitet);
        video.currentTime = 0;
    };
    video.addEventListener('loadedmetadata', () => {
        if (video.duration === Infinity) {
            video.addEventListener('timeupdate', vorbereitet);
            video.currentTime = 1e101;
        }
    }, { once: true });
    video.src = aktuelleUrl;
    video.playbackRate = Number(document.getElementById('vbTempo').value);

    aktuelleMarken = c.marken;
    c.marken.forEach(m => {
        const knopf = document.createElement('button');
        knopf.type = 'button';
        knopf.className = `video-knopf video-marke video-marke-${m.typ}`;
        knopf.textContent = `${m.text || MARKEN_NAMEN[m.typ] || m.typ} ${zeit(m.ms)}`;
        knopf.addEventListener('click', () => springeZu(m));
        markenEl.appendChild(knopf);
    });
    zeichneSpur();
    player.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function lade() {
    try {
        const [cr, sr] = await Promise.all([fetch(`/api/video/clips${turnierQuery}`, { cache: 'no-store' }), fetch(`/api/video/status${turnierQuery}`, { cache: 'no-store' })]);
        if (!cr.ok) throw new Error(String(cr.status));
        clips = await cr.json();
        const status = sr.ok ? await sr.json() : null;
        liveIds = new Set(status && status.live ? status.live.map(l => l.clipId) : []);
        if (status && status.speicher) {
            const s = status.speicher;
            speicherEl.textContent = `${clips.length} Clips in diesem Turnier · Speicher belegt: ${(s.belegt / 1e9).toFixed(2)} GB${s.frei != null ? ` · frei: ${(s.frei / 1e9).toFixed(1)} GB` : ''}`;
        }
        const gewaehlt = matteSelect.value;
        const matten = new Map(clips.map(c => [String(c.matteId), c.matteName || `Matte ${c.matteId}`]));
        matteSelect.replaceChildren(new Option('Alle', ''), ...[...matten].map(([id, name]) => new Option(name, id)));
        matteSelect.value = matten.has(gewaehlt) ? gewaehlt : '';
        zeichneListe();
    } catch {
        liste.textContent = 'Video ist nicht verfügbar (nur am Hallen-Server).';
    }
}

matteSelect.addEventListener('change', zeichneListe);
sucheEl.addEventListener('input', zeichneListe);
document.getElementById('vbTempo').addEventListener('change', (e) => { video.playbackRate = Number(e.target.value); });
document.getElementById('vbBildVor').addEventListener('click', () => { video.pause(); video.currentTime += 1 / BILDRATE; });
document.getElementById('vbBildZurueck').addEventListener('click', () => { video.pause(); video.currentTime = Math.max(0, video.currentTime - 1 / BILDRATE); });
document.getElementById('vbAlleLoeschen').addEventListener('click', async () => {
    if (!confirm('ALLE Clips dieses Turniers endgültig löschen?')) return;
    await fetch(`/api/video/clips/alle-loeschen${turnierQuery}`, { method: 'POST' });
    schliesse();
    lade();
});

if (gewaehltesTurnier) {
    lade();
    setInterval(lade, 15000);
} else {
    liste.textContent = 'Bitte zuerst ein Turnier auswählen – das Video-Archiv gehört immer zu einem Turnier.';
    document.getElementById('vbAlleLoeschen').disabled = true;
    matteSelect.disabled = true;
    sucheEl.disabled = true;
}
