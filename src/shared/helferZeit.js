// Zeitlogik der Helferverwaltung (rein: keine DB, kein DOM, keine Bibliothek).
// Zeiten innerhalb eines Tages sind Minuten seit 00:00.

export const RASTER_MIN = 15;
export const MIN_LAENGE = 30;
export const STANDARD_SLOT = 120;

// Versatz von Europe/Berlin gegenüber UTC (in Minuten) zum Instant `instant`.
function berlinOffsetMinuten(instant) {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const w = {};
  for (const t of teile) w[t.type] = Number(t.value);
  const alsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((alsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

// Instant für 08:00 Uhr Europe/Berlin am Tag `datum` ('YYYY-MM-DD').
// Der Offset wird mittags (UTC) bestimmt: die Umstellung geschieht um 01:00 UTC,
// 08:00 Ortszeit liegt immer danach.
export function fristEndeBerlin(datum) {
  const [j, m, t] = String(datum).slice(0, 10).split('-').map(Number);
  const offset = berlinOffsetMinuten(new Date(Date.UTC(j, m - 1, t, 12, 0, 0)));
  return new Date(Date.UTC(j, m - 1, t, 8, 0, 0) - offset * 60000);
}

export function darfHelferAendern(datum, jetzt) {
  return jetzt.getTime() < fristEndeBerlin(datum).getTime();
}

export function ueberlappt(a, b) {
  return a.von_min < b.bis_min && b.von_min < a.bis_min;
}

export function rasterRunde(min) {
  return Math.round(min / RASTER_MIN) * RASTER_MIN;
}

export function erzeugeStandardSlots(beginnMin, endeMin) {
  const slots = [];
  let von = beginnMin;
  while (von < endeMin) {
    const bis = Math.min(von + STANDARD_SLOT, endeMin);
    if (bis - von < MIN_LAENGE && slots.length > 0) {
      slots[slots.length - 1].bis_min = bis;
    } else {
      slots.push({ von_min: von, bis_min: bis });
    }
    von = bis;
  }
  return slots;
}

export function zeitstrahlBereich(beginnMin, endeMin) {
  return {
    von: Math.max(0, Math.floor((beginnMin - 60) / 60) * 60),
    bis: Math.min(1440, Math.ceil((endeMin + 60) / 60) * 60),
  };
}

export function formatiereMinuten(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
