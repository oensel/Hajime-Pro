// Einstellungen dieses Client-Knotens (Notebook/Tablet) in der lokalen, NICHT replizierten
// Datenbank "hajime_client" (Logik: src/shared/clientKonfig.js).
import { randomUUID } from 'crypto';
import os from 'os';
import { oeffneMitWiederholung } from './dokumentDb.js';
import { erzeugeClientKonfig as erzeugeGemeinsam } from '../shared/clientKonfig.js';

export async function erzeugeClientKonfig(PouchDB) {
    const db = await oeffneMitWiederholung(PouchDB, 'hajime_client');
    return erzeugeGemeinsam({ db, neueId: randomUUID, geraet: os.hostname() });
}
