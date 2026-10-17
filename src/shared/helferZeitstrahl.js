// Layout und Ziehen auf dem Zeitstrahl des Helferplans (helfer-plan.html). Rein: kein DOM, keine DB.
// Zeiten sind Minuten seit 00:00, der Bereich { von, bis } kommt aus zeitstrahlBereich() (helferZeit.js).
import { MIN_LAENGE, rasterRunde, ueberlappt, STANDARD_SLOT } from './helferZeit.js';

/** Position einer Uhrzeit im Bereich in Prozent (0 = linker Rand, 100 = rechter Rand). */
export function minutenZuProzent(min, bereich) {
  const spanne = bereich.bis - bereich.von;
  if (spanne <= 0) return 0;
  return ((min - bereich.von) / spanne) * 100;
}

/** Mausweg in Pixeln -> Minuten, auf das 15-Minuten-Raster gerundet. */
export function pixelZuMinuten(deltaPx, breitePx, bereich) {
  if (!(breitePx > 0)) return 0;
  return rasterRunde((deltaPx / breitePx) * (bereich.bis - bereich.von)) || 0; // -0 -> 0
}

// Nächste Grenzen links/rechts des Slots: Bereichsrand oder Nachbar-Slot.
function grenzen(slot, bereich, nachbarn) {
  let links = bereich.von;
  let rechts = bereich.bis;
  for (const n of nachbarn) {
    if (n.bis_min <= slot.von_min) links = Math.max(links, n.bis_min);
    if (n.von_min >= slot.bis_min) rechts = Math.min(rechts, n.von_min);
  }
  return { links, rechts };
}

function gueltig(slot, bereich, nachbarn) {
  return slot.von_min >= bereich.von && slot.bis_min <= bereich.bis
    && slot.bis_min - slot.von_min >= MIN_LAENGE
    && !nachbarn.some(n => ueberlappt(n, slot));
}

const klemme = (wert, min, max) => Math.min(Math.max(wert, min), max);

/**
 * Neuer Zeitraum eines Slots beim Ziehen: 'links'/'rechts' ändern Beginn/Ende, 'mitte' verschiebt.
 * Der Schritt wird auf das Raster gerundet; der Slot hält an Nachbarn und Bereichsrand an und unterschreitet
 * nie die Mindestlänge. Ist kein gültiger Zeitraum möglich, kommt der Slot unverändert (als Kopie) zurück.
 * @param {{von_min:number,bis_min:number}} slot
 * @param {'links'|'rechts'|'mitte'} modus
 * @param {number} deltaMin
 * @param {{von:number,bis:number}} bereich
 * @param {Array<{von_min:number,bis_min:number}>} nachbarn - die übrigen Slots der Zeile
 */
export function ziehe(slot, modus, deltaMin, bereich, nachbarn = []) {
  const unveraendert = { von_min: slot.von_min, bis_min: slot.bis_min };
  const delta = rasterRunde(Number(deltaMin) || 0);
  const { links, rechts } = grenzen(slot, bereich, nachbarn);
  let neu;
  if (modus === 'rechts') {
    neu = { von_min: slot.von_min, bis_min: klemme(slot.bis_min + delta, slot.von_min + MIN_LAENGE, rechts) };
  } else if (modus === 'links') {
    neu = { von_min: klemme(slot.von_min + delta, links, slot.bis_min - MIN_LAENGE), bis_min: slot.bis_min };
  } else if (modus === 'mitte') {
    const laenge = slot.bis_min - slot.von_min;
    if (rechts - laenge < links) return unveraendert;
    const von = klemme(slot.von_min + delta, links, rechts - laenge);
    neu = { von_min: von, bis_min: von + laenge };
  } else {
    return unveraendert;
  }
  return gueltig(neu, bereich, nachbarn) ? neu : unveraendert;
}

/** Farbe eines Slots: 'ok' (besetzt), 'teil' (teilweise), 'leer' (offen). */
export function slotZustand(eingetragen, bedarf) {
  if (eingetragen >= bedarf) return 'ok';
  return eingetragen > 0 ? 'teil' : 'leer';
}

/**
 * Doppelklick bei `minuten` auf freie Fläche: Slot ab der vollen Stunde (bzw. ab dem Ende des linken Nachbarn),
 * 120 Minuten lang, gekürzt vor dem rechten Nachbarn oder dem Bereichsende. Unter 30 Minuten, in einem
 * vorhandenen Slot oder außerhalb des Bereichs -> null.
 */
export function freiePositionFuerNeuenSlot(minuten, nachbarn, bereich) {
  if (!(minuten >= bereich.von && minuten < bereich.bis)) return null;
  if (nachbarn.some(n => n.von_min <= minuten && minuten < n.bis_min)) return null;
  const { links, rechts } = grenzen({ von_min: minuten, bis_min: minuten }, bereich, nachbarn);
  const von = Math.max(Math.floor(minuten / 60) * 60, links);
  const bis = Math.min(von + STANDARD_SLOT, rechts);
  return bis - von >= MIN_LAENGE ? { von_min: von, bis_min: bis } : null;
}
