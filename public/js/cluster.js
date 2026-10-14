// Cluster-Seite (nur Hallen-Server mit CLUSTER_KNOTEN, Spec Abschnitt 9): Status beider Server,
// Client-Geräte aus den Heartbeat-Dokumenten, Verlauf der Rollenwechsel und die geplante Übergabe.
(function () {
    const AKTUALISIERUNG_MS = 2000;

    const EREIGNISSE = {
        start: 'Start',
        master_geworden: 'Master geworden',
        master_fortgesetzt: 'Master (fortgesetzt)',
        vip_abgegeben: 'VIP abgegeben',
        rueckstufung_gestartet: 'Rückstufung gestartet',
        rueckgestuft: 'Zurückgestuft (Standby neu aufgebaut)',
        rueckstufung_fehlgeschlagen: 'Rückstufung fehlgeschlagen',
        epoche_uebernommen: 'Epoche übernommen',
        uebergabe_gestartet: 'Übergabe gestartet',
        uebergabe_abgebrochen: 'Übergabe abgebrochen',
        update_gestartet: 'Update gestartet',
        partner_update_angestossen: 'Update des Partners angestoßen'
    };
    const GRUENDE = { automatisch: 'automatisch', uebergabe: 'geplante Übergabe', erststart: 'Erststart' };

    function el(tag, text, klasse) {
        const e = document.createElement(tag);
        if (text != null) e.textContent = text;
        if (klasse) e.className = klasse;
        return e;
    }

    function zeit(iso) {
        return iso ? new Date(iso).toLocaleTimeString('de-DE') : '–';
    }

    const GIB = 1024 ** 3;
    const gib = (n) => `${(n / GIB).toFixed(n >= 100 * GIB ? 0 : 1).replace('.', ',')} GiB`;
    const KNOTEN_NAMEN = ['server1', 'server2'];

    function dauer(sekunden) {
        const t = Math.floor(sekunden / 86400);
        const h = Math.floor((sekunden % 86400) / 3600);
        const m = Math.floor((sekunden % 3600) / 60);
        return t ? `${t} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
    }

    // Füllstand: ab 75 % gelb, ab 90 % rot; Platten zusätzlich gelb, wenn weniger als 5 GiB frei sind.
    function stufe(anteil, minFreiVerletzt) {
        if (anteil >= 0.90) return 'bad';
        if (anteil >= 0.75 || minFreiVerletzt) return 'warn';
        return 'ok';
    }

    // Zellinhalt als Text (optional mit Klasse) oder Balken; "–" für fehlende Werte.
    const text = (t, klasse) => ({ art: 'text', t, klasse });
    const fehlt = () => text('–');
    const balken = (belegt, gesamt, optionen = {}) => {
        if (!gesamt) return fehlt();
        const anteil = belegt / gesamt;
        return {
            art: 'balken', anteil,
            links: `${gib(belegt)} von ${gib(gesamt)}`, rechts: `${Math.round(anteil * 100)} %`,
            stufe: stufe(anteil, optionen.minFrei && gesamt - belegt < optionen.minFrei)
        };
    };

    // Die Zeilen der Vergleichstabelle: je Kennwert eine Funktion, die aus dem Status eines Servers die Zelle liefert.
    // Fehlt der Server (nicht erreichbar) oder der Wert, zeigt die Zelle "–", die Zeilen bleiben auf gleicher Höhe.
    function tabellenZeilen(knoten) {
        const sys = (n) => (knoten[n] && knoten[n].system) || null;
        const zeilen = [];
        const gruppe = (name) => zeilen.push({ gruppe: name });
        const zeile = (name, fn, feld) => zeilen.push({ name, fn, feld });
        const ausStatus = (fn) => (s, n) => (s ? fn(s, n) : fehlt());

        gruppe('Zustand');
        zeile('Erreichbar', (s) => (s ? text('ja', 'zustand-gut') : text('nein', 'zustand-schlecht')));
        zeile('Rolle', ausStatus(s => text(s.rolle === 'master' ? 'Master' : 'Secondary', s.rolle === 'master' ? 'rolle-master' : 'rolle-secondary')), 'rolle');
        zeile('Gesund', ausStatus(s => (s.gesund ? text('ja', 'zustand-gut') : text(`nein – ${(s.gruende || []).join(', ')}`, 'zustand-schlecht'))));
        zeile('Epoche', ausStatus(s => text(String(s.epoche ?? '–'))));
        zeile('Version', ausStatus(s => text(s.version || 'unbekannt')), 'version');

        gruppe('Datenbank');
        zeile('PostgreSQL', ausStatus(s => {
            const r = (s.pg || {}).rolle;
            return r === 'primary' ? text('Primary') : r === 'standby' ? text('Standby') : text('nicht erreichbar', 'zustand-schlecht');
        }));
        zeile('Replikation', ausStatus(s => {
            const p = s.pg || {};
            if (s.rolle === 'master') return p.absicherung === 'synchron' ? text('synchron', 'zustand-gut') : text('asynchron – ohne Absicherung', 'zustand-warn');
            if (p.rolle === 'standby') return p.empfaengt ? text('empfängt vom Master', 'zustand-gut') : text('empfängt nicht', 'zustand-warn');
            return fehlt();
        }), 'absicherung');
        zeile('Dokumente', ausStatus(s => {
            const d = s.dokumente || {};
            return d.doc_count != null ? text(`${d.doc_count} (Seq ${d.update_seq})`) : text('kein Turnier');
        }));
        zeile('Dokument-Replikation', ausStatus(s => {
            const p = (s.dokumente || {}).partner_pull || {};
            if (!p.laeuft) return fehlt();
            return p.fehler ? text(`Fehler: ${p.fehler}`, 'zustand-warn') : text(p.aktiv ? 'überträgt …' : 'aktuell');
        }));
        zeile('Datenbankgröße', (s, n) => {
            const g = sys(n) && sys(n).db_groesse;
            if (g == null) return fehlt();
            return text(g < GIB ? `${(g / 1024 ** 2).toFixed(1).replace('.', ',')} MiB` : gib(g));
        });
        if (KNOTEN_NAMEN.some(n => knoten[n] && (knoten[n].rueckstufung_laeuft || knoten[n].letzter_rueckstufungsfehler))) {
            zeile('Rückstufung', ausStatus(s => (s.letzter_rueckstufungsfehler ? text(s.letzter_rueckstufungsfehler, 'zustand-schlecht') : s.rueckstufung_laeuft ? text('läuft …', 'zustand-warn') : fehlt())));
        }

        gruppe('Ressourcen');
        zeile('Arbeitsspeicher', (s, n) => (sys(n) ? balken(sys(n).ram.gesamt - sys(n).ram.verfuegbar, sys(n).ram.gesamt) : fehlt()), 'ram');
        if (KNOTEN_NAMEN.some(n => sys(n) && sys(n).swap && sys(n).swap.gesamt > 0)) {
            zeile('Auslagerung', (s, n) => (sys(n) && sys(n).swap && sys(n).swap.gesamt > 0 ? balken(sys(n).swap.gesamt - sys(n).swap.frei, sys(n).swap.gesamt) : fehlt()), 'swap');
        }
        // Speicherplatz: je Dateisystem eine Zeile (benannt nach dem Einhängepunkt), über beide Server vereinigt.
        const platten = [];
        for (const n of KNOTEN_NAMEN) {
            for (const p of (sys(n) && sys(n).platten) || []) {
                const schluessel = p.einhaengepunkt || p.pfad;
                if (!platten.includes(schluessel)) platten.push(schluessel);
            }
        }
        for (const schluessel of platten) {
            zeile(`Speicherplatz ${schluessel}`, (s, n) => {
                const p = ((sys(n) && sys(n).platten) || []).find(x => (x.einhaengepunkt || x.pfad) === schluessel);
                return p ? balken(p.gesamt - p.frei, p.gesamt, { minFrei: 5 * GIB }) : fehlt();
            }, 'platte');
        }
        zeile('Last', (s, n) => {
            const sy = sys(n);
            if (!sy || !sy.cpu.kerne || !sy.last) return fehlt();
            const k = sy.cpu.kerne;
            return { art: 'last', anteil: sy.last[0] / k, min5: sy.last[1] / k, min15: sy.last[2] / k, stufe: stufe(sy.last[0] / k) };
        }, 'last');

        gruppe('System');
        zeile('CPU', (s, n) => (sys(n) ? text(`${sys(n).cpu.kerne} Kerne${sys(n).cpu.modell ? ` · ${sys(n).cpu.modell.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim()}` : ''}`) : fehlt()));
        zeile('Laufzeit', (s, n) => (sys(n) ? text(dauer(sys(n).laufzeit_s)) : fehlt()));
        zeile('System', (s, n) => (sys(n) ? { art: 'text', t: sys(n).host, notiz: `${sys(n).os} ${sys(n).arch} · Node ${sys(n).node}` } : fehlt()));
        zeile('Netzwerk', (s, n) => {
            const netz = (sys(n) && sys(n).netz) || [];
            return netz.length ? { art: 'text', t: netz.map(x => `${x.adresse} (${x.schnittstelle})`).join(', ') } : fehlt();
        });
        return zeilen;
    }

    function zelle(inhalt, n, feld) {
        const z = el('div', null, 'v-zelle');
        z.dataset.knoten = n;
        if (feld) z.dataset.feld = feld;
        if (inhalt.art === 'balken') {
            const kopf = el('div', null, 'balken-kopf');
            kopf.appendChild(el('span', inhalt.links));
            kopf.appendChild(el('span', inhalt.rechts));
            z.appendChild(kopf);
            const bahn = el('div', null, 'balken-bahn');
            const fuell = el('i', null, `balken-fuell balken-${inhalt.stufe}`);
            fuell.style.width = `${Math.min(100, Math.round(inhalt.anteil * 100))}%`;
            bahn.appendChild(fuell);
            z.appendChild(bahn);
            z.dataset.prozent = String(Math.round(inhalt.anteil * 100));
        } else if (inhalt.art === 'last') {
            // 100 % = alle Kerne; Füllung = letzte Minute, Striche = Mittel 5 und 15 Minuten.
            const bahn = el('div', null, 'balken-bahn balken-last');
            const fuell = el('i', null, `balken-fuell balken-${inhalt.stufe}`);
            fuell.style.width = `${Math.min(100, Math.round(inhalt.anteil * 100))}%`;
            bahn.appendChild(fuell);
            const strich = (anteil, klasse, titel) => {
                const s = el('b', null, klasse);
                s.style.left = `${Math.min(99, Math.round(anteil * 100))}%`;
                s.title = titel;
                bahn.appendChild(s);
            };
            strich(inhalt.min5, 'strich', `Mittel 5 Minuten: ${Math.round(inhalt.min5 * 100)} %`);
            strich(inhalt.min15, 'strich strich-hell', `Mittel 15 Minuten: ${Math.round(inhalt.min15 * 100)} %`);
            bahn.title = `Letzte Minute: ${Math.round(inhalt.anteil * 100)} %`;
            z.appendChild(bahn);
            z.dataset.prozent = String(Math.round(inhalt.anteil * 100));
        } else {
            z.appendChild(el('span', inhalt.t, inhalt.klasse || ''));
            if (inhalt.notiz) z.appendChild(el('div', inhalt.notiz, 'balken-notiz'));
        }
        return z;
    }

    // Eine gemeinsame Tabelle: links der Kennwert, rechts je Server eine Spalte — gleiche Kennwerte stehen auf einer Höhe.
    function vergleichTabelle(knoten) {
        const raster = el('div', null, 'vergleich');
        raster.appendChild(el('div', null, 'v-kopf'));
        for (const n of KNOTEN_NAMEN) {
            const kopf = el('div', null, 'v-kopf');
            kopf.dataset.knoten = n;
            kopf.appendChild(el('span', 'dns', 'material-icons'));
            kopf.appendChild(el('span', n));
            const s = knoten[n];
            if (s) kopf.appendChild(el('span', s.rolle === 'master' ? 'Master' : 'Secondary', `v-tag ${s.rolle === 'master' ? 'rolle-master' : 'rolle-secondary'}`));
            raster.appendChild(kopf);
        }
        for (const z of tabellenZeilen(knoten)) {
            if (z.gruppe) {
                raster.appendChild(el('div', z.gruppe, 'v-gruppe'));
                continue;
            }
            raster.appendChild(el('div', z.name, 'v-name'));
            for (const n of KNOTEN_NAMEN) raster.appendChild(zelle(z.fn(knoten[n] || null, n), n, z.feld));
        }
        return raster;
    }

    function tabelle(kopf, zeilen) {
        if (!zeilen.length) return el('p', 'Keine Einträge.');
        const t = el('table', null, 'cluster-tabelle');
        const tr = el('tr');
        kopf.forEach(k => tr.appendChild(el('th', k)));
        const thead = el('thead');
        thead.appendChild(tr);
        t.appendChild(thead);
        const tbody = el('tbody');
        zeilen.forEach(z => {
            const r = el('tr');
            z.forEach(w => r.appendChild(el('td', w)));
            tbody.appendChild(r);
        });
        t.appendChild(tbody);
        return t;
    }

    let aktuell = null;

    async function lade() {
        let daten;
        try {
            daten = await fetch('/api/cluster/status', { cache: 'no-store' }).then(r => r.json());
        } catch (err) {
            document.getElementById('clusterHinweis').textContent = 'Status nicht abrufbar.';
            return;
        }
        if (!daten.aktiv) {
            document.getElementById('clusterHinweis').textContent = 'Dieser Server läuft ohne Cluster (kein CLUSTER_KNOTEN konfiguriert).';
            return;
        }
        aktuell = daten;
        const { eigen, partner } = daten;
        const knoten = { [eigen.knoten]: eigen, [eigen.partner_knoten]: partner };
        document.getElementById('clusterHinweis').textContent =
            `Diese Seite läuft auf ${eigen.knoten}. VIP: ${eigen.vip || '–'} · aktualisiert ${zeit(eigen.zeit)}`;
        const container = document.getElementById('clusterKnoten');
        container.replaceChildren(vergleichTabelle(knoten));

        const clients = (daten.clients || []).map(c => [
            c.geraet || c.client_id, c.matte_id ? `Matte ${c.matte_id}` : '–', zeit(c.letzter_kontakt), String(c.ausstehend ?? 0)
        ]);
        document.getElementById('clusterClients').replaceChildren(tabelle(['Gerät', 'Matte', 'Letzter Kontakt', 'Ausstehend'], clients));

        const verlauf = [...(eigen.verlauf || []), ...((partner && partner.verlauf) || [])]
            .sort((a, b) => String(b.zeit).localeCompare(String(a.zeit)))
            .slice(0, 30)
            .map(v => [zeit(v.zeit), v.knoten, EREIGNISSE[v.ereignis] || v.ereignis, v.grund ? GRUENDE[v.grund] || v.grund : '', String(v.epoche ?? '')]);
        document.getElementById('clusterVerlauf').replaceChildren(tabelle(['Zeit', 'Server', 'Ereignis', 'Grund', 'Epoche'], verlauf));

        const btn = document.getElementById('btnUebergabe');
        const moeglich = eigen.rolle === 'master' && !eigen.uebergabe_laeuft;
        btn.style.display = moeglich ? 'inline-flex' : 'none';
        document.getElementById('btnUebergabeText').textContent = `Rolle an ${eigen.partner_knoten} übergeben`;
        zeigeUpdate(daten);
    }

    // Version beider Server, neueste Version, Update-Knopf (nur am Server, der aktualisiert wird) und der Hinweis auf den zweiten Server.
    function zeigeUpdate(daten) {
        const { eigen, partner, update } = daten;
        if (!update) return;
        const zeile = document.getElementById('updateZeile');
        const hinweis = document.getElementById('updateHinweis');
        const btn = document.getElementById('btnUpdate');
        const anderer = partner && partner.version ? partner.version : null;
        zeile.textContent = `Diese Version: ${eigen.version || 'unbekannt'} · neueste verfügbar: ${update.neuesteVersion || 'nicht prüfbar'}`
            + (update.zustand === 'laeuft' || update.laeuft ? ' · Update läuft …' : '')
            + (update.zustand === 'fehler' ? ` · Letztes Update fehlgeschlagen: ${update.meldung || ''}` : '');
        const verschieden = !!(anderer && eigen.version && anderer !== eigen.version);
        hinweis.style.display = verschieden ? 'block' : 'none';
        hinweis.textContent = verschieden
            ? `Dieser Server ist auf Version ${eigen.version}, ${eigen.partner_knoten} auf ${anderer}. Der andere Server wird nicht automatisch aktualisiert: Sein Update stoßen Sie dort auf cluster.html an, oder vom Master aus mit „Secondary aktualisieren“.`
            : '';
        btn.style.display = update.knopf ? 'inline-flex' : 'none';
        document.getElementById('btnUpdateText').textContent = update.aktion === 'nach_uebergabe'
            ? `Übergeben und auf ${update.ziel} aktualisieren`
            : `Auf ${update.ziel} aktualisieren`;

        // Aktualisieren des Secondary vom Master aus (Aufruf über die VIP).
        const teil = update.partner;
        const partnerBtn = document.getElementById('btnPartnerUpdate');
        partnerBtn.style.display = teil && teil.knopf ? 'inline-flex' : 'none';
        if (teil && teil.knopf) {
            document.getElementById('btnPartnerUpdateText').textContent = `${eigen.partner_knoten} (Secondary) auf ${teil.ziel} aktualisieren`;
        }

        // Ist ein neueres Release da, aber dieser Server bekommt keinen Knopf: den Grund zeigen statt zu schweigen.
        const neuer = update.neuesteVersion && eigen.version && update.neuesteVersion !== eigen.version;
        const grund = document.getElementById('updateGrund');
        const keinKnopf = !update.knopf && !(teil && teil.knopf);
        grund.style.display = neuer && keinKnopf && update.grund ? 'block' : 'none';
        grund.textContent = grund.style.display === 'block' ? `Update hier nicht möglich: ${update.grund}` : '';
        if (update.partner && update.partner.grund === 'Auf dem Secondary läuft bereits ein Update.') {
            zeile.textContent += ` · Update auf ${eigen.partner_knoten} läuft …`;
        }
    }

    document.getElementById('btnUpdate').addEventListener('click', async () => {
        if (!aktuell || !aktuell.update || !aktuell.update.knopf) return;
        const u = aktuell.update;
        const andere = aktuell.eigen.partner_knoten;
        const text = u.aktion === 'nach_uebergabe'
            ? `Master-Rolle an ${andere} übergeben und diesen Server auf ${u.ziel} aktualisieren?

Die Umschaltung dauert einige Sekunden.`
            : `Diesen Server auf ${u.ziel} aktualisieren?

Der Dienst startet dabei neu.`;
        if (!confirm(`${text}

Danach muss der andere Server (${andere}) ebenfalls aktualisiert werden: dort auf cluster.html „Update“ klicken.`)) return;
        const antwort = await fetch('/api/cluster/update', { method: 'POST' });
        const antwortDaten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) {
            alert(`Update nicht möglich: ${antwortDaten.error || antwort.status}`);
            return;
        }
        lade();
    });

    document.getElementById('btnPartnerUpdate').addEventListener('click', async () => {
        if (!aktuell || !aktuell.update || !aktuell.update.partner || !aktuell.update.partner.knopf) return;
        const ziel = aktuell.update.partner.ziel;
        const andere = aktuell.eigen.partner_knoten;
        if (!confirm(`${andere} (Secondary) auf ${ziel} aktualisieren?

Der Dienst auf ${andere} startet dabei neu. Dieser Server bleibt Master und arbeitet unverändert weiter; die Replikation ist kurz unterbrochen.

Danach kann dieser Server mit „Übergeben und aktualisieren“ folgen.`)) return;
        const antwort = await fetch('/api/cluster/partner-update', { method: 'POST' });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) {
            alert(`Update nicht möglich: ${daten.error || antwort.status}`);
            return;
        }
        lade();
    });

    document.getElementById('btnUebergabe').addEventListener('click', async () => {
        if (!aktuell) return;
        const ziel = aktuell.eigen.partner_knoten;
        if (!confirm(`Master-Rolle an ${ziel} übergeben?\n\nSchreibzugriffe sind für einige Sekunden gesperrt; Clients arbeiten in der Zeit offline weiter.`)) return;
        const antwort = await fetch('/api/cluster/uebergeben', { method: 'POST' });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) {
            alert(`Übergabe nicht möglich: ${daten.error || antwort.status}`);
            return;
        }
        document.getElementById('clusterHinweis').textContent = `Übergabe an ${ziel} läuft …`;
        lade();
    });

    lade();
    setInterval(lade, AKTUALISIERUNG_MS);
})();
