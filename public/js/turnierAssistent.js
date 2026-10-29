// Assistent in turnier.html: vier Seiten (Grunddaten, Wettkampf, Startgeld, Ausstattung) mit Schrittanzeige.
// Auf Seite 4 beantwortet man Fragen zur Ausstattung der Halle (src/shared/ausstattung.js); erst eine Ja-Antwort schaltet die
// passende Funktion frei. Beim Anlegen ist alles gesperrt, bis geantwortet ist. Beim Bearbeiten zeigen Fragen und Schalter den
// gespeicherten Stand: die Antworten lassen sich ändern, Funktionen ohne Antwort behalten ihren Stand.
// turnier.js liest Schalter und Antworten über window.TurnierAssistent und füllt sie über setzeFunktionen().
import {
    AUSSTATTUNG, bereinigeAntworten, offeneFragen, berechneSchalter, ermittleAbgewaehlt
} from '/js/shared/ausstattung.js';
import { normalisiereFunktionen } from '/js/shared/turnierFunktionen.js';

const params = new URLSearchParams(window.location.search);
const bearbeiten = !!(params.get('id') || params.get('turnierId'));
const anzahlSeiten = 4;

const formular = document.getElementById('turnierForm');
const seiten = [...document.querySelectorAll('.assistent-seite')];
const schritte = [...document.querySelectorAll('.assistent-schritt')];
const zurueckBtn = document.getElementById('assistentZurueck');
const weiterBtn = document.getElementById('assistentWeiter');
const hinweisEl = document.getElementById('assistentHinweis');
const speichernBtn = document.getElementById('submitBtn');
const veroeffentlichenBtn = document.getElementById('assistentVeroeffentlichen');
// Kopfleisten-Knopf, den turnier.js nur beim Anlegen in der Cloud einblendet (erst nach /api/config)
const veroeffentlichenKopfBtn = document.getElementById('speichernVeroeffentlichenBtn');

let aktuelleSeite = 1;
let antworten = {};
let abgewaehlt = {};
let gespeicherterStand = null; // Schalter beim Laden (JSON), zum Erkennen geänderter Funktionen
const SEITE_MERKEN = 'turnierAssistentSeite';

const schalterVon = (eintragId) => document.getElementById(eintragId === 'orga' ? 'planungs_tools' : `fkt_${eintragId}`);
const meldeAenderung = () => window.dispatchEvent(new CustomEvent('assistent:aenderung'));

// --- Seiten und Schrittanzeige ---

function seiteVon(element) {
    const seite = element.closest('.assistent-seite');
    return seite ? Number(seite.dataset.seite) : 1;
}

/** Prüft die Pflichtfelder von Seite 1 und zeigt die Meldung des Browsers am ersten fehlerhaften Feld. */
function grunddatenGueltig() {
    const ungueltig = seiten[0].querySelector(':invalid');
    if (!ungueltig) return true;
    zeigeSeite(1);
    ungueltig.reportValidity();
    return false;
}

function zeigeSeite(nummer) {
    aktuelleSeite = Math.min(anzahlSeiten, Math.max(1, nummer));
    seiten.forEach((seite) => { seite.hidden = Number(seite.dataset.seite) !== aktuelleSeite; });
    schritte.forEach((schritt) => {
        const n = Number(schritt.dataset.schritt);
        schritt.classList.toggle('aktiv', n === aktuelleSeite);
        schritt.classList.toggle('fertig', !bearbeiten && n < aktuelleSeite);
        if (n === aktuelleSeite) schritt.setAttribute('aria-current', 'step'); else schritt.removeAttribute('aria-current');
    });
    zurueckBtn.style.visibility = aktuelleSeite > 1 ? 'visible' : 'hidden';
    const letzte = aktuelleSeite === anzahlSeiten;
    const entwurf = /entwurf/i.test(speichernBtn ? speichernBtn.textContent : '');
    weiterBtn.textContent = letzte ? (bearbeiten ? 'Speichern' : (entwurf ? 'Als Entwurf speichern' : 'Turnier anlegen')) : 'Weiter';
    hinweisEl.textContent = letzte && bearbeiten ? 'Unbeantwortete Fragen ändern nichts.' : '';
    veroeffentlichenBtn.hidden = !(letzte && veroeffentlichenKopfBtn && veroeffentlichenKopfBtn.style.display !== 'none');
}

