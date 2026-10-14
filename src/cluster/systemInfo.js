// Systemangaben eines Hallen-Servers für die Cluster-Seite: Arbeitsspeicher, Auslagerung, Platten, CPU, Last, Laufzeit,
// Netz und Datenbankgröße. Alle Quellen sind optional: was nicht lesbar ist, wird zu null (Windows, fehlende Rechte),
// nie zu einem Fehler im Status.
import nodeOs from 'os';
import { readFile, statfs as nodeStatfs, stat } from 'fs/promises';
import path from 'path';

const KB = 1024;

export function parseMeminfo(text) {
    const wert = (schluessel) => {
        const m = new RegExp(`^${schluessel}:\\s+(\\d+)\\s*kB`, 'm').exec(String(text || ''));
        return m ? Number(m[1]) * KB : null;
    };
    return { gesamt: wert('MemTotal'), verfuegbar: wert('MemAvailable'), swapGesamt: wert('SwapTotal'), swapFrei: wert('SwapFree') };
}

async function oderNull(fn) {
    try {
        return await fn();
    } catch {
        return null;
    }
}

// statfs auf den Pfad, bei fehlendem Zugriff (z. B. PostgreSQL-Verzeichnis) auf den nächsten lesbaren Elternordner.
async function plattenwerte(pfad, { statfs, geraet }) {
    let aktuell = pfad;
    for (let i = 0; i < 8; i++) {
        const s = await oderNull(() => statfs(aktuell));
        if (s) {
            return {
                pfad: aktuell,
                gesamt: s.blocks * s.bsize,
                frei: s.bavail * s.bsize,
                geraet: await oderNull(() => geraet(aktuell))
            };
        }
        const eltern = path.dirname(aktuell);
        if (eltern === aktuell) break;
        aktuell = eltern;
    }
    return null;
}

export async function erfasseSystemInfo({
    os = nodeOs, plattform = process.platform, nodeVersion = process.version,
    leseDatei = (p) => readFile(p, 'utf-8'), statfs = nodeStatfs, geraet = async (p) => (await stat(p)).dev,
    pfade = [], dbGroesse = null
} = {}) {
    const mem = plattform === 'linux' ? parseMeminfo(await oderNull(() => leseDatei('/proc/meminfo'))) : parseMeminfo('');
    const ram = {
        gesamt: mem.gesamt ?? os.totalmem(),
        verfuegbar: mem.verfuegbar ?? os.freemem()
    };
    const swap = mem.swapGesamt != null ? { gesamt: mem.swapGesamt, frei: mem.swapFrei } : null;

    // Je Gerät eine Platte; liegen Daten, PostgreSQL und Programm zusammen, steht das in `enthaelt`.
    const platten = [];
    const nachGeraet = new Map();
    for (const { bezeichnung, pfad } of pfade) {
        const w = await plattenwerte(pfad, { statfs, geraet });
        if (!w) continue;
        const schluessel = w.geraet != null ? `dev:${w.geraet}` : `pfad:${w.pfad}`;
        const vorhanden = nachGeraet.get(schluessel);
        if (vorhanden) {
            vorhanden.enthaelt.push(bezeichnung);
            continue;
        }
        const eintrag = { bezeichnung, pfad: w.pfad, gesamt: w.gesamt, frei: w.frei, enthaelt: [bezeichnung] };
        nachGeraet.set(schluessel, eintrag);
        platten.push(eintrag);
    }

    const cpus = os.cpus() || [];
    const netz = [];
    for (const [name, adressen] of Object.entries(os.networkInterfaces() || {})) {
        for (const a of adressen || []) {
            if (a.family === 'IPv4' && !a.internal) netz.push({ schnittstelle: name, adresse: a.address });
        }
    }

    return {
        host: os.hostname(),
        os: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        cpu: { modell: cpus[0] ? String(cpus[0].model).trim() : null, kerne: cpus.length },
        last: os.loadavg(),
        laufzeit_s: Math.round(os.uptime()),
        node: String(nodeVersion).replace(/^v/, ''),
        ram,
        swap,
        platten,
        netz,
        db_groesse: dbGroesse ? await oderNull(dbGroesse) : null
    };
}
