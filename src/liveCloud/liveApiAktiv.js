import betriebsmodus from '../config/betriebsmodus.cjs';

// Ist die Live-API (Ingest, Token-Ausgabe beim Export) auf diesem Server eingehängt? In der Cloud immer, sonst nur für
// Tests/Entwicklung mit LIVE_API_AKTIV=true (dieselbe Regel wie das Einhängen von /api/live in src/app.js).
export function istLiveApiAktiv(env = process.env) {
    return betriebsmodus.liesBetriebsmodus(env).istCloud || env.LIVE_API_AKTIV === 'true';
}
