// Oberfläche der Android-App (nur geladen, wenn mobil/web/js/mobil/boot.js html.modus-app setzt, siehe css/handy.css):
// eine gemeinsame Top-Bar für Handy und Tablet. Das Handy zeigt nur die Waage (Teilnehmerliste), das Tablet die drei
// Bereiche Waage, Kampf und Scoreboard; bei Kampf und Scoreboard sitzt die Mattenauswahl in der Top-Bar. Rechts stehen
// der Server-Status als Icon und das Menü (Dunkelmodus, Moduswechsel, Koppeln). Die Startseite (client.html) gibt es
// nicht mehr: sie führt direkt in die Teilnehmerliste des Turniers.
(function () {
    const MODUS_SCHLUESSEL = 'hajime_mobil_modus';
    const istHandy = document.documentElement.classList.contains('modus-handy');
    const seite = location.pathname.split('/').pop() || 'index.html';
    const params = new URLSearchParams(location.search);

    const lies = (schluessel) => { try { return localStorage.getItem(schluessel); } catch (e) { return null; } };
    const schreibe = (schluessel, wert) => { try { localStorage.setItem(schluessel, wert); } catch (e) { /* ohne Speicher */ } };
    const turnierId = () => params.get('turnierId') || params.get('id') || lies('aktiveTurnierId');
    const mitTurnier = (pfad) => (turnierId() ? `${pfad}?turnierId=${turnierId()}` : pfad);

    const STATUS_ICONS = {
        verbunden: { icon: 'cloud_done', farbe: '#7fd18a' },
        offline: { icon: 'cloud_off', farbe: '#ffd54f' },
        fehler: { icon: 'error', farbe: '#ff8a80' },
        wechsel: { icon: 'sync', farbe: '#90caf9' },
        pruefung: { icon: 'sync', farbe: '#b0bec5' }
    };

    const TABS = [
        { seite: 'teilnehmer.html', text: 'Waage', icon: 'scale' },
        { seite: 'kampf.html', text: 'Kampf', icon: 'sports_kabaddi' },
        { seite: 'steuerung.html', text: 'Scoreboard', icon: 'scoreboard' }
    ];

    function baueTopBar() {
        if (document.getElementById('handyTopBar')) return;
        const leiste = document.createElement('div');
        leiste.id = 'handyTopBar';

        const zeichen = document.createElement('div');
        zeichen.className = 'handy-zeichen';
        zeichen.innerHTML = '<img src="/hajime_zeichen.png" alt="Hajime Pro">';
        leiste.appendChild(zeichen);

        if (istHandy) {
            const titel = document.createElement('div');
            titel.className = 'handy-titel';
            titel.textContent = 'Waage';
            leiste.appendChild(titel);
        } else {
            const tabs = document.createElement('nav');
            tabs.className = 'handy-tabs';
            for (const tab of TABS) {
                const a = document.createElement('a');
                a.href = mitTurnier(`/${tab.seite}`);
                a.className = 'handy-tab' + (tab.seite === seite ? ' aktiv' : '');
                a.innerHTML = `<span class="material-icons">${tab.icon}</span><span class="handy-tab-text">${tab.text}</span>`;
                tabs.appendChild(a);
            }
            leiste.appendChild(tabs);
        }

        // Mattenauswahl (nur Kampf und Scoreboard): die Auswahl der Seite selbst wird hierher verschoben, damit ihre
        // Logik (Wechsel mit Rückfrage, Laden der Kämpfe) unverändert bleibt.
        const mattenSlot = document.createElement('div');
        mattenSlot.id = 'handyMattenSlot';
        leiste.appendChild(mattenSlot);

        const statusBtn = document.createElement('button');
        statusBtn.type = 'button';
        statusBtn.id = 'handyStatusBtn';
        statusBtn.className = 'handy-icon-btn';
        statusBtn.setAttribute('aria-label', 'Server-Status');
        // Der Pfeil nach oben (wie bei Git: noch nicht gepusht) erscheint, wenn das Gerät offline ist und
        // noch Änderungen zum Server übertragen werden müssen.
        statusBtn.innerHTML = '<span class="material-icons" id="handyStatusIcon">sync</span>' +
            '<span class="material-icons handy-sync-pfeil" id="handyStatusPfeil" hidden>arrow_upward</span>';
        leiste.appendChild(statusBtn);

        const mehrBtn = document.createElement('button');
        mehrBtn.type = 'button';
        mehrBtn.id = 'handyMehrBtn';
        mehrBtn.className = 'handy-icon-btn';
        mehrBtn.setAttribute('aria-label', 'Menü');
        mehrBtn.innerHTML = '<span class="material-icons">more_vert</span>';
        leiste.appendChild(mehrBtn);
        document.body.appendChild(leiste);

        const statusPop = document.createElement('div');
        statusPop.id = 'handyStatusPop';
        statusPop.className = 'handy-pop';
        statusPop.textContent = 'Server-Status wird geprüft …';
        document.body.appendChild(statusPop);

        const menue = document.createElement('div');
        menue.id = 'handyMehrMenue';
        menue.className = 'handy-pop';
        menue.innerHTML =
            '<button type="button" id="handyDunkelBtn"><span class="material-icons" id="handyDunkelIcon">dark_mode</span><span id="handyDunkelText">Dunkelmodus</span></button>' +
            '<button type="button" id="handyModusBtn"></button>' +
            '<a href="/verbinden.html?neu=1"><span class="material-icons">link</span>Mit anderem Hallen-Server koppeln</a>';
        document.body.appendChild(menue);

        const schliesse = () => { menue.style.display = 'none'; statusPop.style.display = 'none'; };
        const umschalten = (el, anderes) => (e) => {
            e.stopPropagation();
            anderes.style.display = 'none';
            el.style.display = el.style.display === 'block' ? 'none' : 'block';
        };
        mehrBtn.addEventListener('click', umschalten(menue, statusPop));
        statusBtn.addEventListener('click', umschalten(statusPop, menue));
        menue.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', schliesse);

        // Moduswechsel: Handy <-> Tablet.
        const modusBtn = document.getElementById('handyModusBtn');
        modusBtn.innerHTML = istHandy
            ? '<span class="material-icons">tablet_android</span>Zum Tablet-Modus wechseln'
            : '<span class="material-icons">smartphone</span>Zum Handy-Modus wechseln';
        modusBtn.addEventListener('click', () => {
            schreibe(MODUS_SCHLUESSEL, istHandy ? 'tablet' : 'handy');
            location.href = mitTurnier('/teilnehmer.html');
        });

        // Dunkelmodus: derselbe Schlüssel wie das Seitenmenü (menu.js), damit die Wahl überall gilt.
        const zeigeTheme = () => {
            const dunkel = document.documentElement.getAttribute('data-theme') === 'dark';
            document.getElementById('handyDunkelIcon').textContent = dunkel ? 'light_mode' : 'dark_mode';
            document.getElementById('handyDunkelText').textContent = dunkel ? 'Hellmodus' : 'Dunkelmodus';
        };
        document.getElementById('handyDunkelBtn').addEventListener('click', () => {
            const neu = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', neu);
            schreibe('hajime-theme', neu);
            zeigeTheme();
        });
        zeigeTheme();

        // Server-Status: die schwebende Statusleiste (syncStatus.js) ist ausgeblendet; ihr Zustand erscheint als Icon.
        const spiegleStatus = () => {
            const quelle = document.getElementById('syncStatusLeiste');
            if (!quelle) return;
            const art = STATUS_ICONS[quelle.dataset.zustand] || STATUS_ICONS.pruefung;
            const icon = document.getElementById('handyStatusIcon');
            icon.textContent = art.icon;
            icon.style.color = art.farbe;
            const pfeil = document.getElementById('handyStatusPfeil');
            if (pfeil) pfeil.hidden = !(quelle.dataset.zustand === 'offline' && Number(quelle.dataset.ausstehend) > 0);
            statusPop.textContent = quelle.textContent;
            statusBtn.title = quelle.textContent;
        };
        spiegleStatus();
        setInterval(spiegleStatus, 1000);
    }

    // Auswahl der Matte von der Seite in die Top-Bar verschieben (Kampf: #mattenSelect, Scoreboard: #matSelect).
    function verschiebeMattenAuswahl() {
        const id = seite === 'kampf.html' ? 'mattenSelect' : seite === 'steuerung.html' ? 'matSelect' : null;
        const auswahl = id && document.getElementById(id);
        const slot = document.getElementById('handyMattenSlot');
        if (auswahl && slot) {
            slot.appendChild(auswahl);
            slot.style.display = 'flex';
        }
    }

    // Vorlagen-Download der Importfunktion gibt es in der App nicht (der Block hat keine eigene Kennung).
    function blendeImportHinweisAus() {
        const link = document.getElementById('vorlageXlsxLink');
        if (link && link.parentElement) link.parentElement.style.display = 'none';
    }

    function initialisiere() {
        baueTopBar();
        verschiebeMattenAuswahl();
        blendeImportHinweisAus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialisiere);
    else initialisiere();

    // Startseite (client.html) überspringen: direkt zur Teilnehmerliste des Turniers. Ist noch kein Turnier
    // repliziert (erster Start), wird alle paar Sekunden erneut gesucht.
    if (seite === 'client.html') {
        const suche = () => {
            fetch('/api/turniere').then(r => (r.ok ? r.json() : [])).then((turniere) => {
                if (turniere && turniere[0]) {
                    schreibe('aktiveTurnierId', turniere[0].id);
                    location.replace(`/teilnehmer.html?turnierId=${turniere[0].id}`);
                } else {
                    setTimeout(suche, 3000);
                }
            }).catch(() => setTimeout(suche, 3000));
        };
        suche();
    }
})();