function geheZu(nummer) {
    if (nummer > aktuelleSeite && !grunddatenGueltig()) return;
    zeigeSeite(nummer);
    window.scrollTo({ top: 0 });
}

schritte.forEach((schritt) => schritt.addEventListener('click', () => geheZu(Number(schritt.dataset.schritt))));
zurueckBtn.addEventListener('click', () => geheZu(aktuelleSeite - 1));
weiterBtn.addEventListener('click', () => {
    if (aktuelleSeite < anzahlSeiten) { geheZu(aktuelleSeite + 1); return; }
    speichernBtn.click();
});

veroeffentlichenBtn.addEventListener('click', () => veroeffentlichenKopfBtn.click());
if (veroeffentlichenKopfBtn) {
    // Der Knopf in der Kopfleiste (und der Text von submitBtn "Als Entwurf speichern") erscheint erst nach dem Laden der Konfiguration
    new MutationObserver(() => zeigeSeite(aktuelleSeite)).observe(veroeffentlichenKopfBtn, { attributes: true, attributeFilter: ['style'] });
    if (speichernBtn) new MutationObserver(() => zeigeSeite(aktuelleSeite)).observe(speichernBtn, { childList: true, subtree: true, characterData: true });
}

// Pflichtfelder liegen auf Seite 1, andere Felder können auf einer ausgeblendeten Seite ungültig sein: statt der
// Browser-Prüfung (die dort nicht fokussieren kann) springt der Assistent selbst zum ersten fehlerhaften Feld.
formular.noValidate = true;
formular.addEventListener('submit', (ereignis) => {
    const ungueltig = formular.querySelector(':invalid');
    if (!ungueltig) return;
    ereignis.preventDefault();
    ereignis.stopImmediatePropagation();
    zeigeSeite(seiteVon(ungueltig));
    ungueltig.reportValidity();
});

// --- Ausstattung: Fragen ---

const fragenEl = document.getElementById('ausstattungFragen');
const zaehlerEl = document.getElementById('ausstattungZaehler');
const balkenEl = document.getElementById('ausstattungBalken');

const MARKE = { ja: ['check_circle', 'ja'], nein: ['cancel', 'nein'], offen: ['radio_button_unchecked', ''] };

function hinweisZu(frage) {
    if (frage.id !== 'wlan' || antworten.wlan !== 'nein') return '';
    const text = 'Ohne WLAN entfallen Internet, Teilnehmer-App und Live-Streaming.'
        + (antworten.pc === 'ja' ? ' Die Geräte werden per Kabel mit dem Hallen-Server verbunden.' : '');
    return `<div class="frage-hinweis">${text}</div>`;
}

function zeichneFragen() {
    const { fragen, beantwortet } = offeneFragen(antworten);
    fragenEl.innerHTML = fragen.map((frage) => {
        const antwort = antworten[frage.id];
        const [symbol, klasse] = MARKE[antwort] || MARKE.offen;
        const knopf = (wert, text, icon) => `<button type="button" class="${wert}" data-frage="${frage.id}" data-antwort="${wert}" aria-pressed="${antwort === wert}">${antwort === wert ? `<span class="material-icons" aria-hidden="true">${icon}</span>` : ''}${text}</button>`;
        return `<div class="frage${frage.folgeVon ? ' folge' : ''}"><span class="material-icons frage-marke ${klasse}" aria-hidden="true">${symbol}</span>`
            + `<div class="frage-text">${frage.text}${frage.hinweis ? `<small>${frage.hinweis}</small>` : ''}</div>`
            + `<div class="frage-antworten" role="group" aria-label="${frage.text}">${knopf('ja', 'Ja', 'check')}${knopf('nein', 'Nein', 'close')}</div></div>${hinweisZu(frage)}`;
    }).join('');
    zaehlerEl.textContent = `${beantwortet} von ${fragen.length} Fragen beantwortet`;
    balkenEl.style.width = `${fragen.length ? Math.round((beantwortet / fragen.length) * 100) : 0}%`;
}

// --- Funktionen: Schalter ---

/** Aktueller Stand der Schalter je Funktion (beim Bearbeiten bleibt er für Funktionen ohne Antwort erhalten). */
function leseSchalter() {
    return Object.fromEntries(AUSSTATTUNG.map((eintrag) => [eintrag.id, schalterVon(eintrag.id).checked]));
}

