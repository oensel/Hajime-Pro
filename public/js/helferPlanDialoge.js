// Helferplan (helfer-plan.html): API-Zugriff, Detailleiste eines Slots, Popup und Menü der Tätigkeiten.
// Das Raster selbst (Zeitstrahl, Ziehen, Doppelklick) liegt in helferPlan.js.
// Namen und Bezeichnungen kommen nur per textContent in die Seite.
import { formatiereMinuten } from '/js/shared/helferZeit.js';

const kontext = { turnierId: null, neuLaden: async () => {}, schliesseAuswahl: () => {} };
let mitgliederCache = null;

export function initDialoge({ turnierId, neuLaden, schliesseAuswahl }) {
    Object.assign(kontext, { turnierId, neuLaden, schliesseAuswahl });
    initTaetigkeitDialog();
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.hp-menue, .hp-menue-knopf')) schliesseMenues();
    });
}

export function melde(text, typ = 'error') {
    if (window.zeigeNotification) window.zeigeNotification(text, typ);
    else console.warn(text);
}

export function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
}

/** fetch mit JSON; liefert { ok, status, daten } (daten = geparste Antwort oder {}). */
export async function api(methode, url, body) {
    const optionen = { method: methode, headers: {} };
    if (body !== undefined) {
        optionen.headers['Content-Type'] = 'application/json';
        optionen.body = JSON.stringify(body);
    }
    try {
        const resp = await fetch(url, optionen);
        let daten = {};
        try { daten = await resp.json(); } catch { /* leere Antwort */ }
        return { ok: resp.ok, status: resp.status, daten: daten || {} };
    } catch (err) {
        return { ok: false, status: 0, daten: { error: 'Server nicht erreichbar.' } };
    }
}

/**
 * Schreibzugriff; bei 409 'bestaetigung_noetig' fragt confirm() mit der Zahl der Eingetragenen nach und
 * wiederholt mit bestaetigt: true. Fehler (auch 409 'ueberlappung') erscheinen in der Snackbar.
 * @returns {Promise<{ok:boolean,status:number,daten:object,abgebrochen?:boolean}>}
 */
export async function sendeMitBestaetigung(methode, url, body = {}) {
    let r = await api(methode, url, body);
    if (r.status === 409 && r.daten.code === 'bestaetigung_noetig') {
        const anzahl = r.daten.daten?.anzahl;
        const meldung = r.daten.error || 'Trotzdem ändern?';
        const text = anzahl != null && !meldung.includes(String(anzahl))
            ? `${anzahl} Helfer sind eingetragen. ${meldung}` : meldung;
        if (!window.confirm(text)) return { ...r, ok: false, abgebrochen: true };
        r = await api(methode, url, { ...body, bestaetigt: true });
    }
    if (!r.ok) melde(r.daten.error || 'Speichern fehlgeschlagen.');
    return r;
}

// ---------------------------------------------------------------- Detailleiste

async function ladeMitglieder() {
    if (mitgliederCache) return mitgliederCache;
    const r = await api('GET', `/api/helfer-plan/${kontext.turnierId}/mitglieder`);
    mitgliederCache = r.ok && Array.isArray(r.daten) ? r.daten : [];
    return mitgliederCache;
}

function finde(plan, slotId) {
    for (const t of plan?.taetigkeiten || []) {
        const s = t.slots.find(x => x.id === slotId);
        if (s) return { taetigkeit: t, slot: s };
    }
    return null;
}

