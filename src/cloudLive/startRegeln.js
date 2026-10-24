// Wann ein Turnier in der Cloud live geschaltet werden darf: ab dem Vortag (Berliner Zeit) bis zum Ende des Turniertags
// (06:00 Uhr am Folgetag, wie der Zugang selbst). Ohne diese Grenze könnte ein Verein beliebig weit entfernte Turniere live
// schalten und damit die begrenzten Plätze der Cloud (MAX_LIVE_TURNIERE) für alle anderen blockieren.
import { endeDesTurniertags } from '../liveCloud/zugang.js';
import { datumsText } from './zugang.js';

export const VORLAUF_TAGE = 1;

function berlinTag(zeit) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(zeit);
}

function verschiebeTag(text, tage) {
    const [j, m, t] = text.split('-').map(Number);
    return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/** @returns {{ ok: true } | { ok: false, grund: 'zu_frueh' | 'vorbei' }} */
export function pruefeStartfenster(datum, jetzt = () => new Date()) {
    const text = datumsText(datum);
    const ende = endeDesTurniertags(text);
    if (!ende || jetzt().getTime() >= ende.getTime()) return { ok: false, grund: 'vorbei' };
    return berlinTag(jetzt()) >= verschiebeTag(text, -VORLAUF_TAGE) ? { ok: true } : { ok: false, grund: 'zu_frueh' };
}