function zeichneSchalter() {
    const schalter = berechneSchalter(antworten, { abgewaehlt, bisher: bearbeiten ? leseSchalter() : null });
    for (const eintrag of AUSSTATTUNG) {
        const werte = schalter[eintrag.id];
        const feld = schalterVon(eintrag.id);
        feld.checked = werte.an;
        feld.disabled = !werte.aktiv;
        feld.closest('.fkt-zeile').classList.toggle('gesperrt', !werte.aktiv);
    }
}

function zeichne() {
    zeichneFragen();
    zeichneSchalter();
}

fragenEl.addEventListener('click', (ereignis) => {
    const knopf = ereignis.target.closest('button[data-frage]');
    if (!knopf) return;
    antworten = bereinigeAntworten({ ...antworten, [knopf.dataset.frage]: knopf.dataset.antwort });
    abgewaehlt = {};
    zeichne();
    meldeAenderung();
});

document.getElementById('ausstattungZuruecksetzen').addEventListener('click', () => {
    antworten = {};
    abgewaehlt = {};
    zeichne();
    meldeAenderung();
});

// Einzelne Funktion trotz Ja wieder abschalten (oder erneut einschalten); Live-Streaming folgt der Videoaufnahme
document.getElementById('funktionenListe').addEventListener('change', (ereignis) => {
    const zeile = ereignis.target.closest('.fkt-zeile');
    if (!zeile) return;
    const id = zeile.dataset.fkt;
    if (antworten[AUSSTATTUNG.find((e) => e.id === id).frage] === 'ja') {
        abgewaehlt = { ...abgewaehlt, [id]: !ereignis.target.checked };
    }
    zeichneSchalter();
    meldeAenderung();
});

// --- Schnittstelle zu turnier.js ---

window.TurnierAssistent = {
    bearbeiten,
    zeigeSeite,
    /** Aktueller Stand der Schalter für den Request-Body (planungs_tools und funktionen). */
    liesFunktionen() {
        const funktionen = {};
        for (const eintrag of AUSSTATTUNG) {
            if (eintrag.id !== 'orga') funktionen[eintrag.id] = schalterVon(eintrag.id).checked;
        }
        return { planungs_tools: schalterVon('orga').checked, funktionen };
    },
    /** Wurden Schalter seit dem Laden bzw. letzten Speichern geändert? */
    funktionenGeaendert() {
        const jetzt = JSON.stringify(this.liesFunktionen());
        const geaendert = jetzt !== gespeicherterStand;
        if (geaendert) gespeicherterStand = jetzt;
        return geaendert;
    },
    /** Vor dem Neuladen nach dem Speichern: aktuelle Seite merken, damit der Assistent dort weitermacht. */
    merkeSeite() {
        try { sessionStorage.setItem(SEITE_MERKEN, String(aktuelleSeite)); } catch { /* ohne Speicher beginnt der Assistent auf Seite 1 */ }
    },
    /** Aktuelle Antworten des Fragebogens für den Request-Body. */
    liesAusstattung() {
        return { ...antworten };
    },
    /** Bearbeiten: gespeicherte Antworten und Schalter übernehmen. */
    setzeFunktionen(turnier) {
        const gespeichert = { orga: turnier.planungs_tools !== false, ...normalisiereFunktionen(turnier.funktionen) };
        antworten = bereinigeAntworten(turnier.ausstattung);
        abgewaehlt = ermittleAbgewaehlt(antworten, gespeichert);
        for (const eintrag of AUSSTATTUNG) schalterVon(eintrag.id).checked = !!gespeichert[eintrag.id];
        zeichne();
        // Stand laut Datenbank (nicht der durch Sperren geänderte Anzeigestand) als Vergleich für funktionenGeaendert()
        const { orga, ...funktionen } = gespeichert;
        gespeicherterStand = JSON.stringify({ planungs_tools: orga, funktionen });
    }
};

zeichne();
let startSeite = 1;
if (bearbeiten) {
    try {
        startSeite = Number(sessionStorage.getItem(SEITE_MERKEN)) || 1;
        sessionStorage.removeItem(SEITE_MERKEN);
    } catch { /* ohne Speicher beginnt der Assistent auf Seite 1 */ }
}
zeigeSeite(startSeite);