/** Zeigt die Detailleiste zum ausgewählten Slot (state.slotId) oder blendet sie aus. */
export async function zeigeDetail(state) {
    const box = document.getElementById('hpDetail');
    const treffer = state.slotId != null ? finde(state.plan, state.slotId) : null;
    if (!treffer) {
        box.hidden = true;
        box.replaceChildren();
        return;
    }
    const { taetigkeit, slot } = treffer;
    const eingetragen = slot.einsaetze.length;

    const kopf = el('div', 'hp-detail-kopf');
    kopf.append(
        el('h2', null, taetigkeit.bezeichnung),
        el('span', 'hp-detail-zeit', `${(taetigkeit.tag_versatz || 0) < 0 ? 'Vortag ' : ''}${formatiereMinuten(slot.von_min)}–${formatiereMinuten(slot.bis_min)} Uhr`),
        el('span', 'hp-detail-belegung', `Eingetragen: ${eingetragen} von ${slot.bedarf}`)
    );
    const schliessen = el('button', 'hp-detail-schliessen');
    schliessen.type = 'button';
    schliessen.setAttribute('aria-label', 'Detail schließen');
    schliessen.append(el('span', 'material-icons', 'close'));
    schliessen.addEventListener('click', () => kontext.schliesseAuswahl());
    kopf.append(schliessen);

    const liste = el('ul', 'hp-detail-liste');
    if (eingetragen === 0) liste.append(el('li', 'hp-detail-leer', 'Noch niemand eingetragen.'));
    for (const e of slot.einsaetze) {
        const li = el('li');
        li.append(el('span', null, e.name || '(ohne Namen)'));
        const weg = el('button', 'btn btn-outlined', 'Entfernen');
        weg.type = 'button';
        weg.setAttribute('aria-label', `${e.name} entfernen`);
        weg.addEventListener('click', async () => {
            const r = await sendeMitBestaetigung('DELETE', `/api/helfer-plan/einsaetze/${e.id}`);
            if (r.ok) melde(`${e.name} ausgetragen.`, 'success');
            await kontext.neuLaden();
        });
        li.append(weg);
        liste.append(li);
    }

    // Helfer zuteilen: Mitglied des Vereins oder Name ohne Konto
    const zuteilen = el('div', 'hp-detail-zeilen');
    const mitglieder = (await ladeMitglieder()).filter(m => !slot.einsaetze.some(e => e.benutzer_id === m.id));
    const auswahlGruppe = el('div', 'form-group');
    const auswahlLabel = el('label', null, 'Mitglied');
    auswahlLabel.htmlFor = 'hpMitglied';
    const auswahl = el('select');
    auswahl.id = 'hpMitglied';
    auswahl.append(new Option(mitglieder.length ? '– Mitglied wählen –' : '– keine Mitglieder –', ''));
    for (const m of mitglieder) auswahl.append(new Option(m.name, m.id));
    auswahl.disabled = mitglieder.length === 0;
    auswahlGruppe.append(auswahlLabel, auswahl);

    const freiGruppe = el('div', 'form-group');
    const freiLabel = el('label', null, 'oder Name ohne Konto');
    freiLabel.htmlFor = 'hpFreitext';
    const frei = el('input');
    frei.type = 'text';
    frei.id = 'hpFreitext';
    frei.maxLength = 100;
    frei.autocomplete = 'off';
    freiGruppe.append(freiLabel, frei);

    const zuteilenKnopf = el('button', 'btn btn-raised', 'Helfer zuteilen');
    zuteilenKnopf.type = 'button';
    zuteilenKnopf.id = 'hpZuteilen';
    const teileZu = async () => {
        const benutzerId = auswahl.value;
        const name = frei.value.trim();
        if (!benutzerId && !name) { melde('Mitglied wählen oder Namen eingeben.'); return; }
        const r = await sendeMitBestaetigung('POST', `/api/helfer-plan/slots/${slot.id}/einsaetze`,
            benutzerId ? { benutzerId } : { name });
        if (r.ok) melde('Helfer zugeteilt.', 'success');
        await kontext.neuLaden();
    };
    zuteilenKnopf.addEventListener('click', teileZu);
    frei.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); teileZu(); } });
    zuteilen.append(auswahlGruppe, freiGruppe, zuteilenKnopf);

    // Bedarf dieses Slots und Slot löschen
    const slotZeile = el('div', 'hp-detail-zeilen');
    const bedarfGruppe = el('div', 'form-group hp-schmal');
    const bedarfLabel = el('label', null, 'Helfer im Slot');
    bedarfLabel.htmlFor = 'hpSlotBedarf';
    const bedarf = el('input');
    bedarf.type = 'number';
    bedarf.id = 'hpSlotBedarf';
    bedarf.min = '1';
    bedarf.max = '20';
    bedarf.value = String(slot.bedarf);
    bedarfGruppe.append(bedarfLabel, bedarf);
    const bedarfKnopf = el('button', 'btn btn-outlined', 'Anzahl übernehmen');
    bedarfKnopf.type = 'button';
    bedarfKnopf.addEventListener('click', async () => {
        const n = Number(bedarf.value);
        if (!Number.isInteger(n) || n < 1 || n > 20) { melde('Anzahl zwischen 1 und 20 eingeben.'); return; }
        const r = await sendeMitBestaetigung('PUT', `/api/helfer-plan/slots/${slot.id}`, { bedarf: n });
        if (r.ok) melde('Anzahl gespeichert.', 'success');
        await kontext.neuLaden();
    });
    const loeschen = el('button', 'btn btn-outlined hp-btn-gefahr', 'Slot löschen');
    loeschen.type = 'button';
    loeschen.addEventListener('click', async () => {
        const r = await sendeMitBestaetigung('DELETE', `/api/helfer-plan/slots/${slot.id}`);
        if (r.ok) {
            melde('Slot gelöscht.', 'success');
            kontext.schliesseAuswahl();
        }
        await kontext.neuLaden();
    });
    slotZeile.append(bedarfGruppe, bedarfKnopf, loeschen);

    box.replaceChildren(kopf, liste, zuteilen, slotZeile);
    box.hidden = false;
}

