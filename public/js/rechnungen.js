// Seite "Rechnungen": alle Startgeld-Rechnungen des Vereins als Ausrichter, filterbar. Rechnungen erstellen, SEPA und Zahlstatus
// bleiben in der Abrechnung des Turniers (abrechnung.html). Server-Texte kommen nur über textContent in die Seite.
(function () {
    const $ = (id) => document.getElementById(id);
    const vereinId = new URLSearchParams(window.location.search).get('vereinId');
    const STATUS = { offen: 'Offen', versandt: 'Versandt', bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig', eingezogen: 'Eingezogen', zurueckgebucht: 'Zurückgebucht' };
    const ZAHLWEG = { bar: 'Bar', ueberweisung: 'Überweisung', lastschrift: 'Lastschrift' };
    const OFFEN = ['offen', 'versandt', 'ueberfaellig'];
    const BEZAHLT = ['bezahlt', 'eingezogen'];

    let rechnungen = [];

    const euro = (cent) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((cent || 0) / 100);
    const datum = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

    function el(tag, eigenschaften, kinder) {
        const e = document.createElement(tag);
        Object.assign(e, eigenschaften || {});
        for (const k of kinder || []) e.append(k);
        return e;
    }

    function zeigeFehler(text) {
        $('rchFehler').textContent = text || '';
        $('rchFehler').hidden = !text;
    }

    function zeigeKennzahlen() {
        const summe = (stati) => rechnungen.filter((r) => stati.includes(r.anzeigeStatus)).reduce((s, r) => s + r.betrag_cent, 0);
        $('rchOffen').textContent = euro(summe(OFFEN));
        $('rchBezahlt').textContent = euro(summe(BEZAHLT));
        $('rchRueck').textContent = String(rechnungen.filter((r) => r.anzeigeStatus === 'zurueckgebucht').length);
    }

    function fuelleFilter() {
        const turniere = new Map();
        for (const r of rechnungen) {
            const schluessel = r.turnier_id != null ? String(r.turnier_id) : `name:${r.turnier_bezeichnung || ''}`;
            if (!turniere.has(schluessel)) turniere.set(schluessel, r.turnier_bezeichnung || 'Turnier');
        }
        for (const [wert, name] of turniere) $('rchTurnier').append(el('option', { value: wert, textContent: name }));
        const stati = [...new Set(rechnungen.map((r) => r.anzeigeStatus))];
        for (const s of stati) $('rchStatus').append(el('option', { value: s, textContent: STATUS[s] || s }));
    }

    async function ladePdf(r) {
        zeigeFehler('');
        const antwort = await fetch(`/api/abrechnung/${encodeURIComponent(r.turnier_id)}/rechnungen/${encodeURIComponent(r.id)}/pdf`);
        if (!antwort.ok) {
            const inhalt = await antwort.json().catch(() => ({}));
            return zeigeFehler(inhalt.error || 'Das PDF konnte nicht geladen werden.');
        }
        const adresse = URL.createObjectURL(await antwort.blob());
        const link = el('a', { href: adresse, download: `${String(r.nummer).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(adresse), 10000);
    }

    function zelle(label, inhalt, klasse) {
        const td = el('td', klasse ? { className: klasse } : {});
        td.dataset.label = label;
        td.append(...(Array.isArray(inhalt) ? inhalt : [inhalt]));
        return td;
    }

    function zeichne() {
        const turnier = $('rchTurnier').value;
        const status = $('rchStatus').value;
        const zahlweg = $('rchZahlweg').value;
        const suche = $('rchSuche').value.trim().toLowerCase();
        const treffer = rechnungen.filter((r) => {
            const schluessel = r.turnier_id != null ? String(r.turnier_id) : `name:${r.turnier_bezeichnung || ''}`;
            return (!turnier || schluessel === turnier)
                && (!status || r.anzeigeStatus === status)
                && (!zahlweg || r.zahlweg === zahlweg)
                && (!suche || `${r.nummer} ${r.verein_name}`.toLowerCase().includes(suche));
        });
        const tabelle = $('rchTabelle');
        tabelle.replaceChildren();
        for (const r of treffer) {
            const zeile = el('tr');
            const nummer = [r.nummer];
            if (r.art === 'quittung') nummer.push(el('span', { className: 'rch-klein', textContent: 'Quittung' }));
            const aktionen = el('div', { className: 'rch-aktionen' });
            if (r.turnier_id != null) {
                const pdf = el('button', { type: 'button', className: 'btn btn-outlined', textContent: 'PDF', title: `${r.nummer} herunterladen` });
                pdf.addEventListener('click', () => ladePdf(r));
                aktionen.append(pdf, el('a', { className: 'btn btn-outlined', href: `/abrechnung.html?turnierId=${encodeURIComponent(r.turnier_id)}`, textContent: 'Abrechnung' }));
            }
            zeile.append(
                zelle('Nummer', nummer, 'nr'),
                zelle('Datum', datum(r.rechnungsdatum)),
                zelle('Turnier', r.turnier_bezeichnung || ''),
                zelle('Empfänger', r.verein_name),
                zelle('Zahlweg', ZAHLWEG[r.zahlweg] || r.zahlweg),
                zelle('Betrag', euro(r.betrag_cent), 'rechts'),
                zelle('Status', el('span', { className: `rch-chip ${r.anzeigeStatus}`, textContent: STATUS[r.anzeigeStatus] || r.anzeigeStatus })),
                zelle('Aktionen', aktionen)
            );
            tabelle.append(zeile);
        }
        const leer = $('rchLeer');
        leer.hidden = treffer.length > 0;
        leer.textContent = rechnungen.length === 0
            ? 'Es wurden noch keine Rechnungen erstellt. Rechnungen entstehen in der Abrechnung eines Turniers.'
            : 'Keine Rechnung passt zu den Filtern.';
    }

    // --- Hinweis, wenn Angaben des Vereins für Rechnungen fehlen (gepflegt wird auf verein.html) ---
    async function ladeWarnung() {
        try {
            const resp = await fetch(`/api/abrechnung/stammdaten/${encodeURIComponent(vereinId || '')}`);
            if (!resp.ok) return;
            const { fehlt } = await resp.json();
            if (!fehlt || fehlt.length === 0) return;
            $('rchWarnungFehlt').textContent = fehlt.join(', ');
            $('rchWarnungLink').href = `/verein.html?vereinId=${encodeURIComponent(vereinId)}`;
            $('rchWarnung').hidden = false;
        } catch { /* Hinweis ist optional */ }
    }

    async function lade() {
        if (!/^\d+$/.test(String(vereinId || ''))) return zeigeFehler('Es wurde kein Verein angegeben.');
        try {
            const resp = await fetch(`/api/abrechnung/verein/${encodeURIComponent(vereinId)}/rechnungen`);
            const daten = await resp.json().catch(() => ({}));
            if (!resp.ok) return zeigeFehler(daten.error || 'Die Rechnungen konnten nicht geladen werden.');
            rechnungen = daten.rechnungen || [];
        } catch {
            return zeigeFehler('Die Rechnungen konnten nicht geladen werden.');
        }
        zeigeKennzahlen();
        fuelleFilter();
        zeichne();
        $('rchInhalt').hidden = false;
        ladeWarnung();
        try {
            const resp = await fetch('/api/auth/me');
            const me = resp.ok ? (await resp.json()).user : null;
            const treffer = me && Array.isArray(me.vereine) ? me.vereine.find((v) => String(v.verein_id) === String(vereinId)) : null;
            if (treffer) $('rchVerein').textContent = treffer.name;
        } catch { /* der Name ist nur Zierde */ }
    }

    for (const id of ['rchTurnier', 'rchStatus', 'rchZahlweg']) $(id).addEventListener('change', zeichne);
    $('rchSuche').addEventListener('input', zeichne);
    lade();
})();
