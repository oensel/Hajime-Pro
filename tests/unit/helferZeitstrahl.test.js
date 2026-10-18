import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutenZuProzent, pixelZuMinuten, ziehe, slotZustand, freiePositionFuerNeuenSlot,
} from '../../src/shared/helferZeitstrahl.js';

const bereich = { von: 480, bis: 1080 }; // 08:00–18:00, 600 Minuten

test('minutenZuProzent: Anfang, Mitte, Ende des Bereichs', () => {
  assert.equal(minutenZuProzent(480, bereich), 0);
  assert.equal(minutenZuProzent(780, bereich), 50);
  assert.equal(minutenZuProzent(1080, bereich), 100);
  assert.equal(minutenZuProzent(540, bereich), 10);
});

test('pixelZuMinuten: rechnet Pixel in Minuten um und rundet auf das 15-Minuten-Raster', () => {
  // 600 px Breite für 600 Minuten: 1 px = 1 Minute
  assert.equal(pixelZuMinuten(30, 600, bereich), 30);
  assert.equal(pixelZuMinuten(22, 600, bereich), 15);
  assert.equal(pixelZuMinuten(7, 600, bereich), 0);
  assert.equal(pixelZuMinuten(-38, 600, bereich), -45);
  assert.equal(pixelZuMinuten(-5, 600, bereich), 0);
  assert.equal(pixelZuMinuten(10, 0, bereich), 0);
});

test('ziehe rechts: verkürzt und verlängert im Raster', () => {
  const slot = { von_min: 540, bis_min: 660 };
  assert.deepEqual(ziehe(slot, 'rechts', -30, bereich, []), { von_min: 540, bis_min: 630 });
  assert.deepEqual(ziehe(slot, 'rechts', 45, bereich, []), { von_min: 540, bis_min: 705 });
  // nicht im Raster -> gerundet
  assert.deepEqual(ziehe(slot, 'rechts', -20, bereich, []), { von_min: 540, bis_min: 645 });
});

test('ziehe hält die Mindestlänge 30 beim Verkleinern', () => {
  const slot = { von_min: 540, bis_min: 660 };
  assert.deepEqual(ziehe(slot, 'rechts', -120, bereich, []), { von_min: 540, bis_min: 570 });
  assert.deepEqual(ziehe(slot, 'links', 200, bereich, []), { von_min: 630, bis_min: 660 });
  // schon auf Mindestlänge: bleibt unverändert
  const kurz = { von_min: 540, bis_min: 570 };
  assert.deepEqual(ziehe(kurz, 'rechts', -15, bereich, []), kurz);
});

test('ziehe mitte: verschiebt in 15er-Schritten, Länge bleibt', () => {
  const slot = { von_min: 540, bis_min: 660 };
  assert.deepEqual(ziehe(slot, 'mitte', 15, bereich, []), { von_min: 555, bis_min: 675 });
  assert.deepEqual(ziehe(slot, 'mitte', -60, bereich, []), { von_min: 480, bis_min: 600 });
  assert.deepEqual(ziehe(slot, 'mitte', 8, bereich, []), { von_min: 555, bis_min: 675 });
  assert.deepEqual(ziehe(slot, 'mitte', 7, bereich, []), slot);
});

test('ziehe stößt an den Nachbarn an', () => {
  const slot = { von_min: 540, bis_min: 660 };
  const nachbarn = [{ von_min: 480, bis_min: 510 }, { von_min: 720, bis_min: 840 }];
  assert.deepEqual(ziehe(slot, 'rechts', 120, bereich, nachbarn), { von_min: 540, bis_min: 720 });
  assert.deepEqual(ziehe(slot, 'links', -60, bereich, nachbarn), { von_min: 510, bis_min: 660 });
  assert.deepEqual(ziehe(slot, 'mitte', 300, bereich, nachbarn), { von_min: 600, bis_min: 720 });
  assert.deepEqual(ziehe(slot, 'mitte', -300, bereich, nachbarn), { von_min: 510, bis_min: 630 });
});

test('ziehe stößt an den Bereichsrand an', () => {
  const slot = { von_min: 960, bis_min: 1050 };
  assert.deepEqual(ziehe(slot, 'rechts', 120, bereich, []), { von_min: 960, bis_min: 1080 });
  assert.deepEqual(ziehe(slot, 'mitte', 120, bereich, []), { von_min: 990, bis_min: 1080 });
  const frueh = { von_min: 495, bis_min: 600 };
  assert.deepEqual(ziehe(frueh, 'links', -60, bereich, []), { von_min: 480, bis_min: 600 });
});

test('ziehe: ungültiger Schritt lässt den Slot unverändert', () => {
  // liegt schon am Nachbarn an
  const slot = { von_min: 540, bis_min: 660 };
  const nachbarn = [{ von_min: 660, bis_min: 780 }];
  assert.deepEqual(ziehe(slot, 'rechts', 60, bereich, nachbarn), slot);
  assert.deepEqual(ziehe(slot, 'mitte', 60, bereich, nachbarn), slot);
  // liegt schon am Bereichsrand an
  const rand = { von_min: 960, bis_min: 1080 };
  assert.deepEqual(ziehe(rand, 'mitte', 30, bereich, []), rand);
  // springt nicht über einen Nachbarn hinweg, sondern hält an ihm
  const lang = { von_min: 720, bis_min: 840 };
  assert.deepEqual(ziehe(lang, 'mitte', -200, bereich, [{ von_min: 600, bis_min: 700 }]), { von_min: 700, bis_min: 820 });
  // unbekannter Modus
  assert.deepEqual(ziehe(slot, 'oben', 30, bereich, []), slot);
  // liefert eine Kopie, nicht das Original
  assert.notEqual(ziehe(slot, 'rechts', 0, bereich, []), slot);
});

test('slotZustand: leer, teil, ok', () => {
  assert.equal(slotZustand(0, 2), 'leer');
  assert.equal(slotZustand(1, 2), 'teil');
  assert.equal(slotZustand(2, 2), 'ok');
  assert.equal(slotZustand(3, 2), 'ok');
});

test('freiePositionFuerNeuenSlot: Stunde abrunden, 120 Minuten, vor dem Nachbarn gekürzt', () => {
  assert.deepEqual(freiePositionFuerNeuenSlot(570, [{ von_min: 600, bis_min: 720 }], bereich), { von_min: 540, bis_min: 600 });
  assert.deepEqual(freiePositionFuerNeuenSlot(570, [], bereich), { von_min: 540, bis_min: 660 });
  // am Bereichsende gekürzt
  assert.deepEqual(freiePositionFuerNeuenSlot(1030, [], bereich), { von_min: 1020, bis_min: 1080 });
  // beginnt erst nach dem linken Nachbarn
  assert.deepEqual(freiePositionFuerNeuenSlot(560, [{ von_min: 480, bis_min: 555 }], bereich), { von_min: 555, bis_min: 675 });
});

test('freiePositionFuerNeuenSlot: zu wenig Platz oder belegt -> null', () => {
  // nur 15 Minuten frei
  assert.equal(freiePositionFuerNeuenSlot(550, [{ von_min: 480, bis_min: 540 }, { von_min: 555, bis_min: 700 }], bereich), null);
  // Klick in einen vorhandenen Slot
  assert.equal(freiePositionFuerNeuenSlot(620, [{ von_min: 600, bis_min: 720 }], bereich), null);
  // außerhalb des Bereichs
  assert.equal(freiePositionFuerNeuenSlot(400, [], bereich), null);
  assert.equal(freiePositionFuerNeuenSlot(1100, [], bereich), null);
});