// ---------------------------------------------------------------- Popup Tätigkeit

let dialogZustand = { modus: 'neu', taetigkeit: null };

function initTaetigkeitDialog() {
    const modal = document.getElementById('hpTaetigkeitModal');
    document.getElementById('hpTaetigkeitNeu').addEventListener('click', () => oeffneTaetigkeitDialog());
    document.getElementById('hpTaetigkeitAbbrechen').addEventListener('click', schliesseTaetigkeitDialog);
    modal.addEventListener('click', (e) => { if (e.target === modal) schliesseTaetigkeitDialog(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesseTaetigkeitDialog(); });
    document.getElementById('hpTaetigkeitForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await bestaetigeTaetigkeitDialog();
    });
}

export function oeffneTaetigkeitDialog(taetigkeit = null) {
    dialogZustand = { modus: taetigkeit ? 'bearbeiten' : 'neu', taetigkeit };
    document.getElementById('hpTaetigkeitTitel').textContent = taetigkeit ? 'Tätigkeit bearbeiten' : 'Tätigkeit hinzufügen';
    document.getElementById('hpTaetigkeitOk').textContent = taetigkeit ? 'Speichern' : 'Hinzufügen';
    const bez = document.getElementById('hpTaetigkeitBezeichnung');
    bez.value = taetigkeit ? taetigkeit.bezeichnung : '';
    document.getElementById('hpTaetigkeitBedarf').value = String(taetigkeit ? taetigkeit.bedarf : 2);
    document.getElementById('hpTaetigkeitFehler').textContent = '';
    document.getElementById('hpTaetigkeitModal').hidden = false;
    bez.focus();
}

function schliesseTaetigkeitDialog() {
    document.getElementById('hpTaetigkeitModal').hidden = true;
}

async function bestaetigeTaetigkeitDialog() {
    const fehler = document.getElementById('hpTaetigkeitFehler');
    const bezFeld = document.getElementById('hpTaetigkeitBezeichnung');
    const bezeichnung = bezFeld.value.trim();
    const bedarf = Number(document.getElementById('hpTaetigkeitBedarf').value);
    if (!bezeichnung) {
        fehler.textContent = 'Bezeichnung eingeben';
        bezFeld.focus();
        return;
    }
    if (!Number.isInteger(bedarf) || bedarf < 1 || bedarf > 20) {
        fehler.textContent = 'Anzahl Helfer zwischen 1 und 20 eingeben';
        return;
    }
    fehler.textContent = '';
    const { modus, taetigkeit } = dialogZustand;
    const r = modus === 'neu'
        ? await sendeMitBestaetigung('POST', `/api/helfer-plan/${kontext.turnierId}/taetigkeiten`, { bezeichnung, bedarf })
        : await sendeMitBestaetigung('PUT', `/api/helfer-plan/taetigkeiten/${taetigkeit.id}`, { bezeichnung, bedarf });
    if (r.abgebrochen) return;
    if (!r.ok) {
        fehler.textContent = r.daten.error || 'Speichern fehlgeschlagen.';
        return;
    }
    schliesseTaetigkeitDialog();
    await kontext.neuLaden();
}

// ---------------------------------------------------------------- Aktualisierung aus der Cloud

/**
 * Knopf „Helferplan aus der Cloud aktualisieren“ (nur Hallen-Server, Spec Abschnitt 8): sichtbar, wenn
 * /api/cloud/status die Cloud als verfügbar meldet und das Turnier aus der Cloud stammt (urspruengliche_id).
 * Anmeldung wie auf turniere.html: Benutzer/Passwort, das Token lebt nur bis zum Ende des Vorgangs.
 */
