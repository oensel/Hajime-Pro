// Menü-Rechte der Verwaltungsoberfläche (Helferverwaltung, Spec 3.3). Framework- und DB-frei: menu.js
// (Browser, per dynamischem import unter /js/shared/) und die Unit-Tests nutzen dieselben Regeln.
//   - Verwaltung (Turniere, Pools, …): Super-Admin oder Rolle Benutzer/Admin im aktiven Verein
//   - Helferplan und Orga: nur Super-Admin oder Rolle Admin (Benutzer sind für Client-Geräte und als Helfer gedacht)
//   - „Benutzer“ (admin-nutzer.html) und „Server-Update“ (server-update.html): nur Super-Admins
//   - „Helfer-App“: jedes angemeldete Konto in der Cloud
// Im Einzelbenutzerbetrieb (Hallen-Server, offline_user) bleibt das Menü wie bisher: alles Verwaltende sichtbar,
// keine Helfer-App und keine Nutzerverwaltung (beide gibt es dort nicht).
import { rolleReicht } from './rollen.js';

export const ROLLEN_TEXT = { admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' };

/**
 * @param {{ rolle?: string|null, istSuperAdmin?: boolean, einzelbenutzer?: boolean }} eingabe
 *   rolle = Rolle im aktiven Verein (user.verein_rolle, null solange nicht freigegeben)
 * @returns {{ verwaltung: boolean, helferPlan: boolean, nutzer: boolean, helferApp: boolean }}
 */
export function menueFuerRolle({ rolle = null, istSuperAdmin = false, einzelbenutzer = false } = {}) {
    if (einzelbenutzer) {
        return { verwaltung: true, helferPlan: true, nutzer: false, helferApp: false };
    }
    const verwaltung = !!istSuperAdmin || rolleReicht(rolle, 'benutzer');
    const helferPlan = !!istSuperAdmin || rolleReicht(rolle, 'admin');
    return { verwaltung, helferPlan, nutzer: !!istSuperAdmin, helferApp: true };
}

/** Vereine, die sich als aktiver Verein der Verwaltung eignen: freigegeben mit Rolle Benutzer oder Admin. */
export function verwaltbareVereine(vereine) {
    return (Array.isArray(vereine) ? vereine : []).filter(v => v && v.freigegeben && rolleReicht(v.rolle, 'benutzer'));
}

/** Vorbelegte Rolle beim Freischalten: Registrierung über die Helfer-App → Helfer, sonst Benutzer (Spec 4). */
export function vorbelegteFreigabeRolle(angefragtUeber) {
    return angefragtUeber === 'helfer-app' ? 'helfer' : 'benutzer';
}

// Seiten, die auch Konten ohne Verwaltungsrecht öffnen dürfen (keine Weiterleitung zur Helfer-App).
const HELFER_FREIE_SEITEN = ['login.html', 'verein_auswahl.html', 'profil.html', 'bestaetigen.html', 'freigabe.html', 'helfer.html'];

/** Darf ein Konto ohne Verwaltungsrecht diese Seite sehen? */
export function istHelferFreieSeite(pfad) {
    const datei = String(pfad || '').split('?')[0].split('/').pop();
    return HELFER_FREIE_SEITEN.includes(datei);
}
