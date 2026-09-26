import express from 'express';

// /api/sync/status ist IMMER gemountet (auch ohne Sync, dann rolle: null) — das Frontend
// (datenzugriff.js, syncStatus.js) entscheidet anhand der Antwort zwischen REST- und
// Dokument-Backend bzw. zeigt den Verbindungszustand. Server und Client liefern ihren eigenen
// Status (Client zusätzlich verbunden/ausstehend/matte_id).
export function getSyncRoutes(holeSync) {
    const router = express.Router();

    router.get('/status', async (req, res) => {
        const sync = holeSync();
        if (!sync) return res.json({ rolle: null, instanz_id: null, turnier_id: null, db_name: null });
        return res.json(await sync.status());
    });

    // --- Konfliktliste der Turnierleitung (nur Hallen-Server, Spec Abschnitt 10) ---
    const nurServer = (req, res, next) => {
        const sync = holeSync();
        if (!sync || sync.rolle !== 'server') return res.status(404).json({ success: false, error: 'Nur am Hallen-Server.' });
        req.server = sync;
        next();
    };

    router.get('/konflikte', nurServer, async (req, res) => {
        res.json(await req.server.listeKonflikte());
    });

    router.post('/konflikte/:id/erledigt', nurServer, async (req, res) => {
        try {
            await req.server.erledigeKonflikt(req.params.id);
            res.json({ success: true });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });

    router.post('/konflikte/:id/wiederholen', nurServer, async (req, res) => {
        try {
            await req.server.wiederholeKonflikt(req.params.id);
            res.json({ success: true });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.message });
        }
    });

    // --- Mattenwahl eines Client-Geräts (Spec Abschnitt 4) ---
    const nurClient = (req, res, next) => {
        const sync = holeSync();
        if (!sync || sync.rolle !== 'client') return res.status(404).json({ success: false, error: 'Nur auf Client-Geräten.' });
        req.client = sync;
        next();
    };

    router.get('/client/matte', nurClient, async (req, res) => {
        res.json({ matte_id: await req.client.clientKonfig.matteId() });
    });

    // Vor einem Mattenwechsel: ausstehende Änderungen, laufender Kampf auf der bisherigen Matte,
    // anderer Client (Heartbeat jünger als 2 Minuten) auf der Ziel-Matte.
    router.get('/client/matte/pruefen', nurClient, async (req, res) => {
        res.json(await req.client.pruefeMattenwechsel(Number(req.query.matte_id)));
    });

    router.put('/client/matte', nurClient, async (req, res) => {
        const matteId = req.body && req.body.matte_id;
        if (!matteId) return res.status(400).json({ success: false, error: 'matte_id fehlt.' });
        await req.client.setzeMatte(Number(matteId));
        res.json({ success: true, matte_id: Number(matteId) });
    });

    // Nur für die automatisierten Tests (NODE_ENV=test): deterministisch warten statt zu schlafen,
    // Verbindungsabbruch eines Clients simulieren.
    if (process.env.NODE_ENV === 'test') {
        router.post('/test/leerlauf', async (req, res) => {
            const sync = holeSync();
            if (sync) await sync.leerlauf();
            res.json({ success: true });
        });

        // Simuliert einen Server-Neustart der Brücke: Feed wieder ab Sequenz 0 lesen.
        router.post('/test/bruecke-neustart', async (req, res) => {
            const sync = holeSync();
            if (sync && sync.brueckeNeuStarten) await sync.brueckeNeuStarten();
            res.json({ success: true });
        });

        router.post('/test/trennen', (req, res) => {
            const sync = holeSync();
            if (!sync || sync.rolle !== 'client') return res.status(400).json({ success: false });
            sync.trennen();
            res.json({ success: true });
        });

        router.get('/test/verworfen', (req, res) => {
            const sync = holeSync();
            if (!sync || sync.rolle !== 'client') return res.status(400).json([]);
            res.json(sync.verworfeneDateien());
        });

        router.post('/test/verbinden', async (req, res) => {
            const sync = holeSync();
            if (!sync || sync.rolle !== 'client') return res.status(400).json({ success: false });
            await sync.verbinden();
            res.json({ success: true });
        });
    }

    return router;
}
