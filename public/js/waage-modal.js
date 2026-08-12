// Popup zum Anlegen/Bearbeiten eines Teilnehmers (inkl. QR-Scan), eingebettet in teilnehmer.html.
// Ehemals eigene Seite waage.html — Formularlogik und Feld-/Klassenermittlung unverändert
// übernommen, nur der Navigations-/Ladezyklus wurde auf ein Modal umgestellt.
import { initialisiereScanner } from './qr-scanner.js';

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('turnierId') || urlParams.get('id');
    if (!turnierId) return;

    const modal = document.getElementById('waageModal');
    if (!modal) return;

    // --- BERECHTIGUNGEN: nur der ausrichtende Verein (bzw. Offline-Betrieb) darf Judopass-Nr.,
    // Lizenzdatum und Gewicht am Wiegetisch verbindlich erfassen; Lizenzdatum und Startgeld-Status
    // sind zusätzlich für den Super-Admin freigegeben (er kann fachlich prüfen, auch ohne
    // Mitglied des Ausrichters zu sein). Andere Vereine melden ihre Athleten ohne diese Angaben an
    // — die eigentliche Prüfung erfolgt ohnehin erst beim Einwiegen durch den Ausrichter.
    let istGastgeberVerein = false;
    let istPrivilegiertFuerLizenzUndStartgeld = false;
    let aktuellerVereinName = '';

    const ermittleBerechtigungen = async () => {
        try {
            const [meResp, turnierResp, configResp] = await Promise.all([
                fetch('/api/auth/me'),
                fetch(`/api/turniere/${turnierId}`),
                fetch('/api/config')
            ]);
            if (!meResp.ok) return;
            const user = (await meResp.json()).user;
            const turnier = turnierResp.ok ? await turnierResp.json() : null;
            const istOffline = configResp.ok && !!(await configResp.json()).isOffline;

            istGastgeberVerein = istOffline || !!(user.verein_id && user.verein_freigegeben && turnier && turnier.verein_id === user.verein_id);
            istPrivilegiertFuerLizenzUndStartgeld = istGastgeberVerein || !!user.ist_super_admin;
            aktuellerVereinName = user.verein_name || '';
        } catch (err) {
            console.error('Fehler beim Ermitteln der Bearbeitungsrechte:', err);
        }
    };

    // Verein-Feld für Nicht-Ausrichter: immer der eigene (aktive) Verein, nicht änderbar — deckt
    // sich mit der serverseitigen Regel in teilnehmerController.js (verein !== userVereinName wird
    // dort ohnehin abgelehnt). Zentrale Stelle statt direkter .value-Zuweisungen, damit weder
    // Formular-Reset noch QR-Scan noch das Laden eines Bestandsdatensatzes das Feld umgehen können.
    const setzeVereinFeldWert = (wert) => {
        const feld = document.getElementById('verein');
        if (!feld) return;
        feld.value = istGastgeberVerein ? (wert || '') : aktuellerVereinName;
    };

    // Wendet die Berechtigungen auf die Formularfelder an — nach dem initialen Laden sowie nach
    // jedem Reset/Neubefüllen, da form.reset() bzw. das Befüllen mit Bestandsdaten die Felder
    // sonst wieder auf ihren HTML-Ausgangszustand (Verein leer, Lizenz aktivierbar) zurücksetzen
    // würde. Die disabled-Flags selbst bleiben davon unberührt (form.reset() rührt sie nicht an).
    const wendeBerechtigungenAufFormularAn = () => {
        const vereinFeld = document.getElementById('verein');
        const lizenzFeld = document.getElementById('lizenz_ablauf');
        const startgeldRow = document.getElementById('startgeldBezahltRow');

        if (vereinFeld) {
            vereinFeld.disabled = !istGastgeberVerein;
            if (!istGastgeberVerein) vereinFeld.value = aktuellerVereinName;
        }
        if (lizenzFeld) lizenzFeld.disabled = !istPrivilegiertFuerLizenzUndStartgeld;
        if (startgeldRow) startgeldRow.style.display = istPrivilegiertFuerLizenzUndStartgeld ? '' : 'none';
    };

    // --- STRIKTE FORMULAR- UND LIZENZVALIDIERUNG ---
    const aktualisiereSpeicherButtonStatus = () => {
        const submitBtn = document.getElementById('submitBtn');
        const lizenzFeld = document.getElementById('lizenz_ablauf');

        const immerPflicht = ['vorname', 'nachname', 'geburtsjahr', 'geschlecht', 'altersklasse', 'gewichtsklasse'];
        // judopass_id, lizenz_ablauf und gewicht sind nur für den ausrichtenden Verein Pflicht.
        const felder = istGastgeberVerein
            ? [...immerPflicht, 'judopass_id', 'lizenz_ablauf', 'gewicht']
            : immerPflicht;

        const alleFelderGefuellt = felder.every(id => {
            const el = document.getElementById(id);
            return el && el.value.trim() !== '';
        });

        // Die Gültigkeitsprüfung der Lizenz greift nur, wenn das Feld überhaupt Pflicht ist —
        // sonst würde das für andere Vereine leere, deaktivierte Feld das Speichern blockieren.
        const lizenzOk = !istGastgeberVerein || (lizenzFeld && lizenzFeld.classList.contains('lizenz-valid'));

        if (submitBtn) {
            // Bleibt immer sichtbar, ist nur ausgegraut (disabled), solange nicht speicherbar.
            submitBtn.disabled = !(alleFelderGefuellt && lizenzOk);
        }
    };

    const felderIDs = ['vorname', 'nachname', 'judopass_id', 'verein', 'geburtsjahr', 'geschlecht', 'gewicht', 'altersklasse', 'gewichtsklasse'];
    felderIDs.forEach(id => {
        const inputEl = document.getElementById(id);
        if (inputEl) {
            inputEl.addEventListener('input', aktualisiereSpeicherButtonStatus);
            inputEl.addEventListener('change', aktualisiereSpeicherButtonStatus);
        }
    });

    const lizenzFeldGlobal = document.getElementById('lizenz_ablauf');
    if (lizenzFeldGlobal) {
        const validiereLizenz = () => {
            const wert = lizenzFeldGlobal.value;
            if (!wert) {
                lizenzFeldGlobal.classList.remove('lizenz-valid', 'lizenz-expired');
                aktualisiereSpeicherButtonStatus();
                return;
            }

            const ablaufDatum = new Date(wert);
            ablaufDatum.setHours(0, 0, 0, 0);
            const heute = new Date();
            heute.setHours(0, 0, 0, 0);

            lizenzFeldGlobal.classList.remove('lizenz-valid', 'lizenz-expired');
            if (ablaufDatum >= heute) {
                lizenzFeldGlobal.classList.add('lizenz-valid');
            } else {
                lizenzFeldGlobal.classList.add('lizenz-expired');
            }
            aktualisiereSpeicherButtonStatus();
        };

        lizenzFeldGlobal.addEventListener('change', validiereLizenz);
        lizenzFeldGlobal.addEventListener('input', validiereLizenz);
    }

    // --- DJB-KLASSEN SPEICHER & LADEN LOGIK ---
    let djbKlassenZentrale = null;
    let turnierAltersklassen = null; // Schlüssel wie "männlich_U11" — vom Turnier aktivierte Klassen
    let wettkampfJahr = new Date().getFullYear();
    // Steuert die Sichtbarkeit des Team-Name-Felds (siehe teamNameRow in teilnehmer.html) — nur
    // bei Turnieren mit Mannschafts-Altersklassen ist eine Team-Zuordnung überhaupt möglich.
    let turnierHatMannschaftKlassen = false;
    const altersklasseSelect = document.getElementById('altersklasse');
    const gewichtsklasseSelect = document.getElementById('gewichtsklasse');
    const geschlechtsSelect = document.getElementById('geschlecht');

    const STANDARD_ALTERSKLASSEN_IDS = ['U9', 'U11', 'U13', 'U15', 'U18', 'U21', 'Männer', 'Frauen', 'Mixed'];

    // Liefert für ein Geschlecht die frei benannten Klassen (z.B. "U10", "Veteranen(Ü30)"),
    // die über den "+"-Button in turnier.html für dieses Turnier angelegt wurden.
    function ermittleFreieKlassen(gewaehltesGeschlecht) {
        if (!turnierAltersklassen) return [];
        return turnierAltersklassen
            .filter(k => k.startsWith(`${gewaehltesGeschlecht}_`) || k.startsWith('mixed_'))
            .map(k => k.slice(k.indexOf('_') + 1))
            .filter(id => !STANDARD_ALTERSKLASSEN_IDS.includes(id));
    }

    // Befüllt die Gewichtsklassen basierend auf der Altersklasse und wählt die passende Klasse automatisch aus
    const befehleGewichtsklassenDropdown = () => {
        if (!djbKlassenZentrale || !altersklasseSelect || !gewichtsklasseSelect || !geschlechtsSelect) return;

        const gewaehltesGeschlecht = geschlechtsSelect.value;
        const gewaehlteAltersklasseID = altersklasseSelect.value;

        const klassenFuerGeschlecht = djbKlassenZentrale[gewaehltesGeschlecht] || [];
        const selektierteKlasse = klassenFuerGeschlecht.find(k => k.id === gewaehlteAltersklasseID);

        gewichtsklasseSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';

        if (!selektierteKlasse || !selektierteKlasse.gewichtsklassen) {
            // Frei benannte Klasse ohne vordefinierte Gewichtsklassen-Liste: manuelle Eingabe anbieten.
            if (gewaehlteAltersklasseID) {
                const manuellOpt = document.createElement('option');
                manuellOpt.value = '__manuell__';
                manuellOpt.innerText = 'Gewichtsklasse manuell eingeben...';
                gewichtsklasseSelect.appendChild(manuellOpt);
            }
            aktualisiereSpeicherButtonStatus();
            return;
        }

        // Dropdown mit den Optionen befüllen
        selektierteKlasse.gewichtsklassen.forEach(gewicht => {
            const opt = document.createElement('option');
            opt.value = gewicht;
            opt.innerText = `${gewicht}kg`;
            gewichtsklasseSelect.appendChild(opt);
        });

        // AUTOMATISCHE VORAUSWAHL ANHAND DES GEWICHTS
        const gewichtsEingabe = document.getElementById('gewicht').value.trim();
        const aktuellesGewicht = parseFloat(gewichtsEingabe.replace(',', '.'));

        if (!isNaN(aktuellesGewicht) && aktuellesGewicht > 0) {
            let gefundeneKlasse = "";

            const plusKlasse = selektierteKlasse.gewichtsklassen.find(g => g.startsWith('+'));
            const minusKlassen = selektierteKlasse.gewichtsklassen
                .filter(g => g.startsWith('-'))
                .map(g => parseFloat(g.replace('-', '')))
                .sort((a, b) => a - b);

            const passendeMinusGrenze = minusKlassen.find(grenze => aktuellesGewicht <= grenze);

            if (passendeMinusGrenze) {
                gefundeneKlasse = `-${passendeMinusGrenze}`;
            } else if (plusKlasse) {
                gefundeneKlasse = plusKlasse;
            }

            if (gefundeneKlasse) {
                gewichtsklasseSelect.value = gefundeneKlasse;
            }
        }

        aktualisiereSpeicherButtonStatus();
    };

    // Befüllt die Altersklassen basierend auf dem Geschlecht
    const befehleAltersklassenDropdown = () => {
        if (!djbKlassenZentrale || !altersklasseSelect || !geschlechtsSelect) return;

        const gewaehltesGeschlecht = geschlechtsSelect.value;
        const klassenFuerGeschlecht = djbKlassenZentrale[gewaehltesGeschlecht] || [];

        altersklasseSelect.innerHTML = '<option value="" disabled selected hidden>Bitte wählen...</option>';
        if (gewichtsklasseSelect) {
            gewichtsklasseSelect.innerHTML = '<option value="" disabled selected hidden>Bitte Altersklasse wählen...</option>';
        }

        klassenFuerGeschlecht.forEach(klasse => {
            const key = `${gewaehltesGeschlecht}_${klasse.id}`;
            if (turnierAltersklassen && !turnierAltersklassen.includes(key) && !turnierAltersklassen.includes(klasse.id)) {
                return;
            }
            const opt = document.createElement('option');
            opt.value = klasse.id;
            opt.innerText = `${klasse.bezeichnung} (Jahrgänge: ${klasse.jahrgaenge})`;
            altersklasseSelect.appendChild(opt);
        });

        // Frei benannte Klassen dieses Turniers ergänzen (z.B. "U10" oder "Veteranen(Ü30)")
        ermittleFreieKlassen(gewaehltesGeschlecht).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.innerText = id;
            altersklasseSelect.appendChild(opt);
        });

        aktualisiereSpeicherButtonStatus();
    };

    // Automatische Altersklassen-Ermittlung anhand des Geburtsjahres. Bevorzugt die aktivierte
    // Standardklasse (Alterstabelle unverändert); ist diese nicht aktiviert, werden frei benannte
    // Klassen des Turniers geprüft: "U<Zahl>" (Alter < Zahl, kleinste Zahl gewinnt) und
    // "Ü<Zahl>"/"Veteranen" (Alter >= Zahl, ohne Zahl gilt "Veteranen" als Ü30; größte Zahl gewinnt).
    const bestimmeUndWaehleAltersklasse = () => {
        const geburtsjahrFeld = document.getElementById('geburtsjahr');

        if (!geburtsjahrFeld || !geburtsjahrFeld.value || !geschlechtsSelect || !geschlechtsSelect.value) {
            return;
        }

        const geburtsJahr = parseInt(geburtsjahrFeld.value, 10);
        const alter = wettkampfJahr - geburtsJahr;
        const geschlecht = geschlechtsSelect.value;

        let standardKandidat = "";
        if (alter >= 5 && alter <= 7) {
            standardKandidat = "U9";
        } else if (alter >= 8 && alter <= 10) {
            standardKandidat = "U11";
        } else if (alter >= 11 && alter <= 12) {
            standardKandidat = "U13";
        } else if (alter >= 13 && alter <= 14) {
            standardKandidat = "U15";
        } else if (alter >= 15 && alter <= 17) {
            standardKandidat = "U18";
        } else if (alter >= 18 && alter <= 20) {
            standardKandidat = "U21";
        } else if (alter > 20) {
            standardKandidat = geschlecht === 'weiblich' ? 'Frauen' : (geschlecht === 'mixed' ? 'Mixed' : 'Männer');
        }

        const istAktiviert = (id) => !turnierAltersklassen || turnierAltersklassen.includes(`${geschlecht}_${id}`) || turnierAltersklassen.includes(`mixed_${id}`);

        let ermittelteKlasseID = "";
        if (standardKandidat && istAktiviert(standardKandidat)) {
            ermittelteKlasseID = standardKandidat;
        } else if (turnierAltersklassen) {
            let besteUKlasse = null;
            let besteVeteranenKlasse = null;

            ermittleFreieKlassen(geschlecht).forEach(id => {
                const uMatch = id.match(/^U\s*(\d+)$/i);
                if (uMatch) {
                    const n = parseInt(uMatch[1], 10);
                    if (alter < n && (!besteUKlasse || n < besteUKlasse.n)) besteUKlasse = { id, n };
                    return;
                }
                const ueExplizit = id.match(/Ü\s*(\d+)/i);
                const istVeteranenName = /veteranen/i.test(id);
                if (ueExplizit || istVeteranenName) {
                    const n = ueExplizit ? parseInt(ueExplizit[1], 10) : 30;
                    if (alter >= n && (!besteVeteranenKlasse || n > besteVeteranenKlasse.n)) besteVeteranenKlasse = { id, n };
                }
            });

            if (besteUKlasse) {
                ermittelteKlasseID = besteUKlasse.id;
            } else if (besteVeteranenKlasse) {
                ermittelteKlasseID = besteVeteranenKlasse.id;
            }
            // Nichts Passendes gefunden: NICHT auf die (nicht aktivierte) Standardklasse
            // zurückfallen — das Turnier bietet sie nicht an.
        } else {
            ermittelteKlasseID = standardKandidat;
        }

        if (ermittelteKlasseID && altersklasseSelect) {
            altersklasseSelect.value = ermittelteKlasseID;
            befehleGewichtsklassenDropdown();
        }
    };

    const ladeDjbKlassenKonfiguration = async () => {
        try {
            const resp = await fetch('/api/djb-klassen');
            if (resp.ok) {
                djbKlassenZentrale = await resp.json();
            }

            try {
                const turnierResp = await fetch(`/api/turniere/${turnierId}`);
                if (turnierResp.ok) {
                    const turnier = await turnierResp.json();
                    if (turnier.datum) {
                        wettkampfJahr = new Date(turnier.datum).getFullYear();
                    }
                    if (turnier.altersklassen) {
                        let keys = [];
                        if (Array.isArray(turnier.altersklassen)) {
                            keys = turnier.altersklassen;
                        } else if (typeof turnier.altersklassen === 'object') {
                            keys = Object.keys(turnier.altersklassen);
                        }
                        // Leere Liste (Turnier trägt nur Mannschafts-, keine Einzel-Altersklassen
                        // aus) bedeutet "keine Einschränkung bekannt", nicht "keine Klasse erlaubt"
                        // — sonst bliebe das Altersklasse-Dropdown für solche Turniere komplett
                        // leer (siehe turnierAltersklassenKeys-Herleitung in teilnehmer.js für
                        // dieselbe Unterscheidung).
                        if (keys.length > 0) turnierAltersklassen = keys;
                    }

                    turnierHatMannschaftKlassen = Array.isArray(turnier.mannschafts_altersklassen) && turnier.mannschafts_altersklassen.length > 0;
                    const teamNameRow = document.getElementById('teamNameRow');
                    if (teamNameRow) teamNameRow.style.display = turnierHatMannschaftKlassen ? '' : 'none';
                }
            } catch (e) {
                console.error("Fehler beim Laden des Turniers für Altersklassen-Filter:", e);
            }

            geschlechtsSelect.addEventListener('change', () => {
                befehleAltersklassenDropdown();
                bestimmeUndWaehleAltersklasse();
            });

            const geburtsFeld = document.getElementById('geburtsjahr');
            geburtsFeld.addEventListener('change', bestimmeUndWaehleAltersklasse);
            geburtsFeld.addEventListener('input', bestimmeUndWaehleAltersklasse);

            const gewichtFeld = document.getElementById('gewicht');
            if (gewichtFeld) {
                gewichtFeld.addEventListener('input', befehleGewichtsklassenDropdown);
                gewichtFeld.addEventListener('change', befehleGewichtsklassenDropdown);
            }

            altersklasseSelect.addEventListener('change', befehleGewichtsklassenDropdown);

            // Manuelle Gewichtsklassen-Eingabe für frei benannte Altersklassen ohne vordefinierte Liste
            if (gewichtsklasseSelect) {
                gewichtsklasseSelect.addEventListener('change', async () => {
                    if (gewichtsklasseSelect.value !== '__manuell__') return;
                    const wert = window.zeigeTextEingabe
                        ? await window.zeigeTextEingabe('Gewichtsklasse eingeben', 'Gewichtsklasse', 'z.B. "-45" oder "+80"')
                        : prompt('Gewichtsklasse eingeben (z.B. "-45" oder "+80"):');
                    if (wert && wert.trim()) {
                        const manuellOpt = document.createElement('option');
                        manuellOpt.value = wert.trim();
                        manuellOpt.innerText = `${wert.trim()}kg`;
                        gewichtsklasseSelect.appendChild(manuellOpt);
                        gewichtsklasseSelect.value = wert.trim();
                    } else {
                        gewichtsklasseSelect.value = '';
                    }
                    aktualisiereSpeicherButtonStatus();
                });
            }
        } catch (err) {
            console.error("Fehler beim Laden der DJB-Konfiguration:", err);
        }
    };

    // --- GRADUIERUNGS-DROPDOWN BEFÜLLEN ---
    const ladeGraduierungenKonfiguration = async () => {
        try {
            const resp = await fetch('/api/graduierungen');
            if (!resp.ok) return;
            const liste = await resp.json();

            const select = document.getElementById('graduierung');
            if (!select) return;

            liste.forEach(grad => {
                const opt = document.createElement('option');
                opt.value = grad.id;
                opt.innerText = grad.label;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Fehler beim Laden der Graduierungs-Konfiguration:', err);
        }
    };

    // --- GEMEINSAME FORMULAR-BEFÜLLUNG (Editier-Modus & QR-Treffer) ---
    // Setzt nur die CSS-Klasse (gültig/abgelaufen) für die Lizenz, ohne Warnhinweis.
    const aktualisiereLizenzKlasse = (datumWert) => {
        const lizenzFeld = document.getElementById('lizenz_ablauf');
        if (!lizenzFeld) return;
        lizenzFeld.classList.remove('lizenz-valid', 'lizenz-expired');
        if (!datumWert) return;

        const ablaufDatum = new Date(datumWert);
        ablaufDatum.setHours(0, 0, 0, 0);
        const heute = new Date();
        heute.setHours(0, 0, 0, 0);

        if (ablaufDatum >= heute) {
            lizenzFeld.classList.add('lizenz-valid');
        } else {
            lizenzFeld.classList.add('lizenz-expired');
        }
    };

    // Befüllt sämtliche Formularfelder anhand eines bestehenden Teilnehmer-Datensatzes.
    const fuelleFormularFelder = (athlet) => {
        // Für den "Als gewogen markieren?"-Dialog beim Speichern gemerkt (siehe Submit-Handler
        // unten): nur eine TATSÄCHLICHE Gewichtsänderung soll überhaupt nachfragen.
        urspruenglichesGewicht = athlet.gewicht || null;

        document.getElementById('vorname').value = athlet.vorname || '';
        document.getElementById('nachname').value = athlet.nachname || '';
        document.getElementById('judopass_id').value = athlet.judopass_id || athlet.judopassId || '';
        setzeVereinFeldWert(athlet.verein);
        document.getElementById('geburtsjahr').value = athlet.geburtsjahr || '';
        document.getElementById('graduierung').value = athlet.graduierung || '';

        if (athlet.gewicht) {
            document.getElementById('gewicht').value = athlet.gewicht.toString().replace('.', ',');
        }

        if (athlet.geschlecht) {
            document.getElementById('geschlecht').value = athlet.geschlecht;
            befehleAltersklassenDropdown();
        }
        if (athlet.altersklasse) {
            document.getElementById('altersklasse').value = athlet.altersklasse;
            befehleGewichtsklassenDropdown();
        } else if (athlet.geschlecht && athlet.geburtsjahr) {
            // Noch keine Altersklasse gesetzt (z.B. importierter Teilnehmer):
            // anhand von Geburtsjahr + Geschlecht automatisch vorauswählen.
            bestimmeUndWaehleAltersklasse();
        }
        if (athlet.gewichtsklasse) {
            document.getElementById('gewichtsklasse').value = athlet.gewichtsklasse;
        }

        document.getElementById('lizenz_ablauf').value = athlet.lizenz_ablauf || '';
        aktualisiereLizenzKlasse(athlet.lizenz_ablauf);

        const startgeldCheckbox = document.getElementById('startgeld_bezahlt');
        if (startgeldCheckbox) {
            startgeldCheckbox.checked = !!athlet.startgeld_bezahlt;
        }
    };

    // Befüllt das Team-Name-Feld mit der aktuellen Mannschafts-Zuordnung eines bestehenden
    // Teilnehmers (leer, falls (noch) keiner Mannschaft zugeordnet). Nutzt bewusst dieselbe
    // /api/mannschaften-Quelle wie teamInfoByTeilnehmerId in teilnehmer.js, statt sich auf das
    // reine Import-Merkmal fuer_mannschaft zu verlassen — das wäre nur eine Absichtserklärung
    // ohne echte Team-Zuordnung.
    const befuelleTeamNameFeld = async (teilnehmerId) => {
        const feld = document.getElementById('mannschaft_name');
        if (!feld) return;
        feld.value = '';
        if (!turnierHatMannschaftKlassen || !teilnehmerId) return;

        try {
            const resp = await fetch(`/api/mannschaften?turnierId=${turnierId}`);
            if (!resp.ok) return;
            const teams = await resp.json();
            const eigenesTeam = (Array.isArray(teams) ? teams : []).find(t =>
                (t.mitglieder || []).some(m => m.turnier_teilnehmer_id === parseInt(teilnehmerId))
            );
            if (eigenesTeam) feld.value = eigenesTeam.bezeichnung;
        } catch (err) {
            console.error('Fehler beim Laden der Mannschafts-Zuordnung:', err);
        }
    };

    // Setzt "Lizenz gültig bis" aus einem gescannten QR-Wert (inkl. Warnhinweis bei Ablauf).
    // Nur relevant, wenn das Feld überhaupt bearbeitet werden darf (siehe istPrivilegiertFuer-
    // LizenzUndStartgeld) — sonst würde ein QR-Scan die Sperre umgehen.
    const setzeLizenzAusScan = (wert, anzeigeName = '') => {
        const lizenzFeld = document.getElementById('lizenz_ablauf');
        if (!wert || !lizenzFeld || !istPrivilegiertFuerLizenzUndStartgeld) return;
        lizenzFeld.value = wert;
        aktualisiereLizenzKlasse(wert);
        if (lizenzFeld.classList.contains('lizenz-expired')) {
            alert(`Achtung: Die Lizenz${anzeigeName ? ' von ' + anzeigeName : ''} ist abgelaufen! Speichern blockiert.`);
        }
    };

    // ID des im Editier-Modus bearbeiteten Teilnehmers bzw. des per QR-Scan gefundenen
    // Bestandsteilnehmers (für PUT statt POST beim Speichern).
    let editId = null;
    let scanMatchedId = null;

    // Für den "Als gewogen markieren?"-Dialog beim Speichern (siehe Submit-Handler unten):
    // urspruenglichesGewicht ist der beim Öffnen des Modals geladene Ausgangswert (null bei einer
    // komplett neuen Person), letzteAenderungViaScan markiert, dass der aktuelle Datensatz gerade
    // per QR-Scan aufgerufen wurde — dann entfällt die Rückfrage (siehe Anforderung).
    let urspruenglichesGewicht = null;
    let letzteAenderungViaScan = false;

    // Extrahiert das Geburtsjahr aus einem gescannten Wert — akzeptiert ein volles Datum (z.B.
    // "2012-05-01" aus einem DokuMe-Judopass-QR) ebenso wie eine bereits reine Jahreszahl.
    const ermittleJahrAusWert = (wert) => {
        const str = String(wert || '').trim();
        const jahresMatch = str.match(/^\d{4}/);
        return jahresMatch ? jahresMatch[0] : '';
    };

    // --- QR-DATA-MAPPING & WEBCAM INTERFACE ---
    const verarbeiteGescannteDaten = async (parsedData, istDokuMe) => {
        // Ob Treffer oder Neuanlage: der Judoka stand gerade physisch am Scanner -> beim
        // Speichern entfällt die "Als gewogen markieren?"-Rückfrage (siehe Submit-Handler unten).
        letzteAenderungViaScan = true;

        // Gescannte Daten in ein einheitliches Format überführen
        let scanVorname = '', scanNachname = '', scanJudopassId = '', scanGeburtsjahr = '', scanLizenzAblauf = '', scanVerein = '';

        if (istDokuMe) {
            scanVorname = parsedData.FN || '';
            scanNachname = parsedData.LN || '';
            scanJudopassId = parsedData.NO || '';
            scanGeburtsjahr = ermittleJahrAusWert(parsedData.DOB);
            scanVerein = parsedData.TM || '';
            if (parsedData.exp) {
                scanLizenzAblauf = new Date(parsedData.exp * 1000).toISOString().split('T')[0];
            }
        } else {
            scanVorname = parsedData.vorname || '';
            scanNachname = parsedData.nachname || '';
            scanJudopassId = parsedData.judopass_id || parsedData.judopassId || '';
            scanGeburtsjahr = ermittleJahrAusWert(parsedData.geburtsjahr || parsedData.geburtsdatum);
            scanVerein = parsedData.verein || '';
            scanLizenzAblauf = parsedData.lizenz_ablauf || '';
        }

        // --- ABGLEICH MIT BEREITS VORHANDENEN TEILNEHMERN DES TURNIERS ---
        let treffer = null;
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${turnierId}`);
            if (response.ok) {
                const bestehendeTeilnehmer = await response.json();

                // 1. Suche über die Judopass-Nr
                if (scanJudopassId) {
                    treffer = bestehendeTeilnehmer.find(t =>
                        (t.judopass_id || '').toString().trim() === scanJudopassId.trim()
                    );
                }

                // 2. Kein Treffer über die Judopass-Nr -> über Vorname, Name und Geburtsjahr suchen
                if (!treffer && scanVorname && scanNachname && scanGeburtsjahr) {
                    treffer = bestehendeTeilnehmer.find(t =>
                        (t.vorname || '').trim().toLowerCase() === scanVorname.trim().toLowerCase() &&
                        (t.nachname || '').trim().toLowerCase() === scanNachname.trim().toLowerCase() &&
                        String(t.geburtsjahr || '') === scanGeburtsjahr
                    );
                }
            }
        } catch (err) {
            console.error('Fehler beim Abgleich mit bestehenden Teilnehmern:', err);
        }

        if (treffer) {
            // Bestehenden Teilnehmer laden und mit den QR-Daten aktualisieren
            fuelleFormularFelder(treffer);
            scanMatchedId = treffer.id;
            await befuelleTeamNameFeld(treffer.id);

            if (scanJudopassId) document.getElementById('judopass_id').value = scanJudopassId;
            setzeLizenzAusScan(scanLizenzAblauf, `${treffer.vorname} ${treffer.nachname}`);
        } else {
            // Kein Treffer -> Formular komplett mit den QR-Daten befüllen (Neuanlage)
            scanMatchedId = null;

            if (scanVorname) document.getElementById('vorname').value = scanVorname;
            if (scanNachname) document.getElementById('nachname').value = scanNachname;
            if (scanJudopassId) document.getElementById('judopass_id').value = scanJudopassId;
            if (scanGeburtsjahr) document.getElementById('geburtsjahr').value = scanGeburtsjahr;
            if (scanVerein) setzeVereinFeldWert(scanVerein);
            setzeLizenzAusScan(scanLizenzAblauf, `${scanVorname} ${scanNachname}`.trim());
        }

        if (parsedData.geschlecht) {
            document.getElementById('geschlecht').value = parsedData.geschlecht;
            befehleAltersklassenDropdown();
        }

        bestimmeUndWaehleAltersklasse();

        if (parsedData.gewichtsklasse && gewichtsklasseSelect) {
            gewichtsklasseSelect.value = parsedData.gewichtsklasse;
        }

        aktualisiereSpeicherButtonStatus();
        document.getElementById('verein').focus();
    };

    initialisiereScanner(verarbeiteGescannteDaten);

    // --- MODAL ÖFFNEN/SCHLIESSEN ---
    const teilnehmerForm = document.getElementById('teilnehmerForm');
    const kampfbereitBtn = document.getElementById('kampfbereitBtn');
    const waageModalTitle = document.getElementById('waageModalTitle');

    const setzeFormularZurueck = () => {
        teilnehmerForm.reset();
        document.getElementById('lizenz_ablauf').classList.remove('lizenz-valid', 'lizenz-expired');
        const startgeldCheckbox = document.getElementById('startgeld_bezahlt');
        if (startgeldCheckbox) startgeldCheckbox.checked = false;
        gewichtsklasseSelect.innerHTML = '<option value="" disabled selected hidden>Bitte Altersklasse wählen...</option>';
        if (kampfbereitBtn) {
            kampfbereitBtn.style.display = 'none';
            delete kampfbereitBtn.dataset.teilnehmerId;
        }
        scanMatchedId = null;
        urspruenglichesGewicht = null;
        letzteAenderungViaScan = false;
        // form.reset() leert u.a. das Verein-Feld wieder — für Nicht-Ausrichter sofort erneut sperren.
        wendeBerechtigungenAufFormularAn();
        aktualisiereSpeicherButtonStatus();
    };

    const ladeBestehendeTeilnehmerDaten = async (id) => {
        try {
            const response = await fetch(`/api/teilnehmer/${id}`);
            if (!response.ok) throw new Error('Daten konnten nicht geladen werden.');
            const athlet = await response.json();
            fuelleFormularFelder(athlet);
            await befuelleTeamNameFeld(id);
            aktualisiereSpeicherButtonStatus();
        } catch (err) {
            window.zeigeNotification('Fehler beim Laden des Profils: ' + err.message, 'error');
        }
    };

    // Schließt den Scanner mit, falls er beim Schließen des Modals noch aktiv ist (gibt die
    // Webcam frei) — nutzt bewusst den bestehenden Klick-Handler aus qr-scanner.js statt die
    // Stream-Logik hier zu duplizieren.
    const schliesseScannerFallsAktiv = () => {
        const scannerContainer = document.getElementById('scannerContainer');
        if (scannerContainer && scannerContainer.style.display !== 'none') {
            document.getElementById('stopScanBtn')?.click();
        }
    };

    const schliesseModal = () => {
        modal.style.display = 'none';
        schliesseScannerFallsAktiv();
        editId = null;
    };

    // Öffnet das Popup: ohne id für einen neuen Teilnehmer, mit id zum Bearbeiten eines
    // bestehenden. Global exponiert, da teilnehmer.js (kein Modul) den "Hinzufügen"-Button und
    // das Bearbeiten-Icon je Tabellenzeile darauf verdrahtet.
    window.oeffneWaageModal = (id = null, { mitScan = false } = {}) => {
        editId = id || null;
        setzeFormularZurueck();
        waageModalTitle.innerText = editId ? 'Teilnehmer bearbeiten' : 'Teilnehmer hinzufügen';
        modal.style.display = 'flex';
        if (editId) {
            ladeBestehendeTeilnehmerDaten(editId);
        } else if (mitScan) {
            // Über den "Scan"-Button in der Toolbar geöffnet: Kamera direkt aktivieren, statt
            // erst das leere Formular zu zeigen und den Scan-Button erneut anklicken zu lassen.
            document.getElementById('startScanBtn')?.click();
        }
    };

    document.getElementById('waageModalClose')?.addEventListener('click', schliesseModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) schliesseModal();
    });

    const initPage = async () => {
        await ermittleBerechtigungen();
        wendeBerechtigungenAufFormularAn();
        aktualisiereSpeicherButtonStatus();
        await ladeDjbKlassenKonfiguration();
        await ladeGraduierungenKonfiguration();
    };
    initPage();

    // --- KEYBOARD NAVI FÜR DAS GESCHLECHTS-DROPDOWN ---
    if (geschlechtsSelect) {
        geschlechtsSelect.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();

                const current = geschlechtsSelect.value;
                if (current === 'männlich') {
                    geschlechtsSelect.value = 'weiblich';
                } else if (current === 'weiblich') {
                    geschlechtsSelect.value = 'mixed';
                } else {
                    geschlechtsSelect.value = 'männlich';
                }

                befehleAltersklassenDropdown();
                bestimmeUndWaehleAltersklasse();
                aktualisiereSpeicherButtonStatus();
            }
        });
    }

    // --- FORMULAR HANDLING & RESET LOGIK ---
    const resetBtn = document.getElementById('resetBtn');

    if (kampfbereitBtn) {
        kampfbereitBtn.addEventListener('click', async () => {
            const teilnehmerId = kampfbereitBtn.dataset.teilnehmerId;
            if (!teilnehmerId) return;

            try {
                const response = await fetch(`/api/teilnehmer/${teilnehmerId}/kampfbereit`, { method: 'POST' });
                const result = await response.json();
                if (result.success) {
                    window.zeigeNotification('Kampfbereitschaft bestätigt.', 'success');
                    kampfbereitBtn.style.display = 'none';
                    delete kampfbereitBtn.dataset.teilnehmerId;
                    if (window.ladeTeilnehmerListe) window.ladeTeilnehmerListe();
                } else {
                    window.zeigeNotification(result.error || 'Fehler bei der Bestätigung.', 'error');
                }
            } catch (error) {
                window.zeigeNotification('Netzwerk- oder Serverfehler: ' + error.message, 'error');
            }
        });
    }

    if (resetBtn && teilnehmerForm) {
        resetBtn.addEventListener('click', async () => {
            const bestaetigt = await window.zeigeZentraleBestaetigung(
                editId ? 'Möchten Sie die Bearbeitung abbrechen? Ungespeicherte Änderungen gehen verloren.' : 'Möchten Sie die Eingaben für diesen Kämpfer wirklich löschen?',
                editId ? 'Bearbeitung abbrechen' : 'Eingabe zurücksetzen',
                'delete_sweep'
            );

            if (bestaetigt) {
                if (editId) {
                    schliesseModal();
                } else {
                    setzeFormularZurueck();
                }
            }
        });
    }

    // Gleicht die Mannschafts-Mitgliedschaft eines gespeicherten Teilnehmers mit dem Team-Name-
    // Feld ab: legt bei Bedarf eine neue Mannschaft an (oder nutzt eine bestehende gleichen
    // Namens/Vereins, um bei mehreren manuell nachgemeldeten Athleten nicht pro Athlet eine
    // eigene Mannschaft zu erzeugen) und trägt den Teilnehmer dort ein; entfernt ihn aus einer
    // zuvor zugeordneten, jetzt nicht mehr passenden Mannschaft. Nutzt bewusst dieselbe
    // /api/mannschaften-Infrastruktur wie mannschaften.html (fuegeMitgliedHinzu) statt eigener
    // Positions-/Anlege-Logik, damit Pool-Zuordnung und Gewichtsklassen-Position (siehe dortiges
    // ordnePositionZuGewicht) konsistent bleiben.
    const synchronisiereMannschaftsZuordnung = async (teilnehmerId, verein, teamName) => {
        try {
            const resp = await fetch(`/api/mannschaften?turnierId=${turnierId}`);
            if (!resp.ok) return;
            const teams = await resp.json();
            const teamListe = Array.isArray(teams) ? teams : [];

            const bisherigesTeam = teamListe.find(t => (t.mitglieder || []).some(m => m.turnier_teilnehmer_id === parseInt(teilnehmerId)));
            const bisherigesMitglied = bisherigesTeam ? (bisherigesTeam.mitglieder || []).find(m => m.turnier_teilnehmer_id === parseInt(teilnehmerId)) : null;

            // Unverändert -> nichts zu tun.
            if ((bisherigesTeam?.bezeichnung || '') === teamName) return;

            // Aus einer bisherigen Mannschaft entfernen (Team-Name geändert oder gelöscht).
            if (bisherigesTeam && bisherigesMitglied) {
                await fetch(`/api/mannschaften/${bisherigesTeam.id}/mitglieder/${bisherigesMitglied.id}`, { method: 'DELETE' });
            }

            if (!teamName) return;

            // Bestehende Mannschaft gleichen Namens/Vereins wiederverwenden statt eine doppelte anzulegen.
            let zielTeamId = teamListe.find(t => t.verein === verein && t.bezeichnung === teamName)?.id;
            if (!zielTeamId) {
                const createResp = await fetch('/api/mannschaften', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ turnier_id: parseInt(turnierId), verein, bezeichnung: teamName })
                });
                const createResult = await createResp.json();
                if (!createResp.ok || !createResult.success) throw new Error(createResult.error || 'Mannschaft konnte nicht angelegt werden.');
                zielTeamId = createResult.mannschaftId;
            }

            const mitgliedResp = await fetch(`/api/mannschaften/${zielTeamId}/mitglieder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turnier_teilnehmer_id: parseInt(teilnehmerId) })
            });
            const mitgliedResult = await mitgliedResp.json();
            if (!mitgliedResp.ok || !mitgliedResult.success) throw new Error(mitgliedResult.error || 'Mannschafts-Zuordnung fehlgeschlagen.');
        } catch (err) {
            console.error('Fehler beim Abgleich der Mannschafts-Zuordnung:', err);
            window.zeigeNotification?.('Teilnehmer gespeichert, aber die Mannschafts-Zuordnung konnte nicht aktualisiert werden: ' + err.message, 'error');
        }
    };

    if (teilnehmerForm) {
        teilnehmerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const gewichtsEingabe = document.getElementById('gewicht').value.trim();
            let gewichtFormatiert = parseFloat(gewichtsEingabe.replace(',', '.'));

            if (gewichtsEingabe === '' && !istGastgeberVerein) {
                // Nicht-Ausrichter dürfen ohne Gewicht speichern (s.o.) — das eigentliche
                // Wiegeergebnis trägt der Ausrichter beim Einwiegen nach.
                gewichtFormatiert = 0;
            } else if (isNaN(gewichtFormatiert) || gewichtFormatiert <= 0) {
                alert('Bitte geben Sie ein gültiges Gewicht mit Komma ein (z.B. 34,50).');
                document.getElementById('gewicht').focus();
                return;
            }

            const payload = {
                turnier_id: parseInt(turnierId),
                vorname: document.getElementById('vorname').value,
                nachname: document.getElementById('nachname').value,
                judopass_id: document.getElementById('judopass_id').value,
                verein: document.getElementById('verein').value,
                geburtsjahr: parseInt(document.getElementById('geburtsjahr').value, 10),
                graduierung: document.getElementById('graduierung').value || null,
                lizenz_ablauf: document.getElementById('lizenz_ablauf').value,
                geschlecht: document.getElementById('geschlecht').value,
                gewicht: gewichtFormatiert,
                altersklasse: document.getElementById('altersklasse').value,
                gewichtsklasse: document.getElementById('gewichtsklasse').value,
                startgeld_bezahlt: document.getElementById('startgeld_bezahlt').checked
            };

            // "Gewogen" darf serverseitig ohnehin nur der ausrichtende Verein (bzw. Offline-
            // Betrieb) setzen (siehe teilnehmerController.js) — hier zusätzlich nur nachfragen,
            // wenn sich das Gewicht überhaupt geändert hat (reine Korrekturen an Name o.ä. lösen
            // keinen Dialog aus). Per QR-Scan aufgerufene Datensätze gelten als physisch am
            // Wiegetisch erfasst -> Gewogen wird direkt gesetzt, ohne nachzufragen.
            const vorherigesGewicht = parseFloat(String(urspruenglichesGewicht ?? '').replace(',', '.')) || 0;
            const gewichtGeaendert = gewichtFormatiert > 0 && gewichtFormatiert !== vorherigesGewicht;

            if (istGastgeberVerein && gewichtGeaendert) {
                if (letzteAenderungViaScan) {
                    payload.gewogen = true;
                } else {
                    payload.gewogen = await window.zeigeZentraleBestaetigung(
                        `${payload.vorname} ${payload.nachname} als gewogen markieren?`,
                        'Gewogen bestätigen',
                        'scale',
                        { compact: true, confirmText: 'Ja', cancelText: 'Nein' }
                    );
                }
            }

            // Vor setzeFormularZurueck() auslesen (das den Wert unten wieder leert).
            const mannschaftNameEingabe = (document.getElementById('mannschaft_name')?.value || '').trim();

            // Im Editier-Modus wird immer die editId verwendet, sonst ein ggf. per QR-Scan
            // gefundener Bestandsteilnehmer (sonst Neuanlage per POST).
            const effektiveId = editId || scanMatchedId;
            const zielUrl = effektiveId ? `/api/teilnehmer/${effektiveId}` : '/api/teilnehmer';
            const methode = effektiveId ? 'PUT' : 'POST';

            try {
                const response = await fetch(zielUrl, {
                    method: methode,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.success || response.ok) {
                    const gespeicherteId = effektiveId || result.teilnehmerId;

                    if (turnierHatMannschaftKlassen && gespeicherteId) {
                        await synchronisiereMannschaftsZuordnung(gespeicherteId, payload.verein, mannschaftNameEingabe);
                        if (window.ladeMannschaftsZuordnung) await window.ladeMannschaftsZuordnung();
                    }

                    window.zeigeNotification(effektiveId ? `Athlet ${payload.vorname} erfolgreich aktualisiert!` : `Athlet ${payload.vorname} erfolgreich eingewogen!`, 'success');
                    if (window.ladeTeilnehmerListe) window.ladeTeilnehmerListe();

                    if (editId) {
                        setTimeout(schliesseModal, 800);
                    } else {
                        // Kampfbereit-Bestätigung anbieten, bevor das Formular für den nächsten
                        // Athleten zurückgesetzt wird (Modal bleibt für die Erfassung des
                        // nächsten Kämpfers am Wiegetisch geöffnet).
                        setzeFormularZurueck();
                        if (gespeicherteId && kampfbereitBtn) {
                            kampfbereitBtn.style.display = 'inline-flex';
                            kampfbereitBtn.dataset.teilnehmerId = gespeicherteId;
                        }
                    }
                } else {
                    window.zeigeNotification(result.error || 'Fehler beim Speichern', 'error');
                }
            } catch (error) {
                window.zeigeNotification('Netzwerk- oder Serverfehler: ' + error.message, 'error');
            }
        });
    }
});
