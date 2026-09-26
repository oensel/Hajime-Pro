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
        uebergabe_abgebrochen: 'Übergabe abgebrochen'
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

    function bytes(n) {
        if (n == null) return '–';
        if (n < 1024) return `${n} B`;
        return `${(n / 1024).toFixed(1)} KiB`;
    }

    function knotenKarte(name, s) {
        const karte = el('div', null, 'knoten-karte');
        karte.dataset.knoten = name;
        const titel = el('h2');
        titel.appendChild(el('span', 'dns', 'material-icons'));
        titel.appendChild(el('span', name));
        karte.appendChild(titel);
        const dl = el('dl');
        const zeile = (dt, dd, klasse) => {
            dl.appendChild(el('dt', dt));
            const d = el('dd', dd, klasse);
            dl.appendChild(d);
            return d;
        };
        if (!s) {
            zeile('Erreichbar', 'nein', 'zustand-schlecht');
            karte.appendChild(dl);
            return karte;
        }
        zeile('Erreichbar', 'ja', 'zustand-gut');
        zeile('Rolle', s.rolle === 'master' ? 'Master' : 'Secondary', s.rolle === 'master' ? 'rolle-master' : 'rolle-secondary').dataset.feld = 'rolle';
        zeile('Gesund', s.gesund ? 'ja' : `nein – ${(s.gruende || []).join(', ')}`, s.gesund ? 'zustand-gut' : 'zustand-schlecht');
        zeile('Epoche', String(s.epoche ?? '–'));
        const pg = s.pg || {};
        zeile('PostgreSQL', pg.rolle === 'primary' ? 'Primary' : pg.rolle === 'standby' ? 'Standby' : 'nicht erreichbar', pg.rolle ? '' : 'zustand-schlecht');
        if (s.rolle === 'master') {
            const abgesichert = pg.absicherung === 'synchron';
            zeile('Replikation', abgesichert ? 'synchron' : 'asynchron – ohne Absicherung', abgesichert ? 'zustand-gut' : 'zustand-warn').dataset.feld = 'absicherung';
            zeile('Rückstand (relational)', bytes(pg.rueckstand_bytes));
        } else if (pg.rolle === 'standby') {
            zeile('Empfängt vom Master', pg.empfaengt ? 'ja' : 'nein', pg.empfaengt ? 'zustand-gut' : 'zustand-warn');
        }
        const dok = s.dokumente || {};
        const pull = dok.partner_pull || {};
        zeile('Dokumente', dok.doc_count != null ? `${dok.doc_count} (Seq ${dok.update_seq})` : 'kein Turnier');
        zeile('Dokument-Replikation', pull.laeuft ? (pull.fehler ? `Fehler: ${pull.fehler}` : pull.aktiv ? 'überträgt …' : 'aktuell') : '–', pull.fehler ? 'zustand-warn' : '');
        if (s.rueckstufung_laeuft) zeile('Rückstufung', 'läuft …', 'zustand-warn');
        if (s.letzter_rueckstufungsfehler) zeile('Letzter Fehler', s.letzter_rueckstufungsfehler, 'zustand-schlecht');
        karte.appendChild(dl);
        return karte;
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
        container.replaceChildren(...['server1', 'server2'].map(n => knotenKarte(n, knoten[n])));

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
    }

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
