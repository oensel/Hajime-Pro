// Status einer Orga-Planer-Aufgabe (rein: keine DB, kein DOM).
// Der Status wird nie gespeichert, sondern beim Laden aus Unteraufgaben bzw. Helferplan abgeleitet.
// zaehlung = { [auto_ref | 'gesamt']: { belegt, bedarf, slots } }

function ausAnteil(erledigt, gesamt, quelle) {
  let status = 'offen';
  if (gesamt > 0 && erledigt >= gesamt) status = 'erledigt';
  else if (erledigt > 0) status = 'angefangen';
  return { status, erledigt, gesamt, quelle };
}

export function berechneStatus(aufgabe, kinder = [], zaehlung = {}) {
  // Wer von Hand abhakt, überstimmt jede Automatik.
  if (aufgabe.erledigt_am) {
    return { status: 'erledigt', erledigt: 1, gesamt: 1, quelle: 'manuell' };
  }

  // Mitbringlisten-Einträge der Helfer zählen nicht für die Erledigung.
  const zaehlende = (kinder ?? []).filter((k) => k.art !== 'mitbringen');
  if (zaehlende.length > 0) {
    const fertig = zaehlende.filter((k) => k.erledigt_am).length;
    return ausAnteil(fertig, zaehlende.length, 'unteraufgaben');
  }

  let z = null;
  if (aufgabe.auto_art === 'helferplan_gesamt') z = zaehlung?.gesamt;
  else if (aufgabe.auto_art === 'helferplan_taetigkeit') z = zaehlung?.[aufgabe.auto_ref];
  if (z && z.slots > 0) {
    return ausAnteil(z.belegt, z.bedarf, 'helferplan');
  }

  return { status: 'offen', erledigt: 0, gesamt: 1, quelle: 'offen' };
}
