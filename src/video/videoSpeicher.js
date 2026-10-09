// Speicher der Kampf-Clips für den Videoschiedsrichter: je Kampf eine Videodatei (vom Browser per MediaRecorder
// aufgenommen) und eine Index-Datei mit Kampfdaten und Marken (START/STOPP/Ergebnis als Versatz in ms ab Clipbeginn).
// Layout: <wurzel>/turnier-<id>/matte-<id>/<clipId>.<webm|mp4> + <clipId>.json
import fs from 'node:fs';
import path from 'node:path';

const ID_MUSTER = /^[\w-]{1,80}$/;
const MARKEN_TYPEN = new Set(['geladen', 'start', 'stopp', 'ergebnis']);

function sicher(text, ersatz = 'x') {
    return String(text ?? ersatz).replace(/[^\w-]/g, '_').slice(0, 40) || ersatz;
}

function endungFuer(mime) {
    return /mp4/i.test(mime || '') ? 'mp4' : 'webm';
}

export function erzeugeVideoSpeicher({ wurzel }) {
    const basis = path.resolve(wurzel);

    function indexPfade() {
        const treffer = [];
        if (!fs.existsSync(basis)) return treffer;
        for (const turnier of fs.readdirSync(basis, { withFileTypes: true })) {
            if (!turnier.isDirectory()) continue;
            const turnierDir = path.join(basis, turnier.name);
            for (const matte of fs.readdirSync(turnierDir, { withFileTypes: true })) {
                if (!matte.isDirectory()) continue;
                const matteDir = path.join(turnierDir, matte.name);
                for (const datei of fs.readdirSync(matteDir)) {
                    if (datei.endsWith('.json')) treffer.push(path.join(matteDir, datei));
                }
            }
        }
        return treffer;
    }

    function liesIndex(pfad) {
        try { return JSON.parse(fs.readFileSync(pfad, 'utf8')); } catch { return null; }
    }

    function schreibeIndex(pfad, meta) {
        fs.writeFileSync(pfad, JSON.stringify(meta, null, 2));
    }

    function sucheClip(id) {
        if (!ID_MUSTER.test(String(id))) return null;
        const indexPfad = indexPfade().find(p => path.basename(p, '.json') === id);
        if (!indexPfad) return null;
        const meta = liesIndex(indexPfad);
        if (!meta) return null;
        return { meta, indexPfad, videoPfad: path.join(path.dirname(indexPfad), `${id}.${endungFuer(meta.mime)}`) };
    }

    return {
        wurzel: basis,

        // Legt einen Clip an. meta: { turnierId, matteId, matteName, kampfId, pool, kaempfer1, kaempfer2, mime }.
        oeffneClip(meta) {
            const mime = String(meta.mime || 'video/webm');
            // Clip-ID vom Client: damit lässt sich eine unterbrochene Übertragung an derselben Stelle fortsetzen.
            const vorhanden = ID_MUSTER.test(String(meta.clipId || '')) ? sucheClip(String(meta.clipId)) : null;
            let id, videoPfad, indexPfad, index, fd = null, geschlossen = false;
            if (vorhanden) {
                ({ videoPfad, indexPfad, meta: index } = vorhanden);
                id = index.id;
                geschlossen = !!index.ende;
                // Maßgeblich ist die Datei: nur was dort liegt, hat der Server wirklich.
                index.groesse = fs.existsSync(videoPfad) ? fs.statSync(videoPfad).size : 0;
                if (!geschlossen) fd = fs.openSync(videoPfad, 'a');
            } else {
                // Beginn des Kampfes (vom Client), sonst der Zeitpunkt des Eintreffens.
                const gemeldet = meta.beginn && !Number.isNaN(Date.parse(meta.beginn)) ? new Date(meta.beginn) : null;
                const zeit = gemeldet || new Date();
                id = ID_MUSTER.test(String(meta.clipId || '')) ? String(meta.clipId)
                    : `${zeit.toISOString().replace(/\D/g, '').slice(0, 14)}-k${sicher(meta.kampfId)}-${Math.random().toString(36).slice(2, 6)}`;
                const dir = path.join(basis, `turnier-${sicher(meta.turnierId)}`, `matte-${sicher(meta.matteId)}`);
                fs.mkdirSync(dir, { recursive: true });
                videoPfad = path.join(dir, `${id}.${endungFuer(mime)}`);
                indexPfad = path.join(dir, `${id}.json`);
                fd = fs.openSync(videoPfad, 'w');
                index = {
                    id,
                    turnierId: meta.turnierId ?? null,
                    matteId: meta.matteId ?? null,
                    matteName: meta.matteName ?? '',
                    kampfId: meta.kampfId ?? null,
                    pool: meta.pool ?? '',
                    kaempfer1: meta.kaempfer1 ?? '',
                    kaempfer2: meta.kaempfer2 ?? '',
                    farbe2: meta.farbe2 === 'rot' ? 'rot' : 'blau', // wirksame Farbe von Kämpfer 2 (Turnier, Pool oder Kampf)
                    mime,
                    beginn: zeit.toISOString(),
                    ende: null,
                    abgebrochen: false,
                    ergebnis: null,
                    groesse: 0,
                    marken: []
                };
                schreibeIndex(indexPfad, index);
            }

            return {
                id,
                mime: index.mime,
                videoPfad,
                index,
                // Bytes, die der Server von diesem Clip hat (Grundlage für das Fortsetzen); fertig: Clip bereits abgeschlossen.
                get groesse() { return index.groesse; },
                get fertig() { return geschlossen; },
                // Schreibt synchron: so liest ein später hinzukommender Zuschauer immer den vollständigen Stand.
                schreibe(buf) {
                    if (geschlossen) return;
                    fs.writeSync(fd, buf);
                    index.groesse += buf.length;
                },
                marke(typ, ms, text) {
                    if (geschlossen || !MARKEN_TYPEN.has(typ)) return;
                    index.marken.push({ typ, ms: Math.max(0, Math.round(Number(ms) || 0)), ...(text ? { text: String(text).slice(0, 200) } : {}) });
                    schreibeIndex(indexPfad, index);
                },
                schliesse({ abgebrochen = false, ergebnis = null, farbe2 = null, ende = null } = {}) {
                    if (geschlossen) return;
                    geschlossen = true;
                    if (fd !== null) { try { fs.closeSync(fd); } catch { /* bereits zu */ } }
                    index.ende = ende && !Number.isNaN(Date.parse(ende)) ? new Date(ende).toISOString() : new Date().toISOString();
                    index.abgebrochen = abgebrochen;
                    if (ergebnis) index.ergebnis = String(ergebnis).slice(0, 200);
                    if (farbe2) index.farbe2 = farbe2 === 'rot' ? 'rot' : 'blau'; // kann während des Kampfes noch umgestellt werden
                    schreibeIndex(indexPfad, index);
                }
            };
        },

        // Liste der Clips, neueste zuerst; optional nach Matte gefiltert.
        liste({ matteId } = {}) {
            return indexPfade()
                .map(liesIndex)
                .filter(m => m && (matteId == null || String(m.matteId) === String(matteId)))
                .sort((a, b) => String(b.beginn).localeCompare(String(a.beginn)));
        },

        hole(id) {
            return sucheClip(id);
        },

        loesche(id) {
            const clip = sucheClip(id);
            if (!clip) return false;
            for (const p of [clip.videoPfad, clip.indexPfad]) {
                try { fs.rmSync(p, { force: true }); } catch { /* weg */ }
            }
            return true;
        },

        loescheAlle() {
            let anzahl = 0;
            for (const indexPfad of indexPfade()) {
                const meta = liesIndex(indexPfad);
                if (meta && this.loesche(meta.id)) anzahl++;
            }
            return anzahl;
        },

        // Gesamtgröße der gespeicherten Clips und freier Platz auf dem Laufwerk (Byte; frei null, wenn nicht ermittelbar).
        speicher() {
            let belegt = 0;
            let anzahl = 0;
            for (const indexPfad of indexPfade()) {
                const meta = liesIndex(indexPfad);
                if (meta) { belegt += meta.groesse || 0; anzahl++; }
            }
            let frei = null;
            try {
                fs.mkdirSync(basis, { recursive: true });
                const st = fs.statfsSync(basis);
                frei = Number(st.bavail) * Number(st.bsize);
            } catch { /* statfs nicht verfügbar */ }
            return { clips: anzahl, belegt, frei };
        }
    };
}
