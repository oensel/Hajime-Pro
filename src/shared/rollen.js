// Rollen einer Vereinsmitgliedschaft (benutzer_vereine.rolle, Helferverwaltung Spec Abschnitt 2/3).
// Framework- und DB-frei, damit Server und Browser dieselbe Hierarchie nutzen.
//   admin    – verwaltet Mitglieder und Rollen des Vereins, darf alles, was ein Benutzer darf
//   benutzer – verwaltet Turniere des Vereins (Turnier, Pools, Teilnehmer, Kämpfe, Helferplan)
//   helfer   – nur Helfer-App (Turniere des Vereins sehen, sich eintragen)
// Die globale Rolle Super-Admin (benutzer.ist_super_admin) ist bewusst keine Vereinsrolle.

export const ROLLEN = ['admin', 'benutzer', 'helfer'];

const STUFE = { helfer: 1, benutzer: 2, admin: 3 };

export function istGueltigeRolle(r) {
    return typeof r === 'string' && Object.prototype.hasOwnProperty.call(STUFE, r);
}

/**
 * Reicht die Rolle für die verlangte Mindeststufe? null/unbekannte Rollen reichen nie.
 * @param {string|null} rolle
 * @param {'helfer'|'benutzer'|'admin'} mindestens
 * @returns {boolean}
 */
export function rolleReicht(rolle, mindestens) {
    if (!istGueltigeRolle(rolle) || !istGueltigeRolle(mindestens)) return false;
    return STUFE[rolle] >= STUFE[mindestens];
}
