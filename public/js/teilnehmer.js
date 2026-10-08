document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const turnierId = urlParams.get('turnierId') || urlParams.get('id');

    if (!turnierId) {
        alert('Fehler: Kein aktives Turnier ausgewählt!');
        window.location.href = '/turnier.html';
        return;
    }

    const tableBody = document.getElementById('teilnehmerTableBody');

    // --- TURNIER-ALTERSKLASSEN (welche Klassen werden bei diesem Turnier überhaupt ausgetragen) ---
    let turnierAltersklassenKeys = null; // null = keine Einschränkung bekannt/hinterlegt
    let turnierKostenlos = false; // true, wenn Startgeld des Turniers 0€ ist -> gilt für alle als "bezahlt"

    // --- IMPORT-ZIEL (Einzel/Mannschaft): wird zur Entscheidung benötigt, ob beim Import
    // nachgefragt werden muss oder das Ziel eindeutig aus den Turnier-Einstellungen folgt.
    let turnierHatEinzelKlassen = false;
    let turnierHatMannschaftKlassen = false;

    // --- MANNSCHAFTS-ZUORDNUNG (welcher Teilnehmer gehört zu welchem Team, auf welcher Position) ---
    // turnier_teilnehmer_id -> { bezeichnung, gewichtsklasse }; nur relevant/befüllt, wenn dieses
    // Turnier überhaupt Mannschafts-Altersklassen austrägt (siehe turnierHatMannschaftKlassen).
    // Maßgeblich dafür, ob jemand tatsächlich einer Mannschaft angehört (Positions-Zuordnung in
    // mannschaft_mitglieder) — nicht zu verwechseln mit dem reinen Import-Merkmal fuer_mannschaft
    // (siehe formatiereAltersklasse), das nur eine Absichtserklärung ohne Team-Zuordnung ist.
    let teamInfoByTeilnehmerId = new Map();

    async function ladeMannschaftsZuordnung() {
        if (!turnierHatMannschaftKlassen) return;
        try {
            const resp = await fetch(`/api/mannschaften?turnierId=${turnierId}`);
            if (!resp.ok) return;
            const teams = await resp.json();

            teamInfoByTeilnehmerId = new Map();
            (Array.isArray(teams) ? teams : []).forEach(team => {
                (team.mitglieder || []).forEach(m => {
                    teamInfoByTeilnehmerId.set(m.turnier_teilnehmer_id, {
                        bezeichnung: team.bezeichnung,
                        gewichtsklasse: m.gewichtsklasse
                    });
                });
            });
        } catch (err) {
            console.error('Fehler beim Laden der Mannschafts-Zuordnung:', err);
        }
    }

    // Die "Team"-Spalte (siehe teilnehmer.html) ist nur sinnvoll, wenn das Turnier überhaupt
    // Mannschaftswettkämpfe austrägt — sonst bliebe sie für jeden Teilnehmer leer.
    function aktualisiereTeamSpalteSichtbarkeit() {
        const header = document.getElementById('teamSpalteHeader');
        if (header) header.style.display = turnierHatMannschaftKlassen ? '' : 'none';
    }

    // --- ZAHLUNGSDATEN DES TURNIERS (für den "Startgeld bezahlen"-QR-Code) ---
    let turnierBezeichnung = '';
    let turnierStartgeldWert = 0;
    let turnierDatumText = null; // Wettkampftag (YYYY-MM-DD): Stichtag der Lizenzprüfung
    let turnierIban = '';
    let turnierKontoinhaber = '';
    let turnierVerwendungszweck = '';

    // --- SPERRE DER TEILNEHMER JE ALTERSKLASSE, SOBALD IHRE POOLS ECHTE KÄMPFE HABEN ---
    // (Waage in Runden: andere Altersklassen bleiben bearbeitbar.) teilnehmerlisteGesperrt = mindestens
    // eine Altersklasse gesperrt (Alias wie in /api/pools/vorhanden).
    let teilnehmerlisteGesperrt = false;
    let gesperrteAltersklassen = new Set();
    // Mannschaftsmitglieder sind erst gesperrt, wenn ein Mannschafts-Pool echte Kämpfe hatte (wie am Server).
    let mannschaftenGesperrt = false;
    const istTeilnehmerGesperrt = (athlet) => gesperrteAltersklassen.has(athlet.altersklasse)
        || (mannschaftenGesperrt && teamInfoByTeilnehmerId.has(athlet.id));

    async function pruefeTeilnehmerlisteSperre() {
        try {
            const resp = await fetch(`/api/pools/vorhanden?turnierId=${turnierId}`);
            if (!resp.ok) return;
            const data = await resp.json();
            // Ältere Server liefern nur `gesperrt` (turnierweit).
            gesperrteAltersklassen = new Set(Array.isArray(data.gesperrteAltersklassen) ? data.gesperrteAltersklassen : []);
            mannschaftenGesperrt = !!data.mannschaftenGesperrt;
            teilnehmerlisteGesperrt = gesperrteAltersklassen.size > 0 || !!data.gesperrt || mannschaftenGesperrt;

            const banner = document.getElementById('teilnehmerGesperrtBanner');
            const link = document.getElementById('teilnehmerGesperrtPoolsLink');
            const klassenText = document.getElementById('teilnehmerGesperrtKlassen');
            if (link) link.href = `/pools.html?turnierId=${turnierId}`;
            if (klassenText) {
                const teile = [];
                if (gesperrteAltersklassen.size > 0) teile.push(`Gesperrt (Kämpfe haben begonnen): ${[...gesperrteAltersklassen].join(', ')}.`);
                if (mannschaftenGesperrt) teile.push('Mannschaftsmitglieder sind gesperrt, da Mannschaftskämpfe begonnen haben.');
                klassenText.textContent = teile.length > 0
                    ? `${teile.join(' ')} Die übrigen Teilnehmer lassen sich weiter bearbeiten.`
                    : 'Die Teilnehmerliste ist gesperrt, da für dieses Turnier bereits Kämpfe stattgefunden haben.';
            }
            if (banner) banner.style.display = teilnehmerlisteGesperrt ? 'flex' : 'none';

            // Anmelden/Import/Scan bleiben sichtbar: nur bereits ausgeloste Altersklassen weist der
            // Server ab. bulkDeleteBtn wird ausschließlich von updateBulkActionsBar gesteuert.
            updateBulkActionsBar();
        } catch (err) {
            console.error('Fehler beim Prüfen der Teilnehmerlisten-Sperre:', err);
        }
    }

    async function ladeTurnierAltersklassen() {
        try {
            const resp = await fetch(`/api/turniere/${turnierId}`);
            if (!resp.ok) return;
            const turnier = await resp.json();

            let ak = turnier.altersklassen;
            let keys = [];
            if (Array.isArray(ak)) {
                keys = ak;
            } else if (ak && typeof ak === 'object') {
                keys = Object.keys(ak);
            }

            if (keys.length > 0) turnierAltersklassenKeys = keys;
            turnierHatEinzelKlassen = keys.length > 0;
            turnierHatMannschaftKlassen = Array.isArray(turnier.mannschafts_altersklassen) && turnier.mannschafts_altersklassen.length > 0;

            turnierStartgeldWert = parseFloat(turnier.startgeld) || 0;
            turnierKostenlos = turnierStartgeldWert === 0;
            turnierDatumText = turnier.datum ? lokalerTag(turnier.datum) : null;

            turnierBezeichnung = turnier.bezeichnung || '';
            turnierIban = turnier.iban || '';
            turnierKontoinhaber = turnier.kontoinhaber || '';
            turnierVerwendungszweck = turnier.verwendungszweck || '';
        } catch (err) {
            console.error('Fehler beim Laden der Turnier-Altersklassen:', err);
        }
    }

    function istAltersklasseAusgetragen(athlet) {
        if (!turnierAltersklassenKeys) return true;
        const key = `${athlet.geschlecht}_${athlet.altersklasse}`;
        const mixedKey = `mixed_${athlet.altersklasse}`;
        return turnierAltersklassenKeys.includes(key) || turnierAltersklassenKeys.includes(mixedKey) || turnierAltersklassenKeys.includes(athlet.altersklasse);
    }

    // Teilnehmer-Lebenszyklus-Status: Anzeige als eigene Zeile unter dem Namen (ersetzt den
    // früheren roten/grünen Punkt).
    const TEILNEHMER_STATUS_LABELS = {
        angemeldet: { text: 'Angemeldet', farbe: 'blau' },
        zurueckgezogen: { text: 'Zurückgezogen', farbe: 'grau' },
        kampfbereit: { text: 'bereit', farbe: 'gruen' },
        nicht_erschienen: { text: 'Nicht erschienen', farbe: 'rot' },
        teilgenommen: { text: 'Teilgenommen', farbe: 'blau' },
        nicht_angetreten: { text: 'Nicht angetreten', farbe: 'rot' },
        disqualifiziert: { text: 'Disqualifiziert', farbe: 'rot' }
    };

    // Stati, die per Klick auf das Status-Badge direkt gesetzt werden dürfen (siehe
    // MANUELL_SETZBARE_STATI in teilnehmerController.js) — alle Werte des Lebenszyklus, für
    // manuelle Korrekturen. Bei 'teilgenommen'/'nicht_angetreten'/'disqualifiziert' löst das
    // KEINE Kampf-Seiteneffekte aus (kein Forfeit-Sieg für den Gegner) — als Korrektur gedacht,
    // nicht als Ersatz für die Kampf-Aktionen (nicht angetreten/DSQ) in kampf.js.
    const STATUS_MANUELL_SETZBAR = [
        'angemeldet', 'nicht_erschienen', 'kampfbereit',
        'teilgenommen', 'nicht_angetreten', 'disqualifiziert', 'zurueckgezogen'
    ];

    // Kalendertag als "YYYY-MM-DD": PostgreSQL liefert Zeitstempel in UTC (z.B. "2026-10-16T22:00:00.000Z" für den
    // 17.10. in Deutschland), die Dokument-DB reine Tage — beides auf den lokalen Tag abbilden.
    function lokalerTag(wert) {
        const str = String(wert);
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const d = new Date(str);
        if (isNaN(d)) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Ermittelt den Startberechtigt-Status (grün/rot) eines Athleten. Gemeinsam genutzt von
    // Sortierung (rote zuerst) und Tabellen-Rendering, damit beide dieselbe Definition verwenden.
    function berechneStatus(athlet) {
        // Die Lizenz muss am Wettkampftag noch gültig sein (liegt er nicht in der Zukunft, gilt heute).
        const heuteTag = lokalerTag(new Date());
        const stichtag = turnierDatumText && turnierDatumText > heuteTag ? turnierDatumText : heuteTag;
        const lizenzGueltig = !!athlet.lizenz_ablauf && lokalerTag(athlet.lizenz_ablauf) >= stichtag;
        const startgeldBezahlt = turnierKostenlos || !!athlet.startgeld_bezahlt;
        const gewichtEingetragen = athlet.gewicht && parseFloat(athlet.gewicht) > 0;
        const gewogen = !!athlet.gewogen;
        const judopassVorhanden = !!(athlet.judopass_id && String(athlet.judopass_id).trim() !== '');
        const altersklasseGueltig = istAltersklasseAusgetragen(athlet);
        // Die Judopass-Nummer selbst ist keine eigene Voraussetzung mehr — die Lizenzprüfung
        // (lizenzGueltig, per Lizenz-Toggle gesetzt) deckt das ab, da sie an den Judopass
        // gebunden ist. judopassVorhanden bleibt nur als Hinweis in statusDetails erhalten.
        const statusGruen = lizenzGueltig && startgeldBezahlt && gewichtEingetragen && gewogen && altersklasseGueltig;

        return { lizenzGueltig, startgeldBezahlt, gewichtEingetragen, gewogen, judopassVorhanden, altersklasseGueltig, statusGruen };
    }

    // "bereit" gilt nur, solange der Teilnehmer auch tatsächlich gewogen, die Lizenz bestätigt UND das
    // Startgeld bezahlt ist — sonst fällt die Anzeige auf "Angemeldet" zurück, auch wenn der gespeicherte
    // status noch 'kampfbereit' ist. Gemeinsam genutzt von Sortierung und Tabellen-Rendering.
    function istEffektivKampfbereit(athlet) {
        if (athlet.status !== 'kampfbereit') return false;
        const lizenzDatumRoh = athlet.lizenz_ablauf ? String(athlet.lizenz_ablauf).split('T')[0] : null;
        const lizenzBestaetigt = !!lizenzDatumRoh && lizenzDatumRoh !== '1970-01-01';
        return !!athlet.gewogen && lizenzBestaetigt && !!athlet.startgeld_bezahlt;
    }

    // --- GRADUIERUNGEN (Gürtelfarben) ---
    let graduierungenMap = {};

    async function ladeGraduierungen() {
        try {
            const resp = await fetch('/api/graduierungen');
            if (!resp.ok) return;
            const liste = await resp.json();
            liste.forEach(grad => { graduierungenMap[grad.id] = grad; });
        } catch (err) {
            console.error('Fehler beim Laden der Graduierungen:', err);
        }
    }

    function renderGraduierungKreis(athlet) {
        const grad = graduierungenMap[athlet.graduierung];
        if (!grad) {
            return `<span class="graduierung-kreis graduierung-leer" title="Keine Graduierung hinterlegt"></span>`;
        }

        const farben = grad.farben || [];
        const hintergrund = farben.length >= 3
            ? `linear-gradient(to bottom,   ${farben[0]} 0%,      
                                            ${farben[0]} 33.33%,  
                                            ${farben[1]} 33.33%,  
                                            ${farben[1]} 66.66%,  
                                            ${farben[2]} 66.66%, 
                                            ${farben[2]} 100% )`
            : (farben[0] || '#ffffff');

        return `<span class="graduierung-kreis" style="background: ${hintergrund};" title="${grad.label}"></span>`;
    }

    function formatiereAltersklasse(athlet) {
        const istSonderklasse = athlet.altersklasse === 'Männer' || athlet.altersklasse === 'Frauen'
            || athlet.altersklasse === 'Mixed' || athlet.geschlecht === 'mixed';
        // Als "mixed_<AK>" angelegte Klassen werden gemeinsam gepoolt (siehe poolController.js) —
        // dort kein m/w-Kürzel, sondern "x".
        if (!istSonderklasse && turnierAltersklassenKeys && turnierAltersklassenKeys.includes(`mixed_${athlet.altersklasse}`)) {
            return `${athlet.altersklasse}x`;
        }
        const geschlechtsKuerzel = istSonderklasse ? '' : (athlet.geschlecht === 'weiblich' ? 'w' : 'm');
        return `${athlet.altersklasse}${geschlechtsKuerzel}`;
    }

    // Mannschafts-Variante derselben Klassen-Bezeichnung, z.B. "U11W Team" (Geschlechtskürzel
    // großgeschrieben + Zusatz "Team") — bewusst dasselbe Format wie früher bei fuer_mannschaft,
    // jetzt aber unabhängig davon nutzbar für jede tatsächliche Mannschafts-Zuordnung (siehe
    // renderKlasseBadges).
    function formatiereMannschaftsKlasse(athlet) {
        const istSonderklasse = athlet.altersklasse === 'Männer' || athlet.altersklasse === 'Frauen'
            || athlet.altersklasse === 'Mixed' || athlet.geschlecht === 'mixed';
        const geschlechtsKuerzel = istSonderklasse ? '' : (athlet.geschlecht === 'weiblich' ? 'W' : 'M');
        return `${athlet.altersklasse}${geschlechtsKuerzel} Team`;
    }

    // Baut die Klasse-Badge(s) einer Tabellenzeile.
    // - Weder Mannschafts-Absicht (fuer_mannschaft) noch tatsächliche Zuordnung: nur das normale
    //   Einzelwettkampf-Badge (unverändert).
    // - Tatsächlich einer Mannschaft zugeordnet (mannschaft_mitglieder-Eintrag, siehe
    //   teamInfoByTeilnehmerId) UND "auch Einzelwettkampf" aktiv (Icon in der Team-Spalte): BEIDE
    //   Badges nebeneinander (Einzel-Klasse + "... Team").
    // - Tatsächlich zugeordnet, aber ohne dieses Opt-in: NUR das Team-Badge — der Kämpfer nimmt
    //   dann gar nicht an der Einzelwettkampf-Auslosung teil (siehe generierePools in
    //   poolController.js).
    // - Nur die Import-Absichtserklärung (fuer_mannschaft), aber noch keine echte Zuordnung:
    //   ebenfalls nur das Team-Badge, als Übergangs-Anzeige bis zur Zuordnung in mannschaften.html.
    function renderKlasseBadges(athlet, altersklasseGueltig) {
        const individuelleBadge = `<span class="klasse-badge ${altersklasseGueltig ? 'valid' : 'invalid'}" title="${altersklasseGueltig ? 'Wird bei diesem Turnier ausgetragen' : 'Diese Altersklasse wird bei diesem Turnier nicht ausgetragen'}">${formatiereAltersklasse(athlet)}</span>`;

        const teamInfo = teamInfoByTeilnehmerId.get(athlet.id);
        if (!teamInfo && !athlet.fuer_mannschaft) return individuelleBadge;

        const teamTitel = teamInfo ? `Mannschaft: ${escapeHtml(teamInfo.bezeichnung)}` : 'Für Mannschaft gemeldet';
        const teamBadge = `<span class="klasse-badge team" title="${teamTitel}">${formatiereMannschaftsKlasse(athlet)}</span>`;

        return (teamInfo && athlet.auch_einzelwettkampf) ? `${individuelleBadge} ${teamBadge}` : teamBadge;
    }

    // Liefert einen numerischen Sortierwert für die Altersklasse, damit z.B. "U11" nicht (als
    // String) fälschlich vor "U9" einsortiert wird. U-Klassen nach ihrer Zahl aufsteigend, freie
    // Ü/Veteranen-Klassen danach, Männer/Frauen/Mixed/sonstige Erwachsenenklassen dazwischen.
    function altersklasseSortWert(altersklasse) {
        const ak = String(altersklasse || '').trim();
        if (!ak) return Infinity;

        const uMatch = ak.match(/^U\s*(\d+)$/i);
        if (uMatch) return parseInt(uMatch[1], 10);

        const ueMatch = ak.match(/Ü\s*(\d+)/i);
        if (ueMatch) return 1000 + parseInt(ueMatch[1], 10);
        if (/veteranen/i.test(ak)) return 1030;

        return 999;
    }

    // --- SORTIERUNG ---
    let athletenDaten = [];
    let aktiveSortierung = 'nachname';
    let sortierRichtung = 'asc';

    // --- SUCHE ---
    // Filtert athletenDaten anhand des aktuellen Suchfeld-Werts (Name/Vorname/Verein).
    // Wird sowohl beim Laden als auch beim Sortieren angewendet, damit ein aktiver
    // Suchbegriff beim Klick auf eine Spaltenüberschrift nicht verloren geht.
    function gefilterteAthleten() {
        const suchfeld = document.getElementById('teilnehmerSearchInput');
        const begriff = (suchfeld ? suchfeld.value : '').trim().toLowerCase();
        if (!begriff) return athletenDaten;

        return athletenDaten.filter(athlet => {
            const nachname = (athlet.nachname || '').toLowerCase();
            const vorname = (athlet.vorname || '').toLowerCase();
            const verein = (athlet.verein || '').toLowerCase();
            return nachname.includes(begriff) || vorname.includes(begriff) || verein.includes(begriff);
        });
    }

    function sortiereUndRendere() {
        const sortiert = sortiereAthleten(gefilterteAthleten(), aktiveSortierung, sortierRichtung);
        renderTabelle(sortiert);
    }

    // --- GASTGEBER-STATUS (steuert hartes Löschen vs. Zurückziehen, sowie die Sichtbarkeit der
    // Gewogen-/Lizenz-Spalte und -Kacheln, siehe aktualisiereGewogenLizenzSichtbarkeit) ---
    let istGastgeberVerein = false;
    async function ermittleGastgeberStatus() {
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
            // verein_freigegeben ist zwingend Teil der Prüfung — ein noch nicht freigegebenes
            // Mitglied des ausrichtenden Vereins darf serverseitig (hatVereinsZugriffAufTurnier)
            // ebenfalls nicht hart löschen, sonst zeigt der Button "Löschen" fälschlich an, obwohl
            // der Klick serverseitig mit "Nur Mitglieder des ausrichtenden Vereins..." abgelehnt wird.
            istGastgeberVerein = istOffline || !!(user.verein_id && user.verein_freigegeben && turnier.verein_id === user.verein_id);
        } catch (err) {
            console.error('Fehler beim Ermitteln des Gastgeber-Status:', err);
        }
    }

    // Gewogen/Lizenz sind physische Verifikationen am Wiegetisch des Ausrichters — für Nutzer
    // anderer Vereine weder einsehbar noch änderbar, daher Spalte + Kachel komplett ausgeblendet
    // (Bezahlt bleibt sichtbar: das verantwortet jeder Verein für seine eigenen Kämpfer selbst).
    function aktualisiereGewogenLizenzSichtbarkeit() {
        const anzeigen = istGastgeberVerein;
        const gewogenHeader = document.getElementById('gewogenSpalteHeader');
        const lizenzHeader = document.getElementById('lizenzSpalteHeader');
        const gewogenKachel = document.getElementById('statGewogenKachel');
        const lizenzKachel = document.getElementById('statLizenzKachel');
        if (gewogenHeader) gewogenHeader.style.display = anzeigen ? '' : 'none';
        if (lizenzHeader) lizenzHeader.style.display = anzeigen ? '' : 'none';
        if (gewogenKachel) gewogenKachel.style.display = anzeigen ? '' : 'none';
        if (lizenzKachel) lizenzKachel.style.display = anzeigen ? '' : 'none';
    }

    function sortiereAthleten(daten, sortKey, richtung) {
        const sorted = [...daten].sort((a, b) => {
            // Bereits Gewogene (und damit auch Kampfbereite) stehen immer ganz unten (unabhängig von Spalte
            // und Richtung), darüber folgt die gewählte Sortierung, bei Gleichstand nach Name.
            const gewogenA = !!a.gewogen;
            const gewogenB = !!b.gewogen;
            if (gewogenA !== gewogenB) {
                return gewogenA ? 1 : -1;
            }

            const nachName = (x, y) => `${x.nachname} ${x.vorname}`.localeCompare(`${y.nachname} ${y.vorname}`, 'de', { sensitivity: 'base' });

            let valA, valB;

            switch (sortKey) {
                case 'nachname':
                    return richtung === 'asc' ? nachName(a, b) : -nachName(a, b);
                case 'verein':
                    valA = (a.verein || '').toLowerCase();
                    valB = (b.verein || '').toLowerCase();
                    break;
                case 'team':
                    valA = (teamInfoByTeilnehmerId.get(a.id)?.bezeichnung || '').toLowerCase();
                    valB = (teamInfoByTeilnehmerId.get(b.id)?.bezeichnung || '').toLowerCase();
                    break;
                case 'klasse':
                    valA = altersklasseSortWert(a.altersklasse);
                    valB = altersklasseSortWert(b.altersklasse);
                    // Bei gleicher Altersklasse zusätzlich nach Gewichtsklasse sortieren
                    if (valA === valB) {
                        valA = (a.gewichtsklasse || '').toLowerCase();
                        valB = (b.gewichtsklasse || '').toLowerCase();
                    }
                    break;
                case 'gewicht':
                    // Deutsches Komma-Dezimaltrennzeichen (z.B. aus älteren Importen) robust
                    // mitbehandeln, sonst schneidet parseFloat bei "26,5" auf 26 ab.
                    valA = parseFloat(String(a.gewicht ?? '').replace(',', '.')) || 0;
                    valB = parseFloat(String(b.gewicht ?? '').replace(',', '.')) || 0;
                    break;
                default:
                    return nachName(a, b);
            }

            if (valA < valB) return richtung === 'asc' ? -1 : 1;
            if (valA > valB) return richtung === 'asc' ? 1 : -1;
            return nachName(a, b);
        });

        return sorted;
    }

    function aktualisiereSortierIcons() {
        document.querySelectorAll('.judo-table th.sortable').forEach(th => {
            const icon = th.querySelector('.sort-icon');
            const key = th.getAttribute('data-sort');

            th.classList.remove('active-sort');
            if (icon) icon.textContent = '';

            if (key === aktiveSortierung) {
                th.classList.add('active-sort');
                th.setAttribute('data-dir', sortierRichtung);
                if (icon) icon.textContent = sortierRichtung === 'asc' ? 'arrow_upward' : 'arrow_downward';
            }
        });
    }

    // Handy-Ansicht (html.modus-handy, siehe css/handy.css): dieselben Daten als Karten — Name, Verein,
    // Jahrgang/Klasse und rechts "gewogen" (Gewicht) bzw. "offen". Tippen öffnet die Waage.
    function renderHandyKarten(athleten) {
        const container = document.getElementById('handyKarten');
        if (!container) return;
        if (athleten.length === 0) {
            container.innerHTML = '<p class="handy-leer">Noch keine Teilnehmer.</p>';
            return;
        }
        container.innerHTML = athleten.map(athlet => {
            const { gewogen } = berechneStatus(athlet);
            const gewichtFloat = parseFloat(athlet.gewicht) || 0;
            const istZurueckgezogen = athlet.status === 'zurueckgezogen';
            const chip = istZurueckgezogen
                ? '<span class="handy-chip handy-chip-grau">zurückgezogen</span>'
                : gewogen && gewichtFloat > 0
                    ? `<span class="handy-chip handy-chip-gruen">${gewichtFloat.toFixed(2).replace('.', ',')} kg</span>`
                    : '<span class="handy-chip handy-chip-gelb">offen</span>';
            const klasse = formatiereAltersklasse(athlet);
            const unterzeile = [athlet.verein, athlet.geburtsjahr, klasse].filter(Boolean).map(escapeHtml).join(' · ');
            const klickbar = !istZurueckgezogen && !istTeilnehmerGesperrt(athlet);
            return `<div class="handy-karte${klickbar ? '' : ' handy-karte-gesperrt'}" ${klickbar ? `data-id="${athlet.id}"` : ''}>
                <div class="handy-karte-text">
                    <div class="handy-karte-name">${escapeHtml(athlet.nachname)}, ${escapeHtml(athlet.vorname)}</div>
                    <div class="handy-karte-sub">${unterzeile}</div>
                </div>
                ${chip}
            </div>`;
        }).join('');
    }

    document.getElementById('handyKarten')?.addEventListener('click', (e) => {
        const karte = e.target.closest('.handy-karte[data-id]');
        if (karte) window.oeffneWaageModal(Number(karte.dataset.id));
    });

    function renderTabelle(athleten) {
        if (document.documentElement.classList.contains('modus-app')) renderHandyKarten(athleten);
        if (athleten.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="12" class="no-data">Noch keine Kämpfer für dieses Turnier eingewogen.</td></tr>`;
            updateBulkActionsBar();
            return;
        }

        tableBody.innerHTML = athleten.map(athlet => {
            const { lizenzGueltig, startgeldBezahlt, gewichtEingetragen, gewogen, judopassVorhanden, altersklasseGueltig, statusGruen } = berechneStatus(athlet);
            const teamInfo = teamInfoByTeilnehmerId.get(athlet.id);

            let statusDetails = [];
            if (!judopassVorhanden) statusDetails.push('Judopass-ID fehlt');
            if (!lizenzGueltig) statusDetails.push('Lizenz nicht bestätigt');
            if (!startgeldBezahlt) statusDetails.push('Startgeld offen');
            if (!gewichtEingetragen) statusDetails.push('Gewicht fehlt');
            if (!gewogen) statusDetails.push('Nicht gewogen');
            if (!altersklasseGueltig) statusDetails.push('Altersklasse wird bei diesem Turnier nicht ausgetragen');

            const statusTitle = statusGruen
                ? 'Status: Startberechtigt (Lizenz bestätigt, Startgeld bezahlt, gewogen)'
                : `Status: Nicht startberechtigt (${statusDetails.join(', ')})`;

            const gewichtFloat = parseFloat(athlet.gewicht) || 0;
            const gewichtFarbe = gewichtFloat > 0 ? 'var(--primary)' : '#c62828';

            const lizenzDatumRoh = athlet.lizenz_ablauf ? String(athlet.lizenz_ablauf).split('T')[0] : null;
            const lizenzBestaetigt = !!lizenzDatumRoh && lizenzDatumRoh !== '1970-01-01';

            // Für das Icon selbst zählt immer der tatsächlich gespeicherte Wert — startgeldBezahlt
            // (aus berechneStatus) ist bei kostenlosen Turnieren IMMER true (turnierKostenlos-
            // Override für die Startberechtigt-Ampel) und würde das Icon sonst dauerhaft auf
            // "bezahlt" einfrieren, ohne dass ein Klick eine sichtbare Änderung bewirkt.
            const startgeldBezahltRoh = !!athlet.startgeld_bezahlt;

            // Zurückgezogene Anmeldungen bleiben zur Nachvollziehbarkeit sichtbar, aber
            // ausgegraut und nicht mehr editierbar.
            const istZurueckgezogen = athlet.status === 'zurueckgezogen';

            // "bereit" darf nur angezeigt werden, solange der Teilnehmer auch tatsächlich gewogen,
            // die Lizenz bestätigt UND das Startgeld bezahlt ist — wird eines von beidem
            // nachträglich per Icon zurückgenommen (siehe startgeldBezahltRoh oben), fällt die
            // Anzeige auf "Angemeldet" zurück, auch wenn der gespeicherte status noch
            // 'kampfbereit' ist.
            const effektiverStatus = (athlet.status === 'kampfbereit' && !istEffektivKampfbereit(athlet))
                ? 'angemeldet'
                : athlet.status;
            const { text: teilnehmerStatusText, farbe: teilnehmerStatusFarbe } = TEILNEHMER_STATUS_LABELS[effektiverStatus] || { text: effektiverStatus || '', farbe: 'grau' };

            return `
                <tr${istZurueckgezogen ? ' style="opacity: 0.5;"' : ''}>
                    <td style="text-align: center; vertical-align: middle;">
                        <input type="checkbox" class="row-checkbox" data-id="${athlet.id}" style="transform: scale(1.2); cursor: pointer;" ${istZurueckgezogen || istTeilnehmerGesperrt(athlet) ? 'disabled' : ''}>
                    </td>
                    <td>
                        <strong>${athlet.nachname}</strong>, ${athlet.vorname}
                    </td>
                    <td style="text-align: center;" title="${statusTitle}">
                        ${STATUS_MANUELL_SETZBAR.includes(athlet.status) ? `
                            <select class="status-badge status-select status-${teilnehmerStatusFarbe}" data-status-select data-id="${athlet.id}" title="Status ändern">
                                ${STATUS_MANUELL_SETZBAR.map(s => `<option value="${s}" ${effektiverStatus === s ? 'selected' : ''}>${TEILNEHMER_STATUS_LABELS[s].text}</option>`).join('')}
                            </select>
                        ` : `<span class="status-badge status-${teilnehmerStatusFarbe}">${teilnehmerStatusText}</span>`}
                    </td>
                    <td style="text-align: center;">${renderGraduierungKreis(athlet)}</td>
                    <td>${athlet.verein}</td>
                    <td${turnierHatMannschaftKlassen ? '' : ' style="display: none;"'}>
                        ${teamInfo ? `
                            <span>${escapeHtml(teamInfo.bezeichnung)}</span>
                            <span class="material-icons action-icon icon-toggle ${athlet.auch_einzelwettkampf ? 'active' : ''}" data-id="${athlet.id}" data-toggle="auch_einzelwettkampf" title="${athlet.auch_einzelwettkampf ? 'Nimmt zusätzlich am Einzelwettkampf teil (klicken zum Entfernen)' : 'Nimmt nur an der Mannschaft teil (klicken, um zusätzlich am Einzelwettkampf teilzunehmen)'}" style="font-size: 16px; vertical-align: middle; margin-left: 4px; padding: 2px;">person</span>
                        ` : '–'}
                    </td>
                    <td>${renderKlasseBadges(athlet, altersklasseGueltig)}</td>
                    <td style="font-weight: 700; color: ${gewichtFarbe};">${gewichtFloat.toFixed(2).replace('.', ',')} kg</td>
                    <td style="text-align: center;${istGastgeberVerein ? '' : ' display: none;'}">
                        <span class="material-icons action-icon icon-toggle ${gewogen ? 'active' : ''}" data-id="${athlet.id}" data-toggle="gewogen" title="${gewogen ? 'Als nicht gewogen markieren' : 'Als gewogen markieren'}">scale</span>
                    </td>
                    <td style="text-align: center;${istGastgeberVerein ? '' : ' display: none;'}">
                        <span class="material-icons action-icon icon-toggle ${lizenzBestaetigt ? 'active' : ''}" data-id="${athlet.id}" data-toggle="lizenz" title="${lizenzBestaetigt ? 'Lizenz-Bestätigung zurücknehmen' : 'Lizenz bestätigen'}">badge</span>
                    </td>
                    <td style="text-align: center;">
                        <span class="material-icons action-icon icon-toggle ${startgeldBezahltRoh ? 'active' : ''}" data-id="${athlet.id}" data-toggle="bezahlt" title="${startgeldBezahltRoh ? 'Als unbezahlt markieren' : 'Als bezahlt markieren'}">payments</span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            ${istTeilnehmerGesperrt(athlet) ? `
                                <span class="material-icons action-icon" style="color: var(--text-muted); opacity: 0.3; cursor: not-allowed;" title="Gesperrt: Die Kämpfe dieser Altersklasse haben bereits begonnen">lock</span>
                            ` : `
                                <span class="material-icons action-icon icon-edit" title="Eintrag bearbeiten" onclick="window.oeffneWaageModal(${athlet.id})">edit</span>
                                <span class="material-icons action-icon icon-delete" data-id="${athlet.id}" data-name="${athlet.vorname} ${athlet.nachname}">delete</span>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Ensure bulk action bar state is updated on every render
        updateBulkActionsBar();

        // Delete-Handler: Gastgeber-Verein löscht hart (Fehlerkorrektur), alle anderen ziehen
        // nur die eigene Anmeldung zurück (Datensatz bleibt für Nachvollziehbarkeit erhalten).
        document.querySelectorAll('.icon-delete').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const name = e.target.getAttribute('data-name');
                const zielUrl = istGastgeberVerein ? `/api/teilnehmer/${id}` : `/api/teilnehmer/${id}/zurueckziehen`;
                const methode = istGastgeberVerein ? 'DELETE' : 'POST';

                const bestaetigt = await window.zeigeZentraleBestaetigung(
                    istGastgeberVerein
                        ? `Möchten Sie den Athleten ${name} wirklich unwiderruflich aus der Waage-Liste löschen?`
                        : `Möchten Sie die Anmeldung von ${name} wirklich zurückziehen?`,
                    istGastgeberVerein ? 'Teilnehmer entfernen' : 'Anmeldung zurückziehen',
                    'person_remove'
                );

                if (bestaetigt) {
                    try {
                        if (window.zeigeLadeModal) window.zeigeLadeModal(istGastgeberVerein ? 'Teilnehmer wird entfernt…' : 'Anmeldung wird zurückgezogen…');
                        const delResponse = await fetch(zielUrl, { method: methode });
                        const result = await delResponse.json();

                        if (result.success) {
                            window.zeigeNotification(istGastgeberVerein ? `Athlet ${name} erfolgreich entfernt.` : `Anmeldung von ${name} zurückgezogen.`, 'success');
                            ladeTeilnehmer();
                        } else {
                            window.zeigeNotification('Fehler: ' + result.error, 'error');
                        }
                    } catch (err) {
                        window.zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                    } finally {
                        if (window.versteckeLadeModal) window.versteckeLadeModal();
                    }
                }
            });
        });

        // Gewogen/Lizenz/Bezahlt Quick-Toggle-Handler
        document.querySelectorAll('.icon-toggle').forEach(button => {
            button.addEventListener('click', async (e) => {
                const id = parseInt(e.target.getAttribute('data-id'), 10);
                const toggleType = e.target.getAttribute('data-toggle');
                const athlet = athletenDaten.find(a => a.id === id);
                if (!athlet) return;
                if (istTeilnehmerGesperrt(athlet) && toggleType === 'gewogen') {
                    window.zeigeNotification('Gesperrt: Die Kämpfe dieser Altersklasse haben bereits begonnen.', 'error');
                    return;
                }

                let payload;
                let ladeNachricht = null;
                if (toggleType === 'gewogen') {
                    payload = { gewogen: !athlet.gewogen };
                    ladeNachricht = 'Gewogen-Status wird aktualisiert…';
                } else if (toggleType === 'lizenz') {
                    const lizenzDatumRoh = athlet.lizenz_ablauf ? String(athlet.lizenz_ablauf).split('T')[0] : null;
                    const istLizenzBestaetigt = !!lizenzDatumRoh && lizenzDatumRoh !== '1970-01-01';
                    const naechstesJahr = new Date().getFullYear() + 1;
                    payload = { lizenz_ablauf: istLizenzBestaetigt ? '1970-01-01' : `${naechstesJahr}-12-31` };
                    ladeNachricht = 'Lizenz wird aktualisiert…';
                } else if (toggleType === 'bezahlt') {
                    payload = { startgeld_bezahlt: !athlet.startgeld_bezahlt };
                    ladeNachricht = 'Bezahlt-Status wird aktualisiert…';
                } else if (toggleType === 'auch_einzelwettkampf') {
                    payload = { auch_einzelwettkampf: !athlet.auch_einzelwettkampf };
                } else {
                    return;
                }

                try {
                    if (ladeNachricht && window.zeigeLadeModal) window.zeigeLadeModal(ladeNachricht);
                    const response = await fetch(`/api/teilnehmer/${id}/status`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json();
                    if (result.success) {
                        await ladeTeilnehmer();
                    } else {
                        window.zeigeNotification('Fehler beim Aktualisieren: ' + result.error, 'error');
                    }
                } catch (err) {
                    window.zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                } finally {
                    if (ladeNachricht && window.versteckeLadeModal) window.versteckeLadeModal();
                }
            });
        });

        // Status-Badge Klick-Handler (Dropdown): direktes Setzen von angemeldet/nicht_erschienen/
        // kampfbereit/zurueckgezogen ohne Umweg über den Wiegetisch bzw. das Zurückziehen-Icon.
        document.querySelectorAll('[data-status-select]').forEach(select => {
            select.addEventListener('click', (e) => e.stopPropagation());
            select.addEventListener('change', async (e) => {
                const id = parseInt(e.target.getAttribute('data-id'), 10);
                const neuerStatus = e.target.value;

                try {
                    const response = await fetch(`/api/teilnehmer/${id}/status`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: neuerStatus })
                    });
                    const result = await response.json();
                    if (result.success) {
                        await ladeTeilnehmer();
                    } else {
                        window.zeigeNotification('Fehler beim Ändern des Status: ' + result.error, 'error');
                        await ladeTeilnehmer(); // Auswahl auf tatsächlichen Status zurücksetzen
                    }
                } catch (err) {
                    window.zeigeNotification('Netzwerkfehler: ' + err.message, 'error');
                    await ladeTeilnehmer();
                }
            });
        });
    }

    // --- BULK SELECTION & ACTIONS ---
    function updateBulkActionsBar() {
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const checkboxes = document.querySelectorAll('.row-checkbox');
        const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
        const bulkMarkPaidBtn = document.getElementById('bulkMarkPaidBtn');
        const bulkMarkWeighedBtn = document.getElementById('bulkMarkWeighedBtn');
        const bulkMarkLizenzBtn = document.getElementById('bulkMarkLizenzBtn');
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

        // Statt Aktions-Buttons nur ausgegraut anzuzeigen, werden sie komplett ausgeblendet,
        // solange sie ohne Auswahl ohnehin wirkungslos wären, und blenden sich erst mit der
        // ersten Auswahl ein.
        const keineAuswahl = checkedBoxes.length === 0;
        [bulkMarkPaidBtn].forEach(btn => {
            if (!btn) return;
            btn.disabled = keineAuswahl;
            btn.style.display = keineAuswahl ? 'none' : '';
        });

        // Gewogen/Lizenz bleiben Nicht-Gastgeber-Vereinen komplett verborgen (analog zur Spalte,
        // siehe aktualisiereGewogenLizenzSichtbarkeit) — sonst gäbe es einen Sammel-Button, der
        // serverseitig ohnehin immer mit 403 fehlschlägt.
        [bulkMarkWeighedBtn, bulkMarkLizenzBtn].forEach(btn => {
            if (!btn) return;
            const verborgen = keineAuswahl || !istGastgeberVerein;
            btn.disabled = verborgen;
            btn.style.display = verborgen ? 'none' : '';
        });

        // bulkDeleteBtn bleibt zusätzlich verborgen, solange die Teilnehmerliste gesperrt ist
        // (siehe pruefeTeilnehmerlisteSperre) — beide Bedingungen werden hier gemeinsam
        // ausgewertet, damit updateBulkActionsBar die einzige Quelle für seine Sichtbarkeit ist.
        if (bulkDeleteBtn) {
            const bulkDeleteVerborgen = keineAuswahl;
            bulkDeleteBtn.disabled = bulkDeleteVerborgen;
            bulkDeleteBtn.style.display = bulkDeleteVerborgen ? 'none' : '';

            // Analog zum Delete-Icon je Zeile: Gastgeber-Verein löscht hart, alle anderen
            // ziehen ihre eigenen Anmeldungen nur zurück.
            const bulkDeleteBtnIcon = document.getElementById('bulkDeleteBtnIcon');
            const bulkDeleteBtnLabel = document.getElementById('bulkDeleteBtnLabel');
            if (istGastgeberVerein) {
                bulkDeleteBtn.title = 'Ausgewählte löschen';
                if (bulkDeleteBtnIcon) bulkDeleteBtnIcon.textContent = 'delete';
                if (bulkDeleteBtnLabel) bulkDeleteBtnLabel.textContent = 'Löschen';
            } else {
                bulkDeleteBtn.title = 'Ausgewählte zurückziehen';
                if (bulkDeleteBtnIcon) bulkDeleteBtnIcon.textContent = 'person_remove';
                if (bulkDeleteBtnLabel) bulkDeleteBtnLabel.textContent = 'Zurückziehen';
            }
        }

        if (selectAllCheckbox) {
            selectAllCheckbox.checked = checkboxes.length > 0 && checkedBoxes.length === checkboxes.length;
            selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
        }
    }

    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = checked;
            });
            updateBulkActionsBar();
        });
    }

    if (tableBody) {
        tableBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('row-checkbox')) {
                updateBulkActionsBar();
            }
        });
    }

    const bulkMarkPaidBtn = document.getElementById('bulkMarkPaidBtn');
    if (bulkMarkPaidBtn) {
        bulkMarkPaidBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich ${ids.length} Teilnehmer als "bezahlt" markieren?`,
                'Zahlungsstatus aktualisieren',
                'payments',
                { compact: true }
            );

            if (!confirmed) return;

            try {
                const updatePromises = ids.map(id => fetch(`/api/teilnehmer/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ startgeld_bezahlt: true })
                }));

                await Promise.all(updatePromises);

                window.zeigeNotification(`${ids.length} Teilnehmer erfolgreich aktualisiert.`, 'success');

                if (selectAllCheckbox) selectAllCheckbox.checked = false;
                await ladeTeilnehmer();
            } catch (err) {
                console.error(err);
                window.zeigeNotification('Fehler beim Aktualisieren: ' + err.message, 'error');
            }
        });
    }

    const bulkMarkWeighedBtn = document.getElementById('bulkMarkWeighedBtn');
    if (bulkMarkWeighedBtn) {
        bulkMarkWeighedBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich ${ids.length} Teilnehmer als "gewogen" markieren?`,
                'Gewogen-Status aktualisieren',
                'scale',
                { compact: true }
            );

            if (!confirmed) return;

            try {
                const updatePromises = ids.map(id => fetch(`/api/teilnehmer/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gewogen: true })
                }));

                await Promise.all(updatePromises);

                window.zeigeNotification(`${ids.length} Teilnehmer erfolgreich als gewogen markiert.`, 'success');

                if (selectAllCheckbox) selectAllCheckbox.checked = false;
                await ladeTeilnehmer();
            } catch (err) {
                console.error(err);
                window.zeigeNotification('Fehler beim Aktualisieren: ' + err.message, 'error');
            }
        });
    }

    const bulkMarkLizenzBtn = document.getElementById('bulkMarkLizenzBtn');
    if (bulkMarkLizenzBtn) {
        bulkMarkLizenzBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                `Möchten Sie wirklich für ${ids.length} Teilnehmer die Lizenz bestätigen?`,
                'Lizenz-Status aktualisieren',
                'badge',
                { compact: true }
            );

            if (!confirmed) return;

            const naechstesJahr = new Date().getFullYear() + 1;
            const lizenzGueltigBis = `${naechstesJahr}-12-31`;

            try {
                const updatePromises = ids.map(id => fetch(`/api/teilnehmer/${id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lizenz_ablauf: lizenzGueltigBis })
                }));

                await Promise.all(updatePromises);

                window.zeigeNotification(`Lizenz für ${ids.length} Teilnehmer erfolgreich bestätigt.`, 'success');

                if (selectAllCheckbox) selectAllCheckbox.checked = false;
                await ladeTeilnehmer();
            } catch (err) {
                console.error(err);
                window.zeigeNotification('Fehler beim Aktualisieren: ' + err.message, 'error');
            }
        });
    }

    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            if (checkedBoxes.length === 0) return;

            const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.getAttribute('data-id'), 10));

            const confirmed = await window.zeigeZentraleBestaetigung(
                istGastgeberVerein
                    ? `Möchten Sie wirklich ${ids.length} Teilnehmer unwiderruflich aus der Waage-Liste löschen?`
                    : `Möchten Sie wirklich ${ids.length} Anmeldungen zurückziehen?`,
                istGastgeberVerein ? 'Teilnehmer entfernen' : 'Anmeldungen zurückziehen',
                'person_remove'
            );

            if (!confirmed) return;

            const results = await Promise.allSettled(ids.map(async (id) => {
                const zielUrl = istGastgeberVerein ? `/api/teilnehmer/${id}` : `/api/teilnehmer/${id}/zurueckziehen`;
                const methode = istGastgeberVerein ? 'DELETE' : 'POST';
                const delResponse = await fetch(zielUrl, { method: methode });
                const result = await delResponse.json();
                if (!result.success) throw new Error(result.error || 'Unbekannter Fehler');
                return id;
            }));

            const erfolgreich = results.filter(r => r.status === 'fulfilled').length;
            const fehlgeschlagen = results.filter(r => r.status === 'rejected');
            const aktionsverb = istGastgeberVerein ? 'gelöscht' : 'zurückgezogen';

            if (fehlgeschlagen.length === 0) {
                window.zeigeNotification(`${erfolgreich} Teilnehmer erfolgreich ${aktionsverb}.`, 'success');
            } else if (erfolgreich === 0) {
                const fehlerverb = istGastgeberVerein ? 'Löschen' : 'Zurückziehen';
                window.zeigeNotification(`${fehlerverb} fehlgeschlagen: ${fehlgeschlagen[0].reason.message}`, 'error');
            } else {
                window.zeigeNotification(`${erfolgreich} Teilnehmer ${aktionsverb}, ${fehlgeschlagen.length} fehlgeschlagen (${fehlgeschlagen[0].reason.message}).`, 'error');
            }

            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            await ladeTeilnehmer();
        });
    }

    // --- NEUEN TEILNEHMER HINZUFÜGEN ---
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            window.oeffneWaageModal();
        });
    }

    // --- QR-PASS SCANNEN (öffnet dasselbe Popup direkt mit aktivem Scanner) ---
    const scanBtn = document.getElementById('scanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            window.oeffneWaageModal(null, { mitScan: true });
        });
    }

    // --- CSV/XLSX IMPORT ---
    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
        });
    }

    const importBtn = document.getElementById('importBtn');
    const importFileInput = document.getElementById('importFileInput');
    const importStatus = document.getElementById('importStatus');
    const importSkippedList = document.getElementById('importSkippedList');

    // Merkt sich, für welchen Bereich importiert werden soll (vom Dialog gesetzt oder automatisch
    // hergeleitet), bis der change-Handler des Datei-Inputs feuert.
    let importZiel = 'einzel';

    // Fragt bei einem Turnier mit sowohl Einzel- als auch Mannschafts-Altersklassen nach, wohin
    // importiert werden soll. Trägt das Turnier nur eine der beiden Arten aus, entfällt der Dialog
    // und das Ziel steht automatisch fest (siehe turnier.html: "Austragungs-Altersklassen").
    async function ermittleImportZiel() {
        if (turnierHatEinzelKlassen && turnierHatMannschaftKlassen) {
            const modal = document.getElementById('importZielModal');
            if (!modal) return 'einzel';

            return new Promise((resolve) => {
                modal.style.display = 'flex';
                const schliessen = (ziel) => {
                    modal.style.display = 'none';
                    resolve(ziel);
                };

                const btnEinzel = document.getElementById('importZielEinzelBtn');
                const btnMannschaft = document.getElementById('importZielMannschaftBtn');
                const btnAbbrechen = document.getElementById('importZielAbbrechenBtn');

                // Alte Listener (aus einem vorherigen Aufruf) per Klonen entfernen.
                const neuEinzel = btnEinzel.cloneNode(true);
                btnEinzel.replaceWith(neuEinzel);
                const neuMannschaft = btnMannschaft.cloneNode(true);
                btnMannschaft.replaceWith(neuMannschaft);
                const neuAbbrechen = btnAbbrechen.cloneNode(true);
                btnAbbrechen.replaceWith(neuAbbrechen);

                neuEinzel.addEventListener('click', () => schliessen('einzel'));
                neuMannschaft.addEventListener('click', () => schliessen('mannschaft'));
                neuAbbrechen.addEventListener('click', () => schliessen(null));
            });
        }

        if (turnierHatMannschaftKlassen && !turnierHatEinzelKlassen) return 'mannschaft';
        return 'einzel';
    }

    // --- IMPORT-VORLAGE HERUNTERLADEN ---
    // fetch() statt <a href>/window.location, da der globale fetch-Wrapper (menu.js) den
    // Authorization-Header anhängt, den eine native Navigation nicht mitschicken würde.
    async function ladeVorlageHerunter(format) {
        try {
            const response = await fetch(`/api/teilnehmer/import-vorlage?format=${format}`);
            if (!response.ok) throw new Error('Vorlage konnte nicht geladen werden.');

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `teilnehmer_vorlage.${format}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            if (window.zeigeNotification) window.zeigeNotification(err.message, 'error');
            else alert(err.message);
        }
    }

    const vorlageXlsxLink = document.getElementById('vorlageXlsxLink');
    const vorlageCsvLink = document.getElementById('vorlageCsvLink');
    if (vorlageXlsxLink) vorlageXlsxLink.addEventListener('click', (e) => { e.preventDefault(); ladeVorlageHerunter('xlsx'); });
    if (vorlageCsvLink) vorlageCsvLink.addEventListener('click', (e) => { e.preventDefault(); ladeVorlageHerunter('csv'); });

    // --- IMPORT-VORSCHAU (Spaltenzuordnung, Validierung, Zusammenfassung vor dem Speichern) ---
    const importVorschauModal = document.getElementById('importVorschauModal');
    const importVorschauMappingRow = document.getElementById('importVorschauMappingRow');
    const importVorschauHeaderRow = document.getElementById('importVorschauHeaderRow');
    const importVorschauBody = document.getElementById('importVorschauBody');
    const importVorschauSummary = document.getElementById('importVorschauSummary');
    const importVorschauStartenBtn = document.getElementById('importVorschauStartenBtn');
    const importVorschauAbbrechenBtn = document.getElementById('importVorschauAbbrechenBtn');

    // Bleibt über den gesamten Vorschau-Vorgang (inkl. Neuladen bei geänderter Zuordnung) hinweg
    // erhalten, damit die Datei nur einmal gelesen/hochgeladen werden muss.
    let importDateiName = null;
    let importContentBase64 = null;

    function sammleAktuelleZuordnung() {
        const zuordnung = {};
        importVorschauMappingRow.querySelectorAll('select').forEach(select => {
            zuordnung[select.dataset.spalte] = select.value;
        });
        return zuordnung;
    }

    function renderImportVorschau(data) {
        const headers = data.headers || [];
        const zuordnung = data.spaltenZuordnung || {};

        importVorschauMappingRow.innerHTML = headers.map((_, idx) => {
            const optionen = [`<option value="">Ignorieren</option>`]
                .concat(data.systemFelder.map(f => {
                    return `<option value="${f.feld}"${zuordnung[idx] === f.feld ? ' selected' : ''}>${escapeHtml(f.label)}${f.pflicht ? ' *' : ''}</option>`;
                }));
            return `<th style="padding: 6px; border-bottom: 2px solid var(--border); background: var(--bg-main);"><select data-spalte="${idx}" style="font-size: 11px; width: 100%;">${optionen.join('')}</select></th>`;
        }).join('');

        importVorschauHeaderRow.innerHTML = headers.map(h => `<th style="padding: 2px 6px; font-weight: 400;">${escapeHtml(String(h ?? ''))}</th>`).join('');

        importVorschauBody.innerHTML = (data.vorschauZeilen || []).map(zeile => {
            const zellen = headers.map((_, idx) => {
                const feld = zuordnung[idx];
                const istFehler = feld && zeile.fehlerFelder.includes(feld);
                const wert = zeile.raw && zeile.raw[idx] !== undefined ? zeile.raw[idx] : '';
                const style = istFehler
                    ? 'padding: 4px 6px; background: rgba(198, 40, 40, 0.15); color: #c62828; font-weight: 600;'
                    : 'padding: 4px 6px;';
                return `<td style="${style}">${escapeHtml(String(wert))}</td>`;
            }).join('');
            return `<tr>${zellen}</tr>`;
        }).join('');

        const { gesamt, gueltig, ungueltig } = data.summary;
        importVorschauSummary.textContent = `Es wurden ${gueltig} gültige und ${ungueltig} fehlerhafte Zeile(n) gefunden (von ${gesamt} insgesamt${gesamt > (data.vorschauZeilen || []).length ? ', hier nur die ersten ' + (data.vorschauZeilen || []).length + ' angezeigt' : ''}). Möchtest du den Import starten?`;

        // Bei jeder Änderung der Spaltenzuordnung eine neue Vorschau vom Server holen, damit
        // Validierung und Zusammenfassung dieselbe (serverseitige) Logik wie der echte Import nutzen.
        importVorschauMappingRow.querySelectorAll('select').forEach(select => {
            select.addEventListener('change', () => ladeImportVorschau(sammleAktuelleZuordnung()));
        });

        importVorschauModal.style.display = 'flex';
    }

    // Einfaches HTML-Escaping für die dynamisch befüllte Vorschau-Tabelle.
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str ?? '';
        return div.innerHTML;
    }

    async function ladeImportVorschau(spaltenZuordnungOverride) {
        try {
            const response = await fetch('/api/teilnehmer/import-vorschau', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    turnier_id: turnierId,
                    filename: importDateiName,
                    contentBase64: importContentBase64,
                    ziel: importZiel,
                    spaltenZuordnung: spaltenZuordnungOverride || undefined
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Vorschau fehlgeschlagen.');

            renderImportVorschau(data);
        } catch (err) {
            importVorschauModal.style.display = 'none';
            if (window.zeigeNotification) window.zeigeNotification('Vorschau-Fehler: ' + err.message, 'error');
            else alert('Vorschau-Fehler: ' + err.message);
        }
    }

    if (importVorschauAbbrechenBtn) {
        importVorschauAbbrechenBtn.addEventListener('click', () => {
            importVorschauModal.style.display = 'none';
            importDateiName = null;
            importContentBase64 = null;
        });
    }

    if (importVorschauStartenBtn) {
        importVorschauStartenBtn.addEventListener('click', async () => {
            const spaltenZuordnung = sammleAktuelleZuordnung();
            importVorschauModal.style.display = 'none';

            importStatus.textContent = `Importiere "${importDateiName}" ...`;
            importSkippedList.style.display = 'none';
            importSkippedList.innerHTML = '';

            try {
                const response = await fetch('/api/teilnehmer/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        turnier_id: turnierId,
                        filename: importDateiName,
                        contentBase64: importContentBase64,
                        ziel: importZiel,
                        spaltenZuordnung
                    })
                });
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Import fehlgeschlagen.');
                }

                let meldung = `${data.imported} von ${data.total} Teilnehmern importiert.`;
                if (data.skipped && data.skipped.length > 0) {
                    meldung += ` ${data.skipped.length} übersprungen.`;
                }
                if (data.mannschaftenBetroffen > 0) {
                    meldung += ` ${data.mannschaftenBetroffen} Mannschaft(en) angelegt/aktualisiert.`;
                }
                importStatus.textContent = meldung;

                if (window.zeigeNotification) {
                    window.zeigeNotification(meldung, data.skipped && data.skipped.length > 0 ? 'error' : 'success');
                }

                if (data.skipped && data.skipped.length > 0) {
                    importSkippedList.style.display = 'block';
                    importSkippedList.innerHTML = `<strong>Übersprungene Zeilen:</strong><ul style="margin:4px 0 0 20px;">${data.skipped.map(s => `<li>Zeile ${s.row}: ${s.reason}</li>`).join('')}</ul>`;
                }

                // Neu angelegte/erweiterte Mannschaften (siehe mannschaftenBetroffen) sind nach dem
                // Import noch nicht in teamInfoByTeilnehmerId bekannt — ohne dieses Neuladen bliebe
                // die Team-Spalte für frisch importierte Mitglieder bis zum nächsten Seiten-Reload
                // leer, obwohl der Import sie bereits einer Mannschaft zugeordnet hat.
                if (data.mannschaftenBetroffen > 0) {
                    await ladeMannschaftsZuordnung();
                }
                await ladeTeilnehmer();
            } catch (err) {
                importStatus.textContent = '';
                if (window.zeigeNotification) window.zeigeNotification('Import-Fehler: ' + err.message, 'error');
                else alert('Import-Fehler: ' + err.message);
            } finally {
                importDateiName = null;
                importContentBase64 = null;
            }
        });
    }

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', async () => {
            const ziel = await ermittleImportZiel();
            if (!ziel) return; // Dialog abgebrochen

            importZiel = ziel;
            importFileInput.click();
        });

        importFileInput.addEventListener('change', async () => {
            const file = importFileInput.files[0];
            importFileInput.value = '';
            if (!file) return;

            try {
                importDateiName = file.name;
                importContentBase64 = await readFileAsBase64(file);
                await ladeImportVorschau();
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification('Fehler: ' + err.message, 'error');
                else alert('Fehler: ' + err.message);
            }
        });
    }

    // --- AMPEL-FARBE FÜR GEWOGEN/BEZAHLT: 100% grün, ab 80% gelb, darunter rot ---
    function farbeFuerProzent(prozent) {
        if (prozent >= 100) return 'gruen';
        if (prozent >= 80) return 'gelb';
        return 'rot';
    }

    // --- KENNZAHLEN-KACHELN (Meldestand-Überblick unterhalb der Tabelle) ---
    // Nutzt bewusst athletenDaten (ungefiltert) statt gefilterteAthleten(), da die Kennzahlen den
    // gesamten Meldestand des Turniers zeigen sollen, nicht nur die aktuelle Sucheingabe.
    // "Gewogen"/"Lizenz" werden identisch zu renderTabelle() abgeleitet (siehe dort).
    function renderStatsKacheln() {
        const aktive = athletenDaten.filter(a => a.status !== 'zurueckgezogen');
        const gesamt = aktive.length;

        // Gewogen/Lizenz/Bezahlt beziehen sich auf genau die Teilnehmer, die athletenDaten bereits
        // enthält — und das ist serverseitig schon korrekt vorgefiltert (getTeilnehmerByTurnier):
        // der austragende Verein sieht/zählt alle Teilnehmer, jeder andere Verein sieht/zählt nur
        // die eigenen. Hier also bewusst KEIN zusätzlicher Vereinsfilter mehr.
        const basis = aktive;
        const basisAnzahl = basis.length;

        const gewogenAnzahl = basis.filter(a => !!a.gewogen).length;
        const gewogenProzent = basisAnzahl > 0 ? Math.round((gewogenAnzahl / basisAnzahl) * 100) : 0;

        const lizenzAnzahl = basis.filter(a => {
            const roh = a.lizenz_ablauf ? String(a.lizenz_ablauf).split('T')[0] : null;
            return !!roh && roh !== '1970-01-01';
        }).length;
        const lizenzProzent = basisAnzahl > 0 ? Math.round((lizenzAnzahl / basisAnzahl) * 100) : 0;

        // Bewusst der rohe Wert (nicht die turnierKostenlos-Maskierung aus berechneStatus): die
        // Kachel soll den tatsächlichen Bezahlt-Status abbilden, den auch das Icon je Teilnehmer
        // zeigt/umschaltet — sonst stünde hier "100%", obwohl einzelne Icons "unbezahlt" zeigen.
        const bezahltAnzahl = basis.filter(a => !!a.startgeld_bezahlt).length;
        const unbezahltAnzahl = basisAnzahl - bezahltAnzahl;
        const bezahltProzent = basisAnzahl > 0 ? Math.round((bezahltAnzahl / basisAnzahl) * 100) : 0;

        const vereine = new Set(aktive.map(a => (a.verein || '').trim()).filter(Boolean));

        const setText = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setText('statGesamtTeilnehmer', gesamt);

        const gewogenFarbe = farbeFuerProzent(gewogenProzent);
        const gewogenProzentEl = document.getElementById('statGewogenProzent');
        if (gewogenProzentEl) {
            gewogenProzentEl.textContent = `${gewogenProzent}%`;
            gewogenProzentEl.className = `teilnehmer-stat-value teilnehmer-stat-value-${gewogenFarbe}`;
        }
        const gewogenBar = document.getElementById('statGewogenBar');
        if (gewogenBar) {
            gewogenBar.style.width = `${gewogenProzent}%`;
            gewogenBar.className = `teilnehmer-stat-bar-fill teilnehmer-stat-bar-fill-${gewogenFarbe}`;
        }
        setText('statGewogenAnteil', `${gewogenAnzahl} / ${basisAnzahl}`);

        const lizenzFarbe = farbeFuerProzent(lizenzProzent);
        const lizenzProzentEl = document.getElementById('statLizenzProzent');
        if (lizenzProzentEl) {
            lizenzProzentEl.textContent = `${lizenzProzent}%`;
            lizenzProzentEl.className = `teilnehmer-stat-value teilnehmer-stat-value-${lizenzFarbe}`;
        }
        const lizenzBar = document.getElementById('statLizenzBar');
        if (lizenzBar) {
            lizenzBar.style.width = `${lizenzProzent}%`;
            lizenzBar.className = `teilnehmer-stat-bar-fill teilnehmer-stat-bar-fill-${lizenzFarbe}`;
        }
        setText('statLizenzAnteil', `${lizenzAnzahl} / ${basisAnzahl}`);

        const bezahltFarbe = farbeFuerProzent(bezahltProzent);
        const bezahltProzentEl = document.getElementById('statBezahltProzent');
        if (bezahltProzentEl) {
            bezahltProzentEl.textContent = `${bezahltProzent}%`;
            bezahltProzentEl.className = `teilnehmer-stat-value teilnehmer-stat-value-${bezahltFarbe}`;
        }
        const bezahltBar = document.getElementById('statBezahltBar');
        if (bezahltBar) {
            bezahltBar.style.width = `${bezahltProzent}%`;
            bezahltBar.className = `teilnehmer-stat-bar-fill teilnehmer-stat-bar-fill-${bezahltFarbe}`;
        }
        const bezahltHinweis = document.getElementById('statBezahltHinweis');
        if (bezahltHinweis) {
            if (unbezahltAnzahl > 0) {
                bezahltHinweis.textContent = `${bezahltAnzahl} / ${basisAnzahl} · ${unbezahltAnzahl} ausstehend`;
                bezahltHinweis.className = 'teilnehmer-stat-sub teilnehmer-stat-sub-warnung';
            } else {
                bezahltHinweis.textContent = `${bezahltAnzahl} / ${basisAnzahl}`;
                bezahltHinweis.className = 'teilnehmer-stat-sub';
            }
        }

        setText('statVereine', vereine.size);
    }

    // --- DATEN LADEN ---
    async function ladeTeilnehmer() {
        try {
            const response = await fetch(`/api/teilnehmer?turnierId=${turnierId}`);
            if (!response.ok) throw new Error('Teilnehmer konnten nicht geladen werden.');

            athletenDaten = await response.json();
            sortiereUndRendere();
            renderStatsKacheln();

            // ladeTeilnehmer() läuft nach jeder Statusänderung (Lizenz/Bezahlt-Toggle,
            // Zurückziehen/Löschen, Sammel-Aktionen), daher hier zentral den Pools-Menüpunkt
            // live neu bewerten statt an jeder einzelnen Aktion.
            if (window.hajimeAktualisiereMenueSperren) {
                window.hajimeAktualisiereMenueSperren(['pools']);
            }

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="12" class="no-data" style="color: #b83232;">Fehler beim Laden: ${error.message}</td></tr>`;
        }
    }

    // Global exponiert, damit waage-modal.js (Popup zum Anlegen/Bearbeiten eines Teilnehmers)
    // die Liste nach dem Speichern ohne vollständigen Reload aktualisieren kann.
    window.ladeTeilnehmerListe = ladeTeilnehmer;

    // Client-Geräte (Desktop-Client, Android-App) lesen aus der lokalen Dokument-DB, die erst nach und
    // nach vom Hallen-Server repliziert wird (nach jedem Seitenstart bzw. Turnierwechsel, später auch
    // laufend). Die Liste würde sonst nur den Stand beim Öffnen der Seite zeigen und Teilnehmer fehlen.
    // Daher im Hintergrund nachladen und nur bei einer Änderung neu zeichnen — nicht, solange das
    // Waage-Popup offen ist oder Zeilen markiert sind (die Auswahl ginge sonst verloren).
    async function aktualisiereListeImHintergrund() {
        try {
            if (document.hidden) return;
            const modal = document.getElementById('waageModal');
            if (modal && modal.style.display !== 'none' && modal.style.display !== '') return;
            if (document.querySelector('.row-checkbox:checked')) return;
            const response = await fetch(`/api/teilnehmer?turnierId=${turnierId}`, { cache: 'no-store' });
            if (!response.ok) return;
            const neu = await response.json();
            if (JSON.stringify(neu) === JSON.stringify(athletenDaten)) return;
            athletenDaten = neu;
            sortiereUndRendere();
            renderStatsKacheln();
        } catch (err) {
            // Hintergrundabgleich: Fehler still ignorieren, der nächste Durchlauf versucht es erneut.
        }
    }
    // Auch der Hallen-Server zeigt Änderungen, die Client-Geräte (Notebook, Tablet, Handy) per Sync liefern: die Brücke
    // schreibt sie in die Datenbank, die Liste holt sie hier nach. Ohne Sync-Rolle (Cloud, Einzelbetrieb ohne
    // Client-Geräte) bleibt der Abgleich aus — dort ändert nur diese Seite die Daten.
    (async () => {
        let rolle = window.Datenzugriff && window.Datenzugriff.rolle ? window.Datenzugriff.rolle() : null;
        if (!rolle) {
            try {
                const status = await fetch('/api/sync/status', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
                rolle = status && status.rolle;
            } catch (err) { /* ohne Sync-Status kein Hintergrundabgleich */ }
        }
        if (rolle === 'client' || rolle === 'server') setInterval(aktualisiereListeImHintergrund, 3000);
    })();

    // Global exponiert, damit waage-modal.js nach dem manuellen Zuordnen/Ändern einer
    // Mannschafts-Mitgliedschaft (Team-Name-Feld) die Team-Spalte ohne vollständigen Reload
    // aktualisieren kann — identisch zum bestehenden Neuladen nach einem Mannschafts-Import
    // (siehe data.mannschaftenBetroffen weiter oben).
    window.ladeMannschaftsZuordnung = ladeMannschaftsZuordnung;

    // --- SORTIER-KLICK-HANDLER ---
    document.querySelectorAll('.judo-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');

            if (key === aktiveSortierung) {
                sortierRichtung = sortierRichtung === 'asc' ? 'desc' : 'asc';
            } else {
                aktiveSortierung = key;
                sortierRichtung = 'asc';
            }

            aktualisiereSortierIcons();
            sortiereUndRendere();
        });
    });

    // --- SUCH-KLICK-HANDLER ---
    const teilnehmerSearchInput = document.getElementById('teilnehmerSearchInput');
    if (teilnehmerSearchInput) {
        teilnehmerSearchInput.addEventListener('input', () => {
            sortiereUndRendere();
        });
    }

    (async () => {
        await ladeTurnierAltersklassen();
        aktualisiereTeamSpalteSichtbarkeit();
        await Promise.all([ladeMannschaftsZuordnung(), ladeGraduierungen(), pruefeTeilnehmerlisteSperre(), ermittleGastgeberStatus()]);
        aktualisiereGewogenLizenzSichtbarkeit();
        await ladeTeilnehmer();
    })();

    // --- STARTGELD-ZAHLUNG (nur andere Vereine, nur online) ---
    // "Gesamtes Turnier exportieren" gibt es hier nicht mehr — der Export ist jetzt in
    // turnier.html (Bearbeiten-Modus) zu finden.
    async function pruefeUndZeigeStartgeldButton() {
        const startgeldBezahlenBtn = document.getElementById('startgeldBezahlenBtn');
        if (!startgeldBezahlenBtn) return;

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

            // Der "Startgeld bezahlen"-Button ist nur im Online-Betrieb sinnvoll (im Offline-Modus
            // gibt es keine Fremdvereins-Anmeldungen über das Netz) und nur für Nutzer ANDERER
            // Vereine als des Ausrichters — der Ausrichter-Verein markiert Zahlungen direkt in der
            // Liste, statt sich selbst eine Überweisung zu schicken.
            const istFremderVerein = !!(user.verein_id && turnier.verein_id !== user.verein_id);
            const startgeldWert = parseFloat(turnier.startgeld) || 0;
            const darfStartgeldZahlen = !istOffline && istFremderVerein && startgeldWert > 0;
            startgeldBezahlenBtn.style.display = darfStartgeldZahlen ? 'inline-flex' : 'none';
        } catch (err) {
            console.error('Fehler bei der Berechtigungsprüfung:', err);
        }
    }

    pruefeUndZeigeStartgeldButton();

    // --- STARTGELD BEZAHLEN: GiroCode/EPC-QR mit vorausgefülltem Betrag für den eigenen Verein ---
    // Format nach EPC069-12 ("Girocode"), von SEPA-fähigen Banking-Apps direkt scanbar.
    function baueGiroCodePayload({ name, iban, betrag, verwendungszweck }) {
        const zeilen = [
            'BCD',
            '002',
            '1',
            'SCT',
            '', // BIC — seit 2016 für IBANs aus dem EWR nicht mehr erforderlich
            (name || '').slice(0, 70),
            (iban || '').replace(/\s+/g, ''),
            `EUR${betrag.toFixed(2)}`,
            '', // Purpose
            '', // Strukturierte Zahlungsreferenz
            (verwendungszweck || '').slice(0, 140)
        ];
        return zeilen.join('\n');
    }

    const startgeldBezahlenBtn = document.getElementById('startgeldBezahlenBtn');
    const startgeldModal = document.getElementById('startgeldModal');
    if (startgeldBezahlenBtn && startgeldModal) {
        startgeldBezahlenBtn.addEventListener('click', async () => {
            try {
                const meResp = await fetch('/api/auth/me');
                if (!meResp.ok) throw new Error('Benutzerdaten konnten nicht geladen werden.');
                const user = (await meResp.json()).user;
                const eigenerVerein = user && user.verein_name;

                if (!eigenerVerein) {
                    if (window.zeigeNotification) window.zeigeNotification('Ihrem Konto ist kein Verein zugeordnet.', 'error');
                    return;
                }

                const unbezahlt = athletenDaten.filter(a => a.verein === eigenerVerein && !a.startgeld_bezahlt);
                if (unbezahlt.length === 0) {
                    if (window.zeigeNotification) window.zeigeNotification('Alle Teilnehmer Ihres Vereins sind bereits als bezahlt markiert.', 'success');
                    return;
                }

                const betrag = turnierStartgeldWert * unbezahlt.length;
                const verwendungszweckErsetzt = (turnierVerwendungszweck || '')
                    .replace(/<Turniername>/g, turnierBezeichnung)
                    .replace(/<Verein>/g, eigenerVerein);

                document.getElementById('startgeldIbanFeld').value = turnierIban;
                document.getElementById('startgeldKontoinhaberFeld').value = turnierKontoinhaber;
                document.getElementById('startgeldVerwendungszweckFeld').value = verwendungszweckErsetzt;
                document.getElementById('startgeldBetragAnzeige').textContent =
                    `Offener Betrag: ${betrag.toFixed(2).replace('.', ',')} € (${unbezahlt.length} Teilnehmer)`;

                const payload = baueGiroCodePayload({
                    name: turnierKontoinhaber,
                    iban: turnierIban,
                    betrag,
                    verwendungszweck: verwendungszweckErsetzt
                });

                const qrContainer = document.getElementById('startgeldQrContainer');
                qrContainer.innerHTML = '';
                const qr = qrcode(0, 'M');
                qr.addData(payload);
                qr.make();
                qrContainer.innerHTML = qr.createSvgTag(4, 4);

                startgeldModal.style.display = 'flex';
            } catch (err) {
                if (window.zeigeNotification) window.zeigeNotification('Fehler: ' + err.message, 'error');
                else alert(err.message);
            }
        });

        const schliesseStartgeldModal = () => { startgeldModal.style.display = 'none'; };
        const startgeldModalClose = document.getElementById('startgeldModalClose');
        if (startgeldModalClose) startgeldModalClose.addEventListener('click', schliesseStartgeldModal);
        startgeldModal.addEventListener('click', (e) => {
            if (e.target === startgeldModal) schliesseStartgeldModal();
        });
    }
});
