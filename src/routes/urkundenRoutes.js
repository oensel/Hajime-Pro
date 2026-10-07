import express from 'express';
import {
    listeVorlagen, holeVorlagenPdf, holeVorlagenVorschau, legeVorlageAn, dupliziereVorlage, exportiereVorlagenDatei, importiereVorlagenDatei, aktualisiereVorlage, loescheVorlage, ladeBildHoch, holeBild,
    holeUebersicht, holeAbschlussAngebot, generiereUrkunden, holePoolPdf, loeschePoolPdf
} from '../controllers/urkundenController.js';
import { requireAuth, requireTournamentEditAccess } from '../middleware/auth.js';

// Alle Aufrufe tragen turnierId (Query oder Body): Zugriff hat, wer das Turnier bearbeiten darf.
export function getUrkundenRoutes(knex) {
    const router = express.Router();
    router.use(requireAuth, requireTournamentEditAccess(knex));

    router.get('/vorlagen', (req, res) => listeVorlagen(knex, req, res));
    router.get('/vorlagen/export', (req, res) => exportiereVorlagenDatei(knex, req, res));
    router.post('/vorlagen/import', (req, res) => importiereVorlagenDatei(knex, req, res));
    router.get('/vorlagen/:id/pdf', (req, res) => holeVorlagenPdf(knex, req, res));
    router.get('/vorlagen/:id/vorschau', (req, res) => holeVorlagenVorschau(knex, req, res));
    router.post('/vorlagen', (req, res) => legeVorlageAn(knex, req, res));
    router.post('/vorlagen/:id/duplizieren', (req, res) => dupliziereVorlage(knex, req, res));
    router.put('/vorlagen/:id', (req, res) => aktualisiereVorlage(knex, req, res));
    router.post('/vorlagen/:id/bilder', (req, res) => ladeBildHoch(knex, req, res));
    router.get('/vorlagen/:id/bilder/:bildId', (req, res) => holeBild(knex, req, res));
    router.delete('/vorlagen/:id', (req, res) => loescheVorlage(knex, req, res));
    router.get('/uebersicht', (req, res) => holeUebersicht(knex, req, res));
    router.get('/abschluss-angebot', (req, res) => holeAbschlussAngebot(knex, req, res));
    router.post('/generieren', (req, res) => generiereUrkunden(knex, req, res));
    router.get('/pools/:poolId/pdf', (req, res) => holePoolPdf(knex, req, res));
    router.delete('/pools/:poolId/pdf', (req, res) => loeschePoolPdf(knex, req, res));

    return router;
}
