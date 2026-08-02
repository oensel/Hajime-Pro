import {initialisiereScanner} from './qr-scanner.js';

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('turnierId') || urlParams.get('id');

    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt! Bitte wählen oder erstellen Sie zuerst ein Turnier.');
        window.location.href = '/waage.html';
        return;
    }

    // --- CUSTOM CONFIRM DIALOG ---
    const zeigeZentraleBestaetigung = (nachricht, titel = "Aktion bestätigen", icon = "help_outline") => {
        return new Promise((resolve) => {
            const modal = document.getElementById('customConfirmModal');
            const txtMsg = document.getElementById('modalMessage');
            const txtTitle = document.getElementById('modalTitle');
            const icoEl = document.getElementById('modalIcon');
            const btnConfirm = document.getElementById('modalConfirmBtn');
            const btnCancel = document.getElementById('modalCancelBtn');

            if (!modal || !txtMsg) {
                resolve(confirm(nachricht));
                return;
            }

            txtMsg.innerText = nachricht;
            txtTitle.innerText = titel;
            icoEl.innerText = icon;
            modal.style.display = 'flex';

            const schliessen = (ergebnis) => {
                modal.style.display = 'none';
                btnConfirm.replaceWith(btnConfirm.cloneNode(true));
                btnCancel.replaceWith(btnCancel.cloneNode(true));
                resolve(ergebnis);
            };

            document.getElementById('modalConfirmBtn').addEventListener('click', () => schliessen(true));
            document.getElementById('modalCancelBtn').addEventListener('click', () => schliessen(false));
        });
    };

    // --- STRIKTE FORMULAR- UND LIZENZVALIDIERUNG ---
    const aktualisiereSpeicherButtonStatus = () => {
        const submitBtn = document.getElementById('submitBtn');
        const lizenzFeld = document.getElementById('lizenz_ablauf');

        const felder = [
            'vorname', 'nachname', 'judopass_id',
            'geburtsdatum', 'lizenz_ablauf', 'geschlecht',
            'gewicht', 'altersklasse', 'gewichtsklasse'
        ];

        const alleFelderGefuellt = felder.every(id => {
            const el = document.getElementById(id);
            return el && el.value.trim() !== '';
        });

        const lizenzIstGueltig = lizenzFeld && lizenzFeld.classList.contains('lizenz-valid');

        if (submitBtn) {
            if (alleFelderGefuellt && lizenzIstGueltig) {
                submitBtn.removeAttribute('disabled');
                submitBtn.style.pointerEvents = 'auto';
                submitBtn.style.opacity = '1';
            } else {
                submitBtn.setAttribute('disabled', 'true');
                submitBtn.style.pointerEvents = 'none';
                submitBtn.style.opacity = '0.35';
            }
        }
    };

    const felderIDs = ['vorname', 'nachname', 'judopass_id', 'verein', 'geburtsdatum', 'geschlecht', 'gewicht', 'altersklasse', 'gewichtsklasse'];
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
        const geburtsdatumFeld = document.getElementById('geburtsdatum');

        if (!geburtsdatumFeld || !geburtsdatumFeld.value || !geschlechtsSelect || !geschlechtsSelect.value) {
            return;
        }

        const geburtsJahr = parseInt(geburtsdatumFeld.value.split('-')[0]);
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

            if (turnierId) {
                try {
                    const turnierResp = await fetch(`/api/turniere/${turnierId}`);
                    if (turnierResp.ok) {
                        const turnier = await turnierResp.json();
                        if (turnier.datum) {
                            wettkampfJahr = new Date(turnier.datum).getFullYear();
                        }
                        if (turnier.altersklassen) {
                            if (Array.isArray(turnier.altersklassen)) {
                                turnierAltersklassen = turnier.altersklassen;
                            } else if (typeof turnier.altersklassen === 'object') {
                                turnierAltersklassen = Object.keys(turnier.altersklassen);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Fehler beim Laden des Turniers für Altersklassen-Filter:", e);
                }
            }

            geschlechtsSelect.addEventListener('change', () => {
                befehleAltersklassenDropdown();
                bestimmeUndWaehleAltersklasse();
            });

            const geburtsFeld = document.getElementById('geburtsdatum');
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
        document.getElementById('vorname').value = athlet.vorname || '';
        document.getElementById('nachname').value = athlet.nachname || '';
        document.getElementById('judopass_id').value = athlet.judopass_id || athlet.judopassId || '';
        document.getElementById('verein').value = athlet.verein || '';
        document.getElementById('geburtsdatum').value = athlet.geburtsdatum || '';
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
        } else if (athlet.geschlecht && athlet.geburtsdatum) {
            // Noch keine Altersklasse gesetzt (z.B. importierter Teilnehmer):
            // anhand von Geburtsdatum + Geschlecht automatisch vorauswählen.
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

    // Setzt "Lizenz gültig bis" aus einem gescannten QR-Wert (inkl. Warnhinweis bei Ablauf).
    const setzeLizenzAusScan = (wert, anzeigeName = '') => {
        const lizenzFeld = document.getElementById('lizenz_ablauf');
        if (!wert || !lizenzFeld) return;
        lizenzFeld.value = wert;
        aktualisiereLizenzKlasse(wert);
        if (lizenzFeld.classList.contains('lizenz-expired')) {
            alert(`Achtung: Die Lizenz${anzeigeName ? ' von ' + anzeigeName : ''} ist abgelaufen! Speichern blockiert.`);
        }
    };

    // ID des per QR-Scan gefundenen Bestandsteilnehmers (für PUT statt POST beim Speichern).
    let scanMatchedId = null;

    // --- QR-DATA-MAPPING & WEBCAM INTERFACE ---
    const verarbeiteGescannteDaten = async (parsedData, istDokuMe) => {
        // Gescannte Daten in ein einheitliches Format überführen
        let scanVorname = '', scanNachname = '', scanJudopassId = '', scanGeburtsdatum = '', scanLizenzAblauf = '', scanVerein = '';

        if (istDokuMe) {
            scanVorname = parsedData.FN || '';
            scanNachname = parsedData.LN || '';
            scanJudopassId = parsedData.NO || '';
            scanGeburtsdatum = parsedData.DOB || '';
            scanVerein = parsedData.TM || '';
            if (parsedData.exp) {
                scanLizenzAblauf = new Date(parsedData.exp * 1000).toISOString().split('T')[0];
            }
        } else {
            scanVorname = parsedData.vorname || '';
            scanNachname = parsedData.nachname || '';
            scanJudopassId = parsedData.judopass_id || parsedData.judopassId || '';
            scanGeburtsdatum = parsedData.geburtsdatum || '';
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

                // 2. Kein Treffer über die Judopass-Nr -> über Vorname, Name und Geburtsdatum suchen
                if (!treffer && scanVorname && scanNachname && scanGeburtsdatum) {
                    treffer = bestehendeTeilnehmer.find(t =>
                        (t.vorname || '').trim().toLowerCase() === scanVorname.trim().toLowerCase() &&
                        (t.nachname || '').trim().toLowerCase() === scanNachname.trim().toLowerCase() &&
                        (t.geburtsdatum || '').toString().slice(0, 10) === scanGeburtsdatum.toString().slice(0, 10)
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

            if (scanJudopassId) document.getElementById('judopass_id').value = scanJudopassId;
            setzeLizenzAusScan(scanLizenzAblauf, `${treffer.vorname} ${treffer.nachname}`);
        } else {
            // Kein Treffer -> Formular komplett mit den QR-Daten befüllen (Neuanlage)
            scanMatchedId = null;

            if (scanVorname) document.getElementById('vorname').value = scanVorname;
            if (scanNachname) document.getElementById('nachname').value = scanNachname;
            if (scanJudopassId) document.getElementById('judopass_id').value = scanJudopassId;
            if (scanGeburtsdatum) document.getElementById('geburtsdatum').value = scanGeburtsdatum;
            if (scanVerein) document.getElementById('verein').value = scanVerein;
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

    // --- EXKLUSIVER EDITIER-MODUS LADE-TRIGGER ---
    const editId = urlParams.get('editId');

    const ladeBestehendeTeilnehmerDaten = async () => {
        if (!editId) return;

        try {
            const response = await fetch(`/api/teilnehmer/${editId}`);
            if (!response.ok) throw new Error('Daten konnten nicht geladen werden.');
            const athlet = await response.json();

            const formTitle = document.getElementById('formTitle');
            if (formTitle) formTitle.innerText = "Teilnehmer bearbeiten";

            fuelleFormularFelder(athlet);
            aktualisiereSpeicherButtonStatus();

        } catch (err) {
            window.zeigeNotification('Fehler beim Laden des Profils: ' + err.message, 'error');
        }
    };

    const initPage = async () => {
        await ladeDjbKlassenKonfiguration();
        await ladeGraduierungenKonfiguration();
        if (editId) {
            await ladeBestehendeTeilnehmerDaten();
        }
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
    const teilnehmerForm = document.getElementById('teilnehmerForm');
    const resetBtn = document.getElementById('resetBtn');
    const kampfbereitBtn = document.getElementById('kampfbereitBtn');

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
                'Möchten Sie die Eingaben für diesen Kämpfer wirklich löschen?',
                'Eingabe zurücksetzen',
                'delete_sweep'
            );

            if (bestaetigt) {
                document.getElementById('lizenz_ablauf').classList.remove('lizenz-valid', 'lizenz-expired');
                const startgeldCheckbox = document.getElementById('startgeld_bezahlt');
                if (startgeldCheckbox) startgeldCheckbox.checked = false;
                teilnehmerForm.reset();
                if (editId) {
                    window.location.href = `/teilnehmer.html?turnierId=${turnierId}`;
                } else {
                    scanMatchedId = null;
                    aktualisiereSpeicherButtonStatus();
                }
            }
        });
    }

    if (teilnehmerForm) {
        teilnehmerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const gewichtsEingabe = document.getElementById('gewicht').value.trim();
            const gewichtFormatiert = parseFloat(gewichtsEingabe.replace(',', '.'));

            if (isNaN(gewichtFormatiert) || gewichtFormatiert <= 0) {
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
                geburtsdatum: document.getElementById('geburtsdatum').value,
                graduierung: document.getElementById('graduierung').value || null,
                lizenz_ablauf: document.getElementById('lizenz_ablauf').value,
                geschlecht: document.getElementById('geschlecht').value,
                gewicht: gewichtFormatiert,
                altersklasse: document.getElementById('altersklasse').value,
                gewichtsklasse: document.getElementById('gewichtsklasse').value,
                startgeld_bezahlt: document.getElementById('startgeld_bezahlt').checked
            };

            // Beim URL-Editier-Modus wird immer die editId verwendet, sonst ein ggf.
            // per QR-Scan gefundener Bestandsteilnehmer (sonst Neuanlage per POST).
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
                    window.zeigeNotification(effektiveId ? `Athlet ${payload.vorname} erfolgreich aktualisiert!` : `Athlet ${payload.vorname} erfolgreich eingewogen!`, 'success');

                    if (editId) {
                        setTimeout(() => {
                            window.location.href = `/teilnehmer.html?turnierId=${turnierId}`;
                        }, 1200);
                    } else {
                        // Kampfbereit-Bestätigung anbieten, bevor das Formular für den nächsten
                        // Athleten zurückgesetzt wird.
                        const gespeicherteId = effektiveId || result.teilnehmerId;
                        if (gespeicherteId && kampfbereitBtn) {
                            kampfbereitBtn.style.display = 'inline-flex';
                            kampfbereitBtn.dataset.teilnehmerId = gespeicherteId;
                        }

                        document.getElementById('lizenz_ablauf').classList.remove('lizenz-valid', 'lizenz-expired');
                        const startgeldCheckbox = document.getElementById('startgeld_bezahlt');
                        if (startgeldCheckbox) startgeldCheckbox.checked = false;
                        teilnehmerForm.reset();
                        scanMatchedId = null;
                        aktualisiereSpeicherButtonStatus();
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