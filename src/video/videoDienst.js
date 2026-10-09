// Video-Clips für den Videoschiedsrichter. Der Client nimmt jeden Kampf lokal auf und überträgt ihn über den WebSocket /api/video:
//   {t:'start', meta}   meta: clipId, mime, Kampfdaten, beginn, live (Clip wird gerade aufgenommen)
//                       → {t:'bereit', clipId, empfangen}: so viele Bytes hat der Server schon (Wiederaufnahme nach einem Abbruch)
//   binäre Blöcke       werden an die Datei angehängt (ab 'empfangen') und – bei live – an Zuschauer weitergereicht
//   {t:'ende', groesse, meta}  meta: marken, ergebnis, farbe2, ende, abgebrochen
//                       → {t:'fertig'} oder {t:'fehlt', empfangen}, wenn dem Server noch Bytes fehlen
// Zuschauer verbinden sich mit /api/video/live?matte=<id>; wer später dazukommt, bekommt zuerst den bisherigen Clip und dann den
// Live-Strom. Am Server liegt am Ende immer das vollständige Video (videoSpeicher.js).
import fs from 'node:fs';
import { WebSocket } from 'ws';

export const VIDEO_PFAD = '/api/video';
export const VIDEO_LIVE_PFAD = '/api/video/live';
const STUECK_BYTES = 1024 * 1024;
const MAX_MARKEN = 300;

function sende(ws, objekt) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(objekt));
}

export function erzeugeVideoDienst({ speicher, darfSenden = () => true, maxBytes = 3 * 1024 ** 3 }) {
    const aktive = new Map();      // matteId -> { clip, ws }: Clips, die gerade live aufgenommen werden
    const zuschauer = new Map();   // matteId -> Set<ws>

    function zuschauerVon(matteId) {
        return zuschauer.get(String(matteId)) || new Set();
    }

    function beschreibung(clip) {
        const i = clip.index;
        return { clipId: i.id, matteId: i.matteId, matteName: i.matteName, kampfId: i.kampfId, pool: i.pool, kaempfer1: i.kaempfer1, kaempfer2: i.kaempfer2, farbe2: i.farbe2, mime: i.mime };
    }

    // Schickt dem Zuschauer den Clip von vorn: Beschreibung und alles, was bisher in der Datei liegt.
    function sendeClipAn(z, clip) {
        sende(z, { t: 'clip', ...beschreibung(clip) });
        if (clip.groesse > 0) {
            const inhalt = fs.readFileSync(clip.videoPfad);
            for (let i = 0; i < inhalt.length; i += STUECK_BYTES) z.send(inhalt.subarray(i, i + STUECK_BYTES), { binary: true });
        }
    }

    function beendeLive(matteId, clip) {
        const a = aktive.get(String(matteId));
        if (!a || a.clip !== clip) return;
        aktive.delete(String(matteId));
        zuschauerVon(matteId).forEach(z => sende(z, { t: 'ende' }));
    }

    function start(ws, meta) {
        if (!darfSenden()) return sende(ws, { t: 'fehler', grund: 'Dieser Server ist nur Secondary – Clips werden nur am Master gespeichert.' });
        if (!meta || meta.matteId == null) return sende(ws, { t: 'fehler', grund: 'Matte fehlt.' });
        if (ws.hajimeClip) return; // ein Clip je Verbindung
        let clip;
        try {
            clip = speicher.oeffneClip(meta);
        } catch (e) {
            return sende(ws, { t: 'fehler', grund: `Clip konnte nicht angelegt werden (${e.code || e.message}).` });
        }
        ws.hajimeClip = clip;
        ws.hajimeLive = !!meta.live && !clip.fertig;
        if (ws.hajimeLive) {
            const matteId = String(meta.matteId);
            const alt = aktive.get(matteId);
            if (alt && alt.clip !== clip) beendeLive(matteId, alt.clip); // ein neuer Clip ersetzt einen hängenden
            aktive.set(matteId, { clip, ws });
            // Zuschauer starten den Clip (neu) von vorn: bei einer Wiederaufnahme steht in der Datei, was sie schon hatten.
            zuschauerVon(matteId).forEach(z => sendeClipAn(z, clip));
        }
        sende(ws, { t: 'bereit', clipId: clip.id, empfangen: clip.groesse });
    }

    function ende(ws, m) {
        const clip = ws.hajimeClip;
        if (!clip) return;
        if (clip.fertig) return sende(ws, { t: 'fertig', clipId: clip.id }); // wiederholte Meldung (Antwort ging verloren)
        const erwartet = Number(m.groesse);
        if (!Number.isFinite(erwartet) || erwartet <= 0) return sende(ws, { t: 'fehler', grund: 'Der Clip ist leer.' });
        if (clip.groesse !== erwartet) return sende(ws, { t: 'fehlt', empfangen: clip.groesse });
        const meta = m.meta || {};
        (Array.isArray(meta.marken) ? meta.marken : []).slice(0, MAX_MARKEN).forEach(k => clip.marke(k && k.typ, k && k.ms, k && k.text));
        clip.schliesse({ ergebnis: meta.ergebnis, farbe2: meta.farbe2, abgebrochen: !!meta.abgebrochen, ende: meta.ende });
        beendeLive(clip.index.matteId, clip);
        sende(ws, { t: 'fertig', clipId: clip.id });
    }

    return {
        status() {
            const master = darfSenden();
            return {
                verfuegbar: master,
                grund: master ? '' : 'Dieser Server ist nur Secondary.',
                speicher: speicher.speicher(),
                verzeichnis: speicher.wurzel,
                live: [...aktive.values()].map(a => beschreibung(a.clip))
            };
        },

        verbindeSender(ws) {
            ws.on('message', (daten, istBinaer) => {
                const clip = ws.hajimeClip;
                if (istBinaer) {
                    if (!clip || clip.fertig) return;
                    if (clip.groesse + daten.length > maxBytes) {
                        sende(ws, { t: 'fehler', grund: 'Der Clip ist zu groß.' });
                        return ws.close();
                    }
                    clip.schreibe(daten);
                    if (ws.hajimeLive) zuschauerVon(clip.index.matteId).forEach(z => { if (z.readyState === WebSocket.OPEN) z.send(daten, { binary: true }); });
                    return;
                }
                let m;
                try { m = JSON.parse(daten.toString()); } catch { return; }
                if (m.t === 'start') start(ws, m.meta);
                else if (m.t === 'ende') ende(ws, m);
            });
            // Bricht die Verbindung ab, bleibt der Clip unvollständig liegen: der Client setzt ihn später an derselben Stelle fort.
            const abbruch = () => { if (ws.hajimeClip && ws.hajimeLive) beendeLive(ws.hajimeClip.index.matteId, ws.hajimeClip); };
            ws.on('close', abbruch);
            ws.on('error', abbruch);
        },

        verbindeZuschauer(ws, matteId) {
            const schluessel = String(matteId);
            if (!zuschauer.has(schluessel)) zuschauer.set(schluessel, new Set());
            const a = aktive.get(schluessel);
            // Bisherigen Clip nachliefern und im selben Schritt als Zuschauer eintragen: so geht kein Block verloren.
            if (a) {
                sendeClipAn(ws, a.clip);
            } else {
                sende(ws, { t: 'leer' });
            }
            zuschauer.get(schluessel).add(ws);
            const weg = () => zuschauer.get(schluessel)?.delete(ws);
            ws.on('close', weg);
            ws.on('error', weg);
        }
    };
}
