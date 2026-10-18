// Mitgelieferte Standardvorlage des Orga-Planers (Code, kein Datenbankbestand).
// Reihenfolge im Array = Reihenfolge innerhalb der Phase. frist_tage: negativ = vorher.
// Ein Eintrag mit `posten` wird zur Aufgabe mit Unteraufgaben (art 'posten'),
// `mitbringliste: true` legt zusätzlich die Mitbringliste (art 'mitbringen') an.

export const ORGA_PHASEN = ['grundlage', 'vorbereitung', 'meldephase', 'turniertag', 'nachbereitung'];

const a = (vorlage_key, phase, titel, frist_anker, frist_tage, rest = {}) =>
  ({ vorlage_key, phase, titel, art: 'aufgabe', frist_anker, frist_tage, ...rest });
const p = (titel, menge) => (menge === undefined ? { titel } : { titel, menge });

export const ORGA_VORLAGE = [
  // Grundlage
  a('grundlage_halle', 'grundlage', 'Hallenzeiten reservieren', 'turnier', -240),

  // Vorbereitung
  a('ausschreibung', 'vorbereitung', 'Ausschreibung erstellen und versenden', 'turnier', -56, { link: 'turnier' }),
  a('genehmigung', 'vorbereitung', 'Genehmigung beim Landesverband', 'turnier', -49),
  a('medaillen', 'vorbereitung', 'Medaillen und Pokale', 'turnier', -30, {
    posten: [p('Medaillen und Pokale bestellen'), p('Bedrucken lassen'), p('Abholen'), p('Mengen prüfen')],
  }),
  a('technik_bereitstellen', 'vorbereitung', 'Technik bereitstellen', 'turnier', -21, {
    posten: [
      p('Notebooks Matte'), p('Notebooks Waage'), p('Server'), p('WLAN-Router'),
      p('Mikrofon'), p('Lautsprecher'), p('TVs mit Halterung'), p('Drucker'),
      p('Urkundenpapier'), p('Mehrfachsteckdosen'), p('Verlängerungskabel'),
      p('Netzwerkkabel'), p('Kabeltrommeln'),
      // Annahmen laut Spec
      p('Ersatzakkus und Ladegeräte'), p('Gaffa-Tape'), p('Wiegekarten'),
      p('Stifte und Klemmbretter'), p('Waagen mit Prüfgewicht'), p('Tische und Stühle'),
      p('Beschilderung'), p('Müllsäcke'), p('Erste-Hilfe-Koffer'),
    ],
  }),
  a('helferbedarf', 'vorbereitung', 'Helferbedarf festlegen', 'turnier', -21, {
    auto_art: 'helferplan_gesamt', link: 'helferplan',
  }),

  // Meldephase (Anker Anmeldeschluss)
  a('mattenzahl', 'meldephase', 'Mattenzahl festlegen', 'anmeldeschluss', 0, { link: 'matten' }),
  a('kampfrichter', 'meldephase', 'Kampfrichter besetzt', 'anmeldeschluss', -7, {
    auto_art: 'helferplan_taetigkeit', auto_ref: 'kampfrichter', link: 'helferplan',
  }),
  a('ersthelfer', 'meldephase', 'Ersthelfer und Sanitäter besetzt', 'anmeldeschluss', -7, {
    auto_art: 'helferplan_taetigkeit', auto_ref: 'ersthelfer', link: 'helferplan',
  }),
  a('startgelder_nachverfolgen', 'meldephase', 'Startgelder nachverfolgen', 'anmeldeschluss', -7),
  a('catering', 'meldephase', 'Catering einkaufen', 'anmeldeschluss', -2, {
    posten: [
      p('Kaffeemaschinen'), p('Wasser'), p('Cola'), p('Saft'),
      p('Grillfleisch'), p('Brötchen'), p('Getränkekisten'),
    ],
    mitbringliste: true,
  }),

  // Turniertag
  a('aufbau', 'turniertag', 'Aufbau der Matten und Tribünen', 'turnier', 0, {
    auto_art: 'helferplan_taetigkeit', auto_ref: 'aufbau', link: 'helferplan',
  }),
  a('technik_aufbauen', 'turniertag', 'Technik aufbauen', 'turnier', 0),
  a('bistro_kasse', 'turniertag', 'Bistro und Kasse eröffnen', 'turnier', 0),
  a('kampfrichter_besprechung', 'turniertag', 'Kampfrichter-Besprechung', 'turnier', 0),
  a('wiegen', 'turniertag', 'Wiegen', 'turnier', 0, { link: 'waage' }),
  a('pools_erstellen', 'turniertag', 'Pools erstellen', 'turnier', 0, { link: 'pools' }),
  a('siegerehrung', 'turniertag', 'Siegerehrung', 'turnier', 0, { link: 'siegerliste' }),
  a('abbau', 'turniertag', 'Abbau und Reinigung', 'turnier', 0),

  // Nachbereitung
  a('ergebnisse_verband', 'nachbereitung', 'Ergebnisse an den Verband übermitteln', 'turnier', 1),
  a('ergebnisliste', 'nachbereitung', 'Ergebnisliste veröffentlichen', 'turnier', 1, { link: 'siegerliste' }),
  a('spesen', 'nachbereitung', 'Spesen auszahlen', 'turnier', 2),
  a('bistro_abrechnen', 'nachbereitung', 'Bistro-Kasse abrechnen', 'turnier', 2),
  a('startgelder_abrechnen', 'nachbereitung', 'Startgelder abrechnen', 'turnier', 3),
  a('dankesmail', 'nachbereitung', 'Dankesmail an Helfer, Spender und Kampfrichter', 'turnier', 3),
];
