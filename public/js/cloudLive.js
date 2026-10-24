// Seite "Live in der Cloud" (cloud-live.html): ein Admin schaltet sein Turnier live, zeigt den Kopplungs-QR, sieht die gekoppelten
// Geräte und beendet den Live-Betrieb wieder. API: /api/cloud-live/:turnierId (src/cloudLive/verwaltungRoutes.js).
document.addEventListener('DOMContentLoaded', () => {
    const turnierId = new URLSearchParams(window.location.search).get('turnierId');
    const el = (id) => document.getElementById(id);
    if (!turnierId || !/^\d+$/.test(turnierId)) {
        el('clFehler').textContent = 'Kein Turnier angegeben.';
        el('clFehler').style.display = '';
        return;
    }
    const basis = `/api/cloud-live/${turnierId}`;
    let status = null;

    const meldung = (text, art = 'error') => {
        if (window.zeigeNotification) window.zeigeNotification(text, art);
    };
    const zeigeFehler = (text) => {
        el('clFehler').textContent = text || '';
        el('clFehler').style.display = text ? '' : 'none';
    };
    const uhrzeit = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' }) : '–');

    async function ruf(pfad = '', methode = 'GET', body) {
        const antwort = await fetch(basis + pfad, {
            method: methode,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await antwort.json(); } catch { /* leer */ }
        return { ok: antwort.ok, status: antwort.status, daten: daten || {} };
    }

    function zeigeGeraete(geraete) {
        const tabelle = el('clGeraete');
        const tbody = tabelle.querySelector('tbody');
        tbody.textContent = '';
        for (const g of geraete) {
            const zeile = tbody.insertRow();
            const werte = [g.geraet || g.clientId, g.matteId != null ? `Matte ${g.matteId}` : '–', uhrzeit(g.letzterKontakt), String(g.ausstehend || 0)];
            for (const wert of werte) zeile.insertCell().textContent = wert;
        }
        tabelle.style.display = geraete.length ? '' : 'none';
        el('clKeineGeraete').style.display = geraete.length ? 'none' : '';
    }

    function zeige(neu) {
        status = neu;
        el('clPlaetze').textContent = `${neu.offeneInstanzen} von ${neu.maxInstanzen} Live-Plätzen der Cloud belegt.`;
        el('clAus').style.display = neu.live ? 'none' : '';
        el('clLive').style.display = neu.live ? '' : 'none';
        el('clGeholtHinweis').style.display = neu.geholt && !neu.live ? '' : 'none';
        if (!neu.live) return;
        el('clCode').textContent = `${neu.code.slice(0, 3)} ${neu.code.slice(3)}`;
        el('clGesperrt').style.display = neu.gesperrt ? '' : 'none';
        el('clSperrenBtn').textContent = neu.gesperrt ? 'Zugang freigeben' : 'Zugang sperren';
        el('clUrl').textContent = neu.url;
        el('clGueltigBis').textContent = neu.gueltigBis ? `Zugang gültig bis ${uhrzeit(neu.gueltigBis)}` : '';
        if (window.qrcode) {
            const qr = window.qrcode(0, 'M');
            qr.addData(neu.qr);
            qr.make();
            el('clQr').innerHTML = qr.createSvgTag(4, 4);
        }
        zeigeGeraete(neu.geraete || []);
    }

    async function lade() {
        const r = await ruf();
        if (!r.ok) {
            zeigeFehler(r.daten.error || `Fehler ${r.status}`);
            return;
        }
        zeigeFehler('');
        zeige(r.daten);
    }

    el('clStartenBtn').addEventListener('click', async () => {
        const bestaetigt = el('clGeholtBestaetigt').checked;
        const r = await ruf('/starten', 'POST', { bestaetigt });
        if (r.ok) { zeigeFehler(''); zeige(r.daten); return; }
        if (r.daten.code === 'bereits_geholt') {
            el('clGeholtHinweis').style.display = '';
            zeigeFehler('Bitte bestätigen, dass das Turnier trotzdem in der Cloud live geführt werden soll.');
            return;
        }
        zeigeFehler(r.daten.error || 'Live schalten ist fehlgeschlagen.');
    });

    el('clErneuernBtn').addEventListener('click', async () => {
        if (!window.confirm('Neuen Code erzeugen? Bereits gekoppelte Geräte müssen danach neu koppeln.')) return;
        const r = await ruf('/code-erneuern', 'POST', {});
        if (r.ok) zeige(r.daten); else zeigeFehler(r.daten.error);
    });

    el('clSperrenBtn').addEventListener('click', async () => {
        const r = await ruf('/sperren', 'POST', { wert: !(status && status.gesperrt) });
        if (r.ok) zeige(r.daten); else zeigeFehler(r.daten.error);
    });

    el('clBeendenBtn').addEventListener('click', async () => {
        if (!window.confirm('Live-Betrieb beenden? Der Stand wird in das Turnier übernommen, die Geräte verlieren die Verbindung.')) return;
        let r = await ruf('/beenden', 'POST', {});
        if (!r.ok && r.status === 409 && r.daten.ausstehendeGeraete > 0) {
            if (!window.confirm(`${r.daten.error}\n\nTrotzdem beenden?`)) return;
            r = await ruf('/beenden', 'POST', { erzwingen: true });
        }
        if (r.ok) { zeigeFehler(''); zeige(r.daten); meldung('Live-Betrieb beendet.', 'success'); } else zeigeFehler(r.daten.error);
    });

    fetch(`/api/turniere/${turnierId}`).then((a) => (a.ok ? a.json() : null)).then((d) => {
        const turnier = d && (d.turnier || d.data || d);
        if (turnier && turnier.bezeichnung) el('clTurnierName').textContent = turnier.bezeichnung;
    }).catch(() => {});

    lade();
    // Geräteliste und Platzzähler aktuell halten, solange der Tab sichtbar ist
    const timer = setInterval(() => { if (!document.hidden) lade(); }, 5000);
    window.addEventListener('pagehide', () => clearInterval(timer));
});
