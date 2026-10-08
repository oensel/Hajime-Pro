document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('id') || urlParams.get('turnierId');

    const turnierForm = document.getElementById('turnierForm');
    const submitBtn = document.getElementById('submitBtn');

    // --- ABBRECHEN: verwirft die Eingaben und kehrt zur Turnierliste zurück ---
    const abbrechenBtn = document.getElementById('abbrechenBtn');
    if (abbrechenBtn) {
        abbrechenBtn.addEventListener('click', () => {
            window.location.href = '/turniere.html';
        });
    }

    // --- AUSSCHREIBUNG (PDF) ---
    // ausschreibungPdfBase64: undefined = beim Speichern unverändert lassen, String = neue Datei
    // hochladen, null = ausdrücklich entfernen (siehe baueAusschreibungFragment in
    // turnierController.js — das Backend unterscheidet exakt diese drei Fälle).
    let ausschreibungPdfBase64;
    let ausschreibungNeueDatei = null; // File-Objekt der gerade ausgewählten, noch ungespeicherten Datei (für die lokale Vorschau)
    let bestehendeAusschreibungVorhanden = false; // von ladeTurnierDaten anhand turnier.hat_ausschreibung gesetzt

    const ausschreibungInput = document.getElementById('ausschreibungInput');
    const ausschreibungAuswaehlenBtn = document.getElementById('ausschreibungAuswaehlenBtn');
    const ausschreibungDateinameEl = document.getElementById('ausschreibungDateiname');
    const ausschreibungAnsehenBtn = document.getElementById('ausschreibungAnsehenBtn');
    const ausschreibungEntfernenBtn = document.getElementById('ausschreibungEntfernenBtn');

    function liesDateiAlsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    function aktualisiereAusschreibungAnzeige() {
        if (!ausschreibungDateinameEl) return;

        if (ausschreibungNeueDatei) {
            ausschreibungDateinameEl.textContent = ausschreibungNeueDatei.name;
            ausschreibungAnsehenBtn.style.display = 'inline-block';
            ausschreibungEntfernenBtn.style.display = 'inline-block';
        } else if (bestehendeAusschreibungVorhanden) {
            ausschreibungDateinameEl.textContent = 'Aktuell hinterlegt';
            ausschreibungAnsehenBtn.style.display = 'inline-block';
            ausschreibungEntfernenBtn.style.display = 'inline-block';
        } else {
            ausschreibungDateinameEl.textContent = 'Keine Ausschreibung hinterlegt';
            ausschreibungAnsehenBtn.style.display = 'none';
            ausschreibungEntfernenBtn.style.display = 'none';
        }
    }
    aktualisiereAusschreibungAnzeige();

    if (ausschreibungAuswaehlenBtn && ausschreibungInput) {
        ausschreibungAuswaehlenBtn.addEventListener('click', () => ausschreibungInput.click());

        ausschreibungInput.addEventListener('change', async () => {
            const file = ausschreibungInput.files[0];
            ausschreibungInput.value = '';
            if (!file) return;

            if (file.type !== 'application/pdf') {
                const meldung = 'Bitte eine PDF-Datei auswählen.';
                if (window.zeigeNotification) window.zeigeNotification(meldung, 'error');
                else alert(meldung);
                return;
            }

            // Selbe Grenze wie AUSSCHREIBUNG_MAX_MB in turnierController.js — vermeidet, dass
            // erst nach dem vollständigen Base64-Encodieren/Hochladen ein Server-Fehler kommt.
            const AUSSCHREIBUNG_MAX_MB = 10;
            if (file.size > AUSSCHREIBUNG_MAX_MB * 1024 * 1024) {
                const meldung = `Die Datei ist zu groß (max. ${AUSSCHREIBUNG_MAX_MB} MB).`;
                if (window.zeigeNotification) window.zeigeNotification(meldung, 'error');
                else alert(meldung);
                return;
            }

            try {
                ausschreibungPdfBase64 = await liesDateiAlsBase64(file);
                ausschreibungNeueDatei = file;
                aktualisiereAusschreibungAnzeige();
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
                else alert(err.message);
            }
        });
    }

    if (ausschreibungAnsehenBtn) {
        ausschreibungAnsehenBtn.addEventListener('click', () => {
            const titel = document.getElementById('bezeichnung').value || 'Ausschreibung';
            if (ausschreibungNeueDatei) {
                window.zeigeAusschreibungDatei(ausschreibungNeueDatei, titel);
            } else if (turnierId) {
                window.zeigeAusschreibung(turnierId, titel);
            }
        });
    }

    if (ausschreibungEntfernenBtn) {
        ausschreibungEntfernenBtn.addEventListener('click', async () => {
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung('Soll die hinterlegte Ausschreibung entfernt werden?', 'Ausschreibung entfernen', 'delete_sweep')
                : confirm('Soll die hinterlegte Ausschreibung entfernt werden?');
            if (!bestaetigt) return;

            ausschreibungPdfBase64 = null; // beim Speichern ausdrücklich entfernen
            ausschreibungNeueDatei = null;
            bestehendeAusschreibungVorhanden = false;
            aktualisiereAusschreibungAnzeige();
        });
    }

    // Merkt sich das Grid-Element je Geschlecht, damit sowohl der "+"-Button als auch das
    // Nachtragen bereits gespeicherter freier Klassen (siehe ladeTurnierDaten) Zeilen an der
    // richtigen Stelle einfügen können.
    const altersklasseGridByGender = {};

    // Analog für die Mannschafts-Altersklassen-Auswahl (siehe mannschaftAltersklassenContainer).
    const mannschaftAltersklasseGridByGender = {};

    // Baut eine einzelne Checkbox-Zeile (inkl. DJB/Gewichtsnah-Auswahl) — genutzt sowohl für
    // die aus der Konfigurationsdatei geladenen Standardklassen als auch für frei benannte
    // Klassen (Button "+" oder beim Nachladen eines bestehenden Turniers). Frei benannte Klassen
    // (istFrei=true) bekommen zusätzlich einen Lösch-Button, Standardklassen nicht.
    function erzeugeAltersklasseZeile(uniqueId, bezeichnungText, grid, istFrei = false) {
        const row = document.createElement('div');
        row.className = 'turnier-ak-row';

        const lbl = document.createElement('label');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'altersklasse_cb';
        cb.value = uniqueId;

        const span = document.createElement('span');
        span.innerText = bezeichnungText;

        lbl.appendChild(cb);
        lbl.appendChild(span);
        row.appendChild(lbl);

        if (istFrei) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.title = 'Klasse entfernen';
            deleteBtn.className = 'material-icons turnier-ak-delete-btn';
            deleteBtn.innerText = 'close';
            deleteBtn.addEventListener('click', () => row.remove());
            row.appendChild(deleteBtn);
        }

        const modeSelect = document.createElement('div');
        modeSelect.id = `modus_group_${uniqueId}`;
        modeSelect.className = 'turnier-ak-mode-group';

        // Frei benannte Klassen haben keine vordefinierte DJB-Gewichtsklassen-Liste, gegen die
        // sich Teilnehmer einordnen ließen — dafür kommt nur "Gewichtsnah" infrage.
        if (!istFrei) {
            const radioDjbLbl = document.createElement('label');
            const radioDjb = document.createElement('input');
            radioDjb.type = 'radio';
            radioDjb.name = `modus_${uniqueId}`;
            radioDjb.value = 'djb';
            radioDjb.checked = true;
            radioDjbLbl.appendChild(radioDjb);
            radioDjbLbl.appendChild(document.createTextNode('DJB'));
            modeSelect.appendChild(radioDjbLbl);
        }

        const radioGwLbl = document.createElement('label');
        const radioGw = document.createElement('input');
        radioGw.type = 'radio';
        radioGw.name = `modus_${uniqueId}`;
        radioGw.value = 'gewichtsnahe';
        radioGw.checked = istFrei;
        radioGwLbl.appendChild(radioGw);
        radioGwLbl.appendChild(document.createTextNode('Gewichtsnah'));
        modeSelect.appendChild(radioGwLbl);

        row.appendChild(modeSelect);

        cb.addEventListener('change', () => {
            if (cb.checked) {
                modeSelect.style.display = 'flex';
                row.classList.add('turnier-ak-row-active');
            } else {
                modeSelect.style.display = 'none';
                row.classList.remove('turnier-ak-row-active');
            }
        });

        grid.appendChild(row);
        return { row, cb, modeSelect };
    }

    // Fügt (auf Klick des "+"-Buttons) eine frei benannte Klasse zum jeweiligen Geschlecht
    // hinzu, z.B. "U10" oder "Veteranen(Ü30)". Existiert der Name in diesem Geschlecht schon
    // (Standard- oder bereits zuvor frei angelegte Klasse), wird nur angehakt statt dupliziert.
    async function fuegeFreieAltersklasseHinzu(gender) {
        const grid = altersklasseGridByGender[gender];
        if (!grid) return;

        const eingabe = window.zeigeTextEingabe
            ? await window.zeigeTextEingabe('Name der neuen Klasse', `Klasse hinzufügen (${gender})`, 'z.B. "U10" oder "Veteranen(Ü30)"')
            : prompt('Name der neuen Klasse (z.B. "U10" oder "Veteranen(Ü30)"):');
        if (!eingabe || !eingabe.trim()) return;

        const name = eingabe.trim();
        const uniqueId = `${gender}_${name}`;
        let cb = document.querySelector(`input[name="altersklasse_cb"][value="${CSS.escape(uniqueId)}"]`);

        if (!cb) {
            const zeile = erzeugeAltersklasseZeile(uniqueId, name, grid, true);
            cb = zeile.cb;
        }

        if (!cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
        }
    }

    // Baut eine Checkbox-Zeile für die Mannschafts-Altersklassen-Auswahl. Anders als bei den
    // Einzelwettkampf-Klassen gibt es hier keine DJB/Gewichtsnah-Umschaltung — die Auswahl legt
    // nur fest, ob diese Altersklasse bei diesem Turnier für Mannschaftskämpfe zur Verfügung
    // steht (filtert die Altersklassen-Auswahl beim Anlegen von Mannschafts-Pools, siehe
    // mannschaften.js).
    function erzeugeMannschaftAltersklasseZeile(uniqueId, bezeichnungText, grid, istFrei = false) {
        const row = document.createElement('div');
        row.className = 'turnier-ak-row';

        const lbl = document.createElement('label');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'mannschaft_altersklasse_cb';
        cb.value = uniqueId;

        const span = document.createElement('span');
        span.innerText = bezeichnungText;

        lbl.appendChild(cb);
        lbl.appendChild(span);
        row.appendChild(lbl);

        if (istFrei) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.title = 'Klasse entfernen';
            deleteBtn.className = 'material-icons turnier-ak-delete-btn';
            deleteBtn.innerText = 'close';
            deleteBtn.addEventListener('click', () => row.remove());
            row.appendChild(deleteBtn);
        }

        grid.appendChild(row);
        return { row, cb };
    }

    // Fügt (auf Klick des "+"-Buttons) eine frei benannte Mannschafts-Altersklasse hinzu.
    async function fuegeFreieMannschaftAltersklasseHinzu(gender) {
        const grid = mannschaftAltersklasseGridByGender[gender];
        if (!grid) return;

        const eingabe = window.zeigeTextEingabe
            ? await window.zeigeTextEingabe('Name der neuen Klasse', `Klasse hinzufügen (${gender})`, 'z.B. "U10" oder "Veteranen(Ü30)"')
            : prompt('Name der neuen Klasse (z.B. "U10" oder "Veteranen(Ü30)"):');
        if (!eingabe || !eingabe.trim()) return;

        const name = eingabe.trim();
        const uniqueId = `${gender}_${name}`;
        let cb = document.querySelector(`input[name="mannschaft_altersklasse_cb"][value="${CSS.escape(uniqueId)}"]`);

        if (!cb) {
            const zeile = erzeugeMannschaftAltersklasseZeile(uniqueId, name, grid, true);
            cb = zeile.cb;
        }

        cb.checked = true;
    }

    // --- NEUANLAGE: Verein des Users als austragenden Verein vorbelegen ---
    const setzeAusrichterVorbelegung = async () => {
        if (turnierId) return; // nur bei Neuanlage, nicht im Edit-Modus

        try {
            const response = await fetch('/api/auth/me');
            if (!response.ok) return;
            const data = await response.json();
            const ausrichterFeld = document.getElementById('ausrichter');
            if (ausrichterFeld && data.user && data.user.verein_name) {
                ausrichterFeld.value = data.user.verein_name;
            }
        } catch (err) {
            console.error('Fehler beim Vorbelegen des Ausrichters:', err);
        }
    };
    setzeAusrichterVorbelegung();

    // --- STANDARD-VERWENDUNGSZWECK VORSCHLAGEN, SOBALD EIN STARTGELD EINGETRAGEN WIRD ---
    // Die Platzhalter <Turniername> und <Verein> bleiben als Text stehen und werden erst beim
    // Erzeugen des Zahlungs-QR-Codes (teilnehmer.html) durch die tatsächlichen Werte ersetzt.
    const startgeldFeld = document.getElementById('startgeld');
    const verwendungszweckFeld = document.getElementById('verwendungszweck');
    if (startgeldFeld && verwendungszweckFeld) {
        startgeldFeld.addEventListener('blur', () => {
            const wert = parseInt(startgeldFeld.value, 10) || 0;
            if (wert > 0 && !verwendungszweckFeld.value.trim()) {
                verwendungszweckFeld.value = 'Startgeld <Turniername> <Verein>';
            }
        });
    }

    // --- EDIT-MODE: TOURNIERDATEN AUS DER DATENBANK LADEN ---
    const ladeTurnierDaten = async () => {
        if (!turnierId) return;

        try {
            const response = await fetch(`/api/turniere/${turnierId}`);
            if (!response.ok) throw new Error('Turnierdaten konnten nicht geladen werden.');

            const turnier = await response.json();

            // Titel der Maske auf Bearbeiten-Modus umstellen
            const formTitle = document.getElementById('formTitle');
            if (formTitle) formTitle.innerText = "Turnier bearbeiten";
            if (submitBtn) submitBtn.innerText = "Änderungen Speichern";

            // Eingabefelder mit bestehenden Werten befüllen
            document.getElementById('bezeichnung').value = turnier.bezeichnung || '';
            document.getElementById('plz').value = turnier.plz || '';
            document.getElementById('ort').value = turnier.ort || '';
            document.getElementById('bundesland').value = turnier.bundesland || '';
            document.getElementById('ausrichter').value = turnier.ausrichter || '';
            document.getElementById('anzahl_kampfflaechen').value = turnier.anzahl_kampfflaechen || 1;
            document.getElementById('farbe_kaempfer2').value = turnier.farbe_kaempfer2 === 'rot' ? 'rot' : 'blau';
            document.getElementById('startgeld').value = turnier.startgeld !== null && turnier.startgeld !== undefined ? turnier.startgeld : '';
            document.getElementById('iban').value = turnier.iban || '';
            document.getElementById('kontoinhaber').value = turnier.kontoinhaber || '';
            document.getElementById('verwendungszweck').value = turnier.verwendungszweck || '';

            bestehendeAusschreibungVorhanden = !!turnier.hat_ausschreibung;
            aktualisiereAusschreibungAnzeige();

            // Datum für den HTML5-Datepicker formatieren (YYYY-MM-DD)
            if (turnier.datum) {
                const dateObj = new Date(turnier.datum);
                document.getElementById('datum').value = dateObj.toISOString().split('T')[0];
            }

            // Anmeldeschluss befüllen (reines Datum ohne Uhrzeit; String-Slice statt Date-Objekt,
            // um Zeitzonen-bedingte Tagesverschiebung zu vermeiden)
            if (turnier.anmeldeschluss) {
                document.getElementById('anmeldeschluss').value = String(turnier.anmeldeschluss).slice(0, 10);
            }

            // Checkboxes für ausgetragene Altersklassen anhaken
            if (turnier.altersklassen) {
                const isObj = !Array.isArray(turnier.altersklassen) && typeof turnier.altersklassen === 'object';
                const isArr = Array.isArray(turnier.altersklassen);

                const cbs = document.querySelectorAll('input[name="altersklasse_cb"]');
                cbs.forEach(cb => {
                    const val = cb.value; // e.g. "männlich_U11"
                    let checked = false;
                    let selectedMode = 'djb';

                    if (isObj) {
                        if (turnier.altersklassen[val] !== undefined) {
                            checked = true;
                            selectedMode = turnier.altersklassen[val];
                        }
                    } else if (isArr) {
                        if (turnier.altersklassen.includes(val) || turnier.altersklassen.includes(val.split('_')[1])) {
                            checked = true;
                            // Fallback to global setting (will be loaded below)
                            selectedMode = (turnier.nutze_gewichtsklassen === 1 || turnier.nutze_gewichtsklassen === true || turnier.nutze_gewichtsklassen === "1" || turnier.nutze_gewichtsklassen === "true") ? 'gewichtsnahe' : 'djb';
                        }
                    }

                    if (checked) {
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change')); // trigger display logic

                        const radio = document.querySelector(`input[name="modus_${val}"][value="${selectedMode}"]`);
                        if (radio) {
                            radio.checked = true;
                        }
                    }
                });

                // Frei benannte Klassen (siehe fuegeFreieAltersklasseHinzu), die bei diesem
                // Turnier bereits gespeichert sind, existieren noch nicht als Checkbox — für
                // jeden unbekannten Schlüssel wird die Zeile im passenden Geschlecht nachgebaut.
                if (isObj) {
                    Object.keys(turnier.altersklassen).forEach(val => {
                        const bestehend = document.querySelector(`input[name="altersklasse_cb"][value="${CSS.escape(val)}"]`);
                        if (bestehend) return;

                        const idx = val.indexOf('_');
                        if (idx === -1) return;
                        const gender = val.slice(0, idx);
                        const name = val.slice(idx + 1);
                        const grid = altersklasseGridByGender[gender];
                        if (!grid) return;

                        const { cb } = erzeugeAltersklasseZeile(val, name, grid, true);
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change'));

                        const selectedMode = turnier.altersklassen[val];
                        const radio = document.querySelector(`input[name="modus_${val}"][value="${selectedMode}"]`);
                        if (radio) radio.checked = true;
                    });
                }
            }

            // Checkboxes für ausgetragene Mannschafts-Altersklassen anhaken (einfache Liste von
            // Schlüsseln, keine DJB/Gewichtsnah-Umschaltung wie bei den Einzelwettkampf-Klassen).
            if (turnier.mannschafts_altersklassen && Array.isArray(turnier.mannschafts_altersklassen)) {
                turnier.mannschafts_altersklassen.forEach(val => {
                    let cb = document.querySelector(`input[name="mannschaft_altersklasse_cb"][value="${CSS.escape(val)}"]`);

                    if (!cb) {
                        // Frei benannte Klasse, die als Checkbox noch nicht existiert -> Zeile
                        // im passenden Geschlecht nachbauen (analog zu den Einzelwettkampf-Klassen).
                        const idx = val.indexOf('_');
                        if (idx === -1) return;
                        const gender = val.slice(0, idx);
                        const name = val.slice(idx + 1);
                        const grid = mannschaftAltersklasseGridByGender[gender];
                        if (!grid) return;

                        const zeile = erzeugeMannschaftAltersklasseZeile(val, name, grid, true);
                        cb = zeile.cb;
                    }

                    cb.checked = true;
                });
            }

        } catch (err) {
            if (window.zeigeNotification) {
                window.zeigeNotification('Fehler beim Laden des Turniers: ' + err.message, 'error');
            } else {
                console.error(err);
            }
        }
    };

    // --- ALTERS- UND GEWICHTSKLASSEN CONFIG AUS DER DATEI LADEN ---
    const ladeAltersklassenUndInit = async () => {
        try {
            const resp = await fetch('/api/djb-klassen');
            if (!resp.ok) throw new Error('Altersklassen konnten nicht geladen werden.');
            const data = await resp.json();

            const container = document.getElementById('altersklassenContainer');
            if (container) {
                container.innerHTML = '';

                const genders = ['männlich', 'weiblich', 'mixed'];
                genders.forEach(gender => {
                    const block = document.createElement('div');
                    block.className = 'turnier-ak-gender-block';

                    const secHeader = document.createElement('div');
                    secHeader.className = 'turnier-ak-gender-title';
                    secHeader.innerText = gender;
                    block.appendChild(secHeader);

                    const grid = document.createElement('div');
                    grid.className = 'turnier-ak-grid';
                    altersklasseGridByGender[gender] = grid;

                    if (data[gender] && data[gender].length > 0) {
                        data[gender].forEach(klasse => {
                            erzeugeAltersklasseZeile(`${gender}_${klasse.id}`, klasse.bezeichnung, grid);
                        });
                    }

                    block.appendChild(grid);

                    // Frei benannte Klasse hinzufügen (z.B. "U10" oder "Veteranen(Ü30)") — nur
                    // für dieses Geschlecht, analog zu den fest vorgegebenen DJB-Klassen.
                    const addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'btn btn-outlined turnier-ak-add-btn';
                    addBtn.innerHTML = '<span class="material-icons">add</span>Klasse hinzufügen';
                    addBtn.addEventListener('click', () => fuegeFreieAltersklasseHinzu(gender));
                    block.appendChild(addBtn);

                    container.appendChild(block);
                });
            }

            // Mannschafts-Altersklassen-Container analog aufbauen — nutzt dieselben Klassen wie
            // die Einzelwettkampf-Auswahl (siehe mannschaften.js: dort dient die
            // Einzelwettkampf-Altersklassenliste ebenfalls als Grundlage für Mannschafts-Pools),
            // aber ohne DJB/Gewichtsnah-Umschaltung.
            const mannschaftContainer = document.getElementById('mannschaftAltersklassenContainer');
            if (mannschaftContainer) {
                mannschaftContainer.innerHTML = '';

                const mannschaftGenders = ['männlich', 'weiblich'];
                mannschaftGenders.forEach(gender => {
                    const block = document.createElement('div');
                    block.className = 'turnier-ak-gender-block';

                    const secHeader = document.createElement('div');
                    secHeader.className = 'turnier-ak-gender-title';
                    secHeader.innerText = gender;
                    block.appendChild(secHeader);

                    const grid = document.createElement('div');
                    grid.className = 'turnier-ak-grid';
                    mannschaftAltersklasseGridByGender[gender] = grid;

                    if (data[gender] && data[gender].length > 0) {
                        data[gender].forEach(klasse => {
                            erzeugeMannschaftAltersklasseZeile(`${gender}_${klasse.id}`, klasse.bezeichnung, grid);
                        });
                    }

                    block.appendChild(grid);

                    const addBtn = document.createElement('button');
                    addBtn.type = 'button';
                    addBtn.className = 'btn btn-outlined turnier-ak-add-btn';
                    addBtn.innerHTML = '<span class="material-icons">add</span>Klasse hinzufügen';
                    addBtn.addEventListener('click', () => fuegeFreieMannschaftAltersklasseHinzu(gender));
                    block.appendChild(addBtn);

                    mannschaftContainer.appendChild(block);
                });
            }

            // System-Konfiguration abfragen, um Anmeldeschluss anzuzeigen (nur online)
            try {
                const configResp = await fetch('/api/config');
                if (configResp.ok) {
                    const sysConfig = await configResp.json();
                    const groupEl = document.getElementById('anmeldeschlussGroup');
                    if (groupEl && !sysConfig.isOffline) {
                        groupEl.style.display = 'block';
                    }
                }
            } catch (e) {
                console.error("Fehler beim Laden der System-Konfiguration:", e);
            }

            // Erst wenn Altersklassen geladen sind, Turnierdaten laden (falls Edit-Mode)
            if (turnierId) {
                await ladeTurnierDaten();
            }
        } catch (err) {
            console.error("Fehler beim Laden der Altersklassen:", err);
        }
    };

    // Lade- und Initialisierungsvorgang starten
    ladeAltersklassenUndInit();

    // --- FORMULAR ABSENDEN (SPEICHERN / AKTUALISIEREN) ---
    if (turnierForm) {
        turnierForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const selectedAK = {};
            const cbs = document.querySelectorAll('input[name="altersklasse_cb"]:checked');
            cbs.forEach(cb => {
                const val = cb.value; // e.g. "männlich_U11"
                const modeRadio = document.querySelector(`input[name="modus_${val}"]:checked`);
                selectedAK[val] = modeRadio ? modeRadio.value : 'djb';
            });

            const selectedMannschaftAK = [];
            const mannschaftCbs = document.querySelectorAll('input[name="mannschaft_altersklasse_cb"]:checked');
            mannschaftCbs.forEach(cb => selectedMannschaftAK.push(cb.value));

            let anmeldeschlussValue = null;
            const anmeldeschlussFeld = document.getElementById('anmeldeschluss');
            const groupEl = document.getElementById('anmeldeschlussGroup');
            if (groupEl && groupEl.style.display !== 'none' && anmeldeschlussFeld && anmeldeschlussFeld.value) {
                // Reines Datum (ohne Uhrzeit), Feldwert ist bereits im Format YYYY-MM-DD
                anmeldeschlussValue = anmeldeschlussFeld.value;
            }

            // Payload zusammenbauen
            const payload = {
                bezeichnung: document.getElementById('bezeichnung').value.trim(),
                plz: document.getElementById('plz').value.trim(),
                ort: document.getElementById('ort').value.trim(),
                bundesland: document.getElementById('bundesland').value,
                datum: document.getElementById('datum').value,
                ausrichter: document.getElementById('ausrichter').value.trim(),
                anzahl_kampfflaechen: parseInt(document.getElementById('anzahl_kampfflaechen').value, 10),
                nutze_gewichtsklassen: 0,
                farbe_kaempfer2: document.getElementById('farbe_kaempfer2').value,
                altersklassen: selectedAK,
                mannschafts_altersklassen: selectedMannschaftAK,
                anmeldeschluss: anmeldeschlussValue,
                startgeld: document.getElementById('startgeld').value,
                iban: document.getElementById('iban').value.trim(),
                kontoinhaber: document.getElementById('kontoinhaber').value.trim(),
                verwendungszweck: document.getElementById('verwendungszweck').value.trim()
            };

            // Ausschreibung nur mitschicken, wenn sich tatsächlich etwas geändert hat (neue Datei
            // oder ausdrückliches Entfernen) — undefined lässt das Backend die bestehende PDF
            // unangetastet (siehe baueAusschreibungFragment in turnierController.js).
            if (ausschreibungPdfBase64 !== undefined) {
                payload.ausschreibung_pdf_base64 = ausschreibungPdfBase64;
                if (ausschreibungNeueDatei) {
                    payload.ausschreibung_dateiname = ausschreibungNeueDatei.name;
                }
            }

            const startgeldWert = parseInt(payload.startgeld, 10) || 0;
            if (startgeldWert > 0 && (!payload.iban || !payload.kontoinhaber || !payload.verwendungszweck)) {
                if (window.zeigeNotification) {
                    window.zeigeNotification('Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.', 'error');
                }
                return;
            }

            // Hallen-Server mit Sync trägt genau ein Turnier: eine Neuanlage löscht das bisherige
            // komplett (siehe Spec CouchDB-Umbau Abschnitt 8) — vorher ausdrücklich nachfragen.
            if (!turnierId) {
                const syncStatus = await fetch('/api/sync/status').then(r => r.json()).catch(() => ({}));
                if (syncStatus.rolle === 'server' && syncStatus.instanz_id) {
                    const bestaetigt = window.zeigeZentraleBestaetigung
                        ? await window.zeigeZentraleBestaetigung(
                            'Auf diesem Hallen-Server wird immer nur ein Turnier ausgetragen. Das Anlegen löscht alle Daten des bisherigen Turniers (Teilnehmer, Pools, Kämpfe). Fortfahren?',
                            'Neues Turnier anlegen',
                            'warning'
                        )
                        : confirm('Alle Daten des bisherigen Turniers auf diesem Server werden gelöscht. Fortfahren?');
                    if (!bestaetigt) return;
                }
            }

            // Endpoint und Methode dynamisch anpassen (PUT bei Update, POST bei Neuanlage)
            const url = turnierId ? `/api/turniere/${turnierId}` : '/api/turniere';
            const method = turnierId ? 'PUT' : 'POST';

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();

                if (result.success || response.ok) {
                    // Globale grüne Material-Notification aus der navigation.js triggern
                    if (window.zeigeNotification) {
                        window.zeigeNotification(
                            turnierId ? 'Turnier erfolgreich aktualisiert!' : 'Turnier erfolgreich angelegt!',
                            'success'
                        );
                    }

                    // Bei einer Neuanlage zur URL mit ID weiterleiten, um Menüpunkte freizuschalten
                    if (!turnierId && result.turnierId) {
                        setTimeout(() => {
                            window.location.href = `/turnier.html?id=${result.turnierId}`;
                        }, 1000);
                    } else if (turnierId && ausschreibungPdfBase64 !== undefined) {
                        // Update ohne Reload: lokalen Ausschreibungs-Status auf den gerade
                        // gespeicherten Stand bringen (verhindert doppeltes Mitschicken beim
                        // nächsten Speichern und aktualisiert "ansehen"/"entfernen"-Sichtbarkeit).
                        bestehendeAusschreibungVorhanden = !!ausschreibungPdfBase64;
                        ausschreibungNeueDatei = null;
                        ausschreibungPdfBase64 = undefined;
                        aktualisiereAusschreibungAnzeige();
                    }
                } else {
                    if (window.zeigeNotification) {
                        window.zeigeNotification(result.error || 'Fehler beim Speichern des Turniers.', 'error');
                    }
                }
            } catch (error) {
                if (window.zeigeNotification) {
                    window.zeigeNotification('Netzwerk- oder Serverfehler: ' + error.message, 'error');
                }
            }
        });
    }

    // --- LEBENSZYKLUS-BUTTONS + EXPORT/IMPORT-ERGEBNISSE (nur im Edit-Modus) ---
    // Der Server liefert status/status_effektiv/teilnehmer_anzahl bereits fertig berechnet
    // (ermittleEffektivenStatus in turnierController.js) — der Client berechnet nichts mehr selbst.
    const exportTurnierBtn = document.getElementById('exportTurnierBtn');
    const importTurnierBtn = document.getElementById('importTurnierBtn');
    const veroeffentlichenBtn = document.getElementById('veroeffentlichenBtn');
    const durchfuehrungBeendenBtn = document.getElementById('durchfuehrungBeendenBtn');
    const absagenBtn = document.getElementById('absagenBtn');
    const loeschenBtn = document.getElementById('loeschenBtn');

    async function fuehreLebenszyklusAktionAus(endpoint, erfolgsmeldung, weiterleitung) {
        try {
            const response = await fetch(`/api/turniere/${turnierId}/${endpoint}`, { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Aktion fehlgeschlagen.');

            if (window.zeigeNotification) window.zeigeNotification(erfolgsmeldung, 'success');
            if (weiterleitung) {
                window.location.href = weiterleitung;
            } else {
                window.location.reload();
            }
        } catch (err) {
            if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
            else alert(err.message);
        }
    }

    async function pruefeUndZeigeLebenszyklusButtons() {
        if (!turnierId) return;

        try {
            const [meResp, turnierResp, configResp] = await Promise.all([
                fetch('/api/auth/me'),
                fetch(`/api/turniere/${turnierId}`),
                fetch('/api/config')
            ]);
            if (!meResp.ok || !turnierResp.ok) return;

            const user = (await meResp.json()).user;
            const turnier = await turnierResp.json();
            const istOffline = configResp.ok && !!(await configResp.json()).isOffline;
            const gehoertZuEigenemVerein = !!(user.verein_id && turnier.verein_id === user.verein_id);
            const darfBearbeiten = istOffline || gehoertZuEigenemVerein;
            if (!darfBearbeiten) return;

            const status = turnier.status;
            const statusEffektiv = turnier.status_effektiv;
            const teilnehmerAnzahl = turnier.teilnehmer_anzahl || 0;

            // Wettkampftag-Prüfung wie in ermittleEffektivenStatus() (turnierController.js) —
            // status_effektiv kann bereits vor dem Wettkampftag "in_durchfuehrung" werden, wenn
            // echte Kämpfe existieren. "Abgeschlossenes Turnier hochladen" und "Durchführung
            // beenden" sollen aber unabhängig davon erst am Veranstaltungstag selbst erscheinen.
            const heuteStr = new Date().toISOString().slice(0, 10);
            const wettkampftagErreicht = !!turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;

            if (exportTurnierBtn && ['anmeldung_geschlossen', 'in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv)) {
                exportTurnierBtn.style.display = 'inline-flex';
            }
            if (importTurnierBtn && !istOffline && wettkampftagErreicht && ['anmeldung_geschlossen', 'in_durchfuehrung'].includes(statusEffektiv)) {
                importTurnierBtn.style.display = 'inline-flex';
            }
            if (veroeffentlichenBtn && status === 'entwurf') {
                veroeffentlichenBtn.style.display = 'inline-flex';
            }
            if (durchfuehrungBeendenBtn && statusEffektiv === 'in_durchfuehrung' && wettkampftagErreicht) {
                durchfuehrungBeendenBtn.style.display = 'inline-flex';
            }
            if (absagenBtn && status !== 'abgeschlossen') {
                absagenBtn.style.display = 'inline-flex';
            }
            if (loeschenBtn && !['in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv) && teilnehmerAnzahl === 0) {
                loeschenBtn.style.display = 'inline-flex';
            }
        } catch (err) {
            console.error('Fehler bei der Lebenszyklus-Berechtigungsprüfung:', err);
        }
    }
    pruefeUndZeigeLebenszyklusButtons();

    if (veroeffentlichenBtn) {
        veroeffentlichenBtn.addEventListener('click', async () => {
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung('Das Turnier wird für andere Vereine sichtbar und die Anmeldung startet. Fortfahren?', 'Turnier veröffentlichen', 'info')
                : confirm('Das Turnier wird für andere Vereine sichtbar und die Anmeldung startet. Fortfahren?');
            if (bestaetigt) fuehreLebenszyklusAktionAus('veroeffentlichen', 'Turnier veröffentlicht.');
        });
    }
    if (durchfuehrungBeendenBtn) {
        durchfuehrungBeendenBtn.addEventListener('click', async () => {
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung('Das Turnier wechselt in den schreibgeschützten Archiv-Zustand "Abgeschlossen". Fortfahren?', 'Durchführung beenden', 'warning')
                : confirm('Das Turnier wechselt in den Archiv-Zustand "Abgeschlossen". Fortfahren?');
            if (bestaetigt) fuehreLebenszyklusAktionAus('durchfuehrung-beenden', 'Durchführung beendet.');
        });
    }
    if (absagenBtn) {
        absagenBtn.addEventListener('click', async () => {
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung('Das Turnier wird als abgesagt markiert. Fortfahren?', 'Turnier absagen', 'warning')
                : confirm('Das Turnier wird als abgesagt markiert. Fortfahren?');
            if (bestaetigt) fuehreLebenszyklusAktionAus('absagen', 'Turnier abgesagt.');
        });
    }
    if (loeschenBtn) {
        loeschenBtn.addEventListener('click', async () => {
            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung('Das Turnier wird unwiderruflich gelöscht. Fortfahren?', 'Turnier löschen', 'warning')
                : confirm('Das Turnier wird unwiderruflich gelöscht. Fortfahren?');
            if (!bestaetigt) return;

            try {
                const response = await fetch(`/api/turniere/${turnierId}`, { method: 'DELETE' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Löschen fehlgeschlagen.');

                if (window.zeigeNotification) window.zeigeNotification('Turnier gelöscht.', 'success');
                window.location.href = '/turniere.html';
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
                else alert(err.message);
            }
        });
    }

    if (exportTurnierBtn) {
        exportTurnierBtn.addEventListener('click', async () => {
            try {
                const response = await fetch(`/api/turniere/${turnierId}/export`);
                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || 'Export fehlgeschlagen.');
                }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `turnier_${turnierId}_export.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                if (window.zeigeNotification) {
                    window.zeigeNotification('Turnier-Export wurde heruntergeladen.', 'success');
                }
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
                else alert(err.message);
            }
        });
    }

    // --- ABGESCHLOSSENES TURNIER HOCHLADEN (nur online, nur beim Bearbeiten eines bestehenden
    // Turniers, nur für Mitglieder des ausrichtenden Vereins) — lädt die Ergebnisse eines
    // offline durchgeführten Turniers hoch und ersetzt DAMIT NUR dessen Wettkampfdaten
    // (Kampfflächen/Pools/Teilnehmer/Kämpfe), nicht das Turnier selbst. Sichtbarkeit wird bereits
    // oben in pruefeUndZeigeLebenszyklusButtons() gesetzt.
    const importTurnierFileInput = document.getElementById('importTurnierFileInput');
    const importTurnierStatus = document.getElementById('importTurnierStatus');

    function liesDateiAlsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    if (importTurnierBtn && importTurnierFileInput) {
        importTurnierBtn.addEventListener('click', () => importTurnierFileInput.click());

        importTurnierFileInput.addEventListener('change', async () => {
            const file = importTurnierFileInput.files[0];
            importTurnierFileInput.value = '';
            if (!file) return;

            const bestaetigt = window.zeigeZentraleBestaetigung
                ? await window.zeigeZentraleBestaetigung(
                    'Der Upload ersetzt Kampfflächen, Pools, Teilnehmer und Kämpfe dieses Turniers durch den Inhalt der Datei. Die Turnier-Stammdaten selbst bleiben unverändert. Fortfahren?',
                    'Ergebnisse hochladen',
                    'warning'
                )
                : confirm('Der Upload ersetzt die Wettkampfdaten dieses Turniers durch den Inhalt der Datei. Fortfahren?');
            if (!bestaetigt) return;

            importTurnierStatus.style.display = 'block';
            importTurnierStatus.textContent = `Lade "${file.name}" hoch ...`;

            try {
                const contentBase64 = await liesDateiAlsBase64(file);
                const response = await fetch(`/api/turniere/${turnierId}/import-ergebnisse`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contentBase64 })
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Upload fehlgeschlagen.');
                }

                const meldung = `Ergebnisse hochgeladen: ${data.imported.teilnehmer} Teilnehmer, ${data.imported.pools} Pools, ${data.imported.kampfflaechen} Matten.`;
                importTurnierStatus.textContent = meldung;
                if (window.zeigeNotification) window.zeigeNotification(meldung, 'success');

                window.location.href = `/teilnehmer.html?turnierId=${turnierId}`;
            } catch (err) {
                importTurnierStatus.textContent = '';
                if (window.zeigeNotification) window.zeigeNotification('Upload-Fehler: ' + err.message, 'error');
                else alert('Upload-Fehler: ' + err.message);
            }
        });
    }
});
