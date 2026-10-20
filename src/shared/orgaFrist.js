// Fälligkeit einer Orga-Planer-Aufgabe (rein). Datumsrechnung mit lokalen Feldern,
// nie über toISOString (Zeitzonenverschiebung).

const zwei = (n) => String(n).padStart(2, '0');

function zerlege(wert) {
  if (!wert) return null;
  if (wert instanceof Date) {
    if (Number.isNaN(wert.getTime())) return null;
    return [wert.getFullYear(), wert.getMonth() + 1, wert.getDate()];
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(wert));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function datumAlsText(d) {
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

// Fehlt der Anmeldeschluss, fällt der Anker auf den Turniertag zurück.
export function berechneFaelligkeit({ frist_anker, frist_tage }, { turnierdatum, anmeldeschluss } = {}) {
  if (frist_anker !== 'turnier' && frist_anker !== 'anmeldeschluss') return null;
  const basis = (frist_anker === 'anmeldeschluss' ? zerlege(anmeldeschluss) : null) ?? zerlege(turnierdatum);
  if (!basis) return null;
  const [j, m, t] = basis;
  return datumAlsText(new Date(j, m - 1, t + Number(frist_tage ?? 0)));
}