export async function initCloudAktualisierung() {
    const knopf = document.getElementById('hpCloudAktualisieren');
    const modal = document.getElementById('hpCloudModal');
    if (!knopf || !modal || !kontext.turnierId) return;

    const status = await api('GET', '/api/cloud/status');
    if (!status.ok || status.daten.verfuegbar !== true) return;
    const turnier = await api('GET', `/api/turniere/${encodeURIComponent(kontext.turnierId)}`);
    const cloudId = turnier.ok ? turnier.daten.urspruengliche_id : null;
    if (cloudId == null) return;

    const email = document.getElementById('hpCloudEmail');
    const passwort = document.getElementById('hpCloudPasswort');
    const fehler = document.getElementById('hpCloudFehler');
    const ok = document.getElementById('hpCloudOk');
    const schliessen = () => { modal.hidden = true; passwort.value = ''; };

    knopf.hidden = false;
    knopf.addEventListener('click', () => {
        fehler.textContent = '';
        passwort.value = '';
        modal.hidden = false;
        (email.value ? passwort : email).focus();
    });
    document.getElementById('hpCloudAbbrechen').addEventListener('click', schliessen);
    modal.addEventListener('click', (e) => { if (e.target === modal) schliessen(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliessen(); });
    document.getElementById('hpCloudForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!email.value.trim() || !passwort.value) {
            fehler.textContent = 'Benutzer und Passwort eingeben';
            return;
        }
        fehler.textContent = '';
        ok.disabled = true;
        try {
            const anmeldung = await api('POST', '/api/cloud/turniere', { email: email.value.trim(), password: passwort.value });
            if (!anmeldung.ok || !anmeldung.daten.token) {
                fehler.textContent = anmeldung.daten.error || 'Anmeldung an der Cloud fehlgeschlagen.';
                return;
            }
            const r = await api('POST', `/api/cloud/turniere/${encodeURIComponent(cloudId)}/helferplan`, { token: anmeldung.daten.token });
            if (!r.ok) {
                fehler.textContent = r.daten.error || 'Der Helferplan konnte nicht aktualisiert werden.';
                return;
            }
            schliessen();
            melde('Helferplan aus der Cloud aktualisiert.', 'success');
            kontext.schliesseAuswahl();
            await kontext.neuLaden();
        } finally {
            ok.disabled = false;
        }
    });
}

// ---------------------------------------------------------------- Menü eigener Tätigkeiten

function schliesseMenues() {
    document.querySelectorAll('.hp-menue').forEach(m => m.remove());
}

/** Knopf mit kleinem Menü (Bearbeiten, Löschen) für eigene Tätigkeiten (art 'frei'). */
export function baueLabelMenue(taetigkeit) {
    const knopf = el('button', 'hp-menue-knopf');
    knopf.type = 'button';
    knopf.setAttribute('aria-label', `Menü ${taetigkeit.bezeichnung}`);
    knopf.append(el('span', 'material-icons', 'more_vert'));
    knopf.addEventListener('click', (e) => {
        e.stopPropagation();
        const label = knopf.closest('.hp-label');
        const offen = label.querySelector('.hp-menue');
        schliesseMenues();
        if (offen) return;
        const menue = el('div', 'hp-menue');
        menue.setAttribute('role', 'menu');
        const bearbeiten = el('button', null, 'Bearbeiten');
        bearbeiten.type = 'button';
        bearbeiten.setAttribute('role', 'menuitem');
        bearbeiten.addEventListener('click', () => { schliesseMenues(); oeffneTaetigkeitDialog(taetigkeit); });
        const loeschen = el('button', null, 'Löschen');
        loeschen.type = 'button';
        loeschen.setAttribute('role', 'menuitem');
        loeschen.addEventListener('click', () => { schliesseMenues(); loescheTaetigkeit(taetigkeit); });
        menue.append(bearbeiten, loeschen);
        label.append(menue);
    });
    return knopf;
}

async function loescheTaetigkeit(taetigkeit) {
    const anzahl = taetigkeit.slots.reduce((n, s) => n + s.einsaetze.length, 0);
    const frage = anzahl > 0
        ? `Tätigkeit „${taetigkeit.bezeichnung}“ löschen? ${anzahl} Helfer sind eingetragen.`
        : `Tätigkeit „${taetigkeit.bezeichnung}“ mit allen Slots löschen?`;
    if (!window.confirm(frage)) return;
    const r = await sendeMitBestaetigung('DELETE', `/api/helfer-plan/taetigkeiten/${taetigkeit.id}`,
        anzahl > 0 ? { bestaetigt: true } : {});
    if (r.ok) melde('Tätigkeit gelöscht.', 'success');
    await kontext.neuLaden();
}
