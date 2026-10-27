// REST-Schnittstelle der Video-Clips (Video-Archiv): Status, Clipliste, Abspielen, Löschen. Die Übertragung der Clips läuft über den
// WebSocket /api/video (src/video/videoDienst.js).
import express from 'express';

export function getVideoRoutes({ speicher, dienst }) {
    const router = express.Router();

    // Alle drei Abfragen nehmen optional ?turnierId= (Video-Archiv und Menü zeigen nur das gewählte Turnier).
    const turnierFilter = (req) => (req.query.turnierId ? req.query.turnierId : undefined);

    router.get('/status', (req, res) => res.json(dienst.status({ turnierId: turnierFilter(req) })));

    router.get('/clips', (req, res) => {
        res.json(speicher.liste({ matteId: req.query.matteId, turnierId: turnierFilter(req) }));
    });

    router.get('/clips/:id/datei', (req, res) => {
        const clip = speicher.hole(req.params.id);
        if (!clip) return res.status(404).json({ error: 'Clip nicht gefunden.' });
        // sendFile bedient Range-Anfragen; der Typ kommt aus der Aufnahme (webm/mp4).
        res.sendFile(clip.videoPfad, { headers: { 'Content-Type': clip.meta.mime.split(';')[0] || 'video/webm' } });
    });

    router.delete('/clips/:id', (req, res) => {
        if (!speicher.loesche(req.params.id)) return res.status(404).json({ error: 'Clip nicht gefunden.' });
        res.json({ success: true });
    });

    router.post('/clips/alle-loeschen', (req, res) => {
        res.json({ success: true, geloescht: speicher.loescheAlle({ turnierId: turnierFilter(req) }) });
    });

    return router;
}
