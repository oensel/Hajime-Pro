// Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO) zwischen dem ausrichtenden Verein (Verantwortlicher) und dem Betreiber
// (Auftragsverarbeiter), nur Cloud. Der Text entsteht aus den Betreiberangaben (src/services/rechtliches.js) und dem Verein; ein
// Admin des Vereins nimmt ihn online an (Textform genügt, Art. 28 Abs. 9), der angenommene Text bleibt samt SHA-256 in
// av_vertrag_annahmen als Nachweis. Neue Turniere legt ein Verein erst nach der Annahme an (createTurnier, app.set('avVertragPflicht')).
// Wer den Text wesentlich ändert, erhöht AV_VERTRAG_FASSUNG: dann muss jeder Verein neu annehmen, bis dahin gilt die alte Fassung nicht als angenommen.
// Muster und Erläuterungen: docs/datenschutz/av-vertrag-muster.md. Textbausteine nach bestem Wissen, keine Rechtsberatung.
import crypto from 'node:crypto';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { FachFehler } from '../utils/fachFehler.js';
import { ladeBenutzerMitAktivemVerein } from '../utils/vereinHelper.js';
import { e, feld, mailLink, fehlt, anschriftBlock, datumDeutsch, tageAus } from './rechtstexte.js';

export const AV_VERTRAG_FASSUNG = '2026-10-28';
const MAX_FELD = 200;

/** Cloud (abschaltbar mit AV_VERTRAG_AKTIV=false, z. B. die Vollablauf-Suite gegen echte Konten) bzw. AV_VERTRAG_AKTIV=true für Tests. */
export function istAvVertragAktiv(env = process.env) {
    if (env.AV_VERTRAG_AKTIV === 'false') return false;
    return betriebsmodus.liesBetriebsmodus(env).istCloud || env.AV_VERTRAG_AKTIV === 'true';
}

const enthaeltLuecke = (html) => html.includes('class="fehlt"');
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const zeitpunkt = (d) => new Date(d).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });

/**
 * Vertragstext als HTML (Inhalt des <article>). Ohne vereinName entsteht die allgemeine Fassung für /av-vertrag.html.
 * Fehlende Betreiberangaben erscheinen wie in Impressum und Datenschutzerklärung rot; so ein Text lässt sich nicht annehmen.
 */
export function rendereAvVertragText(rechtliches, { vereinName = '', env = process.env } = {}) {
    const { daten } = rechtliches;
    const b = daten.betreiber;
    const ds = daten.datenschutz;
    const kontakt = ds.email || b.email;
    const sicherungTage = Math.max(tageAus(env.SICHERUNG_BEHALTEN, 14), daten.backup.aktiv ? tageAus(daten.backup.aufbewahrungTage, 60) : 0);
    const drittlandGrundlage = (d) => (d.drittland ? feld(d.garantie, 'Grundlage der Drittlandübermittlung') : '– (EU/EWR)');

    const unterauftrag = [
        `<tr><td>${feld(daten.hosting.anbieter, 'Hosting-Anbieter')}</td><td>Server-Hosting</td><td>alle</td><td>${e(daten.hosting.standort || 'Deutschland')}</td><td>–</td></tr>`,
        `<tr><td>${feld(daten.datenbank.anbieter, 'Datenbank-Anbieter')}</td><td>Datenbank</td><td>alle</td><td>${e(daten.datenbank.region || '–')}</td><td>${drittlandGrundlage(daten.datenbank)}</td></tr>`,
        `<tr><td>${feld(daten.mail.anbieter, 'E-Mail-Anbieter')}</td><td>E-Mail-Versand</td><td>Name, E-Mail-Adresse, Inhalt der Benachrichtigung</td><td>–</td><td>–</td></tr>`,
        daten.backup.aktiv ? `<tr><td>${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}</td><td>Sicherungskopie an anderem Ort</td><td>alle, nur verschlüsselt (AES-256-GCM, der Anbieter kann sie nicht lesen)</td><td>–</td><td>${drittlandGrundlage(daten.backup)}</td></tr>` : ''
    ].filter(Boolean).join('\n');

    return `
<h1>Vertrag zur Auftragsverarbeitung</h1>
<p class="stand">nach Art. 28 Datenschutz-Grundverordnung (DSGVO) · Fassung vom ${e(datumDeutsch(AV_VERTRAG_FASSUNG))}</p>

<p>zwischen</p>
<p><strong>${vereinName ? e(vereinName) : 'dem Verein, der diesen Vertrag in Hajime Pro annimmt'}</strong><br>– nachfolgend „Verantwortlicher“ –</p>
<p>und</p>
<p>${anschriftBlock(b)}<br>E-Mail: ${kontakt ? mailLink(kontakt) : fehlt('E-Mail-Adresse')}<br>– nachfolgend „Auftragsverarbeiter“ –</p>

<h2>§ 1 Gegenstand, Zweck und Dauer</h2>
<ol>
<li>Der Auftragsverarbeiter stellt dem Verantwortlichen die Software <strong>Hajime Pro</strong> als Online-Dienst zur Organisation von Judo-Turnieren bereit (Ausschreibung, Anmeldung, Waage, Auslosung, Zeit- und Mattenplanung, Wettkampfablauf, Ergebnislisten, Urkunden, Helferplan, Startgeld-Abrechnung${daten.teilnehmerApp.aktiv ? ', auf Wunsch öffentliche Teilnehmer-App mit Benachrichtigungen' : ''}). Dabei verarbeitet er personenbezogene Daten im Auftrag des Verantwortlichen für die Turniere, die der Verantwortliche ausrichtet.</li>
<li><strong>Art der Verarbeitung:</strong> Erheben über die Anmeldung, Speichern, Ordnen, Abfragen, Verknüpfen, Auslosen, Anzeigen, Veröffentlichen (nur soweit der Verantwortliche Ergebnisse oder die Teilnehmer-App freigibt), Versenden von E-Mails, Exportieren, Sichern und Löschen.</li>
<li><strong>Zweck:</strong> Planung, Durchführung und Abrechnung der Turniere des Verantwortlichen.</li>
<li><strong>Dauer:</strong> Der Vertrag gilt ab der Annahme auf unbestimmte Zeit, solange der Verantwortliche den Dienst für eigene Turniere nutzt. Jede Partei kann ihn jederzeit in Textform kündigen.</li>
</ol>

<h2>§ 2 Art der Daten und Kreis der Betroffenen</h2>
<table>
<thead><tr><th>Betroffene</th><th>Datenarten</th></tr></thead>
<tbody>
<tr><td>Teilnehmende an Turnieren (auch Minderjährige)</td><td>Vor- und Nachname, Geburtsjahr, Geschlecht, Verein, Judopass-Nummer, Gewicht, Alters- und Gewichtsklasse, Graduierung, Anmeldestatus, Kämpfe, Ergebnisse, Platzierungen</td></tr>
<tr><td>Mitglieder des Verantwortlichen mit Benutzerkonto</td><td>Vor- und Nachname, E-Mail-Adresse, Rolle, Anmelde- und Aktionsprotokoll</td></tr>
<tr><td>Helfende, Kampfrichter, Verantwortliche für Orga-Aufgaben</td><td>Name, E-Mail-Adresse (soweit eingetragen), Einsatzzeiten, Aufgaben</td></tr>
<tr><td>Ansprechpersonen meldender Vereine</td><td>Name, E-Mail-Adresse, Rechnungsanschrift; bei Lastschrift Kontoinhaber und IBAN</td></tr>
${daten.teilnehmerApp.aktiv ? '<tr><td>Besucher der öffentlichen Teilnehmer-App (nur bei Freigabe)</td><td>bei eingeschalteten Benachrichtigungen: Push-Adresse des Geräts und gewählte Kämpfer</td></tr>' : ''}
</tbody>
</table>
<p>Besondere Kategorien personenbezogener Daten (Art. 9 DSGVO, z. B. Gesundheitsdaten) gibt der Verantwortliche nicht in den Dienst ein.</p>

<h2>§ 3 Weisungen</h2>
<ol>
<li>Der Auftragsverarbeiter verarbeitet die Daten nur auf dokumentierte Weisung des Verantwortlichen, auch hinsichtlich der Übermittlung in ein Drittland, es sei denn, er ist durch das Recht der Union oder eines Mitgliedstaats dazu verpflichtet; in diesem Fall teilt er dem Verantwortlichen diese Anforderung vorher mit, soweit das Recht dies nicht verbietet. Weisungen sind dieser Vertrag und die Bedienung des Dienstes durch den Verantwortlichen (Eingaben, Freigaben, Löschungen); weitere Weisungen erteilt der Verantwortliche in Textform.</li>
<li>Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, weist er den Verantwortlichen unverzüglich darauf hin. Er darf die Ausführung aussetzen, bis der Verantwortliche sie bestätigt oder ändert.</li>
<li>Weisungsberechtigt sind die Personen, die in Hajime Pro die Rolle „Admin“ des Verantwortlichen haben. Ansprechpartner des Auftragsverarbeiters ist ${kontakt ? mailLink(kontakt) : fehlt('E-Mail-Adresse')}.</li>
</ol>

<h2>§ 4 Pflichten des Auftragsverarbeiters</h2>
<ol>
<li><strong>Vertraulichkeit:</strong> Alle Personen, die beim Auftragsverarbeiter Zugriff auf die Daten haben, sind zur Vertraulichkeit verpflichtet. Sie greifen nur darauf zu, soweit es für Betrieb, Fehlerbehebung oder Unterstützung des Verantwortlichen nötig ist; schreibende Zugriffe hält das Aktionsprotokoll fest.</li>
<li><strong>Sicherheit der Verarbeitung:</strong> Der Auftragsverarbeiter trifft die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO gemäß <strong>Anlage 1</strong>. Er passt sie dem Stand der Technik an; das Schutzniveau darf dabei nicht sinken.</li>
<li><strong>Betroffenenrechte:</strong> Er unterstützt den Verantwortlichen mit geeigneten Maßnahmen bei Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 12 bis 22 DSGVO) und leitet Anfragen Betroffener, die ihn erreichen, unverzüglich an den Verantwortlichen weiter.</li>
<li><strong>Weitere Pflichten:</strong> Er unterstützt den Verantwortlichen bei den Pflichten nach Art. 32 bis 36 DSGVO (Sicherheit, Meldung von Verletzungen, Datenschutz-Folgenabschätzung, vorherige Konsultation).</li>
<li><strong>Verletzungen des Schutzes personenbezogener Daten</strong> meldet er unverzüglich, spätestens innerhalb von 24 Stunden nach Kenntnis, an die E-Mail-Adressen der Admins des Verantwortlichen, mit den Angaben, die der Verantwortliche für seine Meldung nach Art. 33 DSGVO braucht.</li>
<li>Er führt das Verzeichnis der Verarbeitungstätigkeiten nach Art. 30 Abs. 2 DSGVO.</li>
<li><strong>Datenschutzbeauftragter</strong> des Auftragsverarbeiters: ${ds.beauftragter.name ? `${e(ds.beauftragter.name)}${ds.beauftragter.email ? `, ${mailLink(ds.beauftragter.email)}` : ''}` : 'nicht benannt'}.</li>
</ol>

<h2>§ 5 Unterauftragsverarbeiter</h2>
<ol>
<li>Der Verantwortliche genehmigt den Einsatz der in <strong>Anlage 2</strong> genannten Unterauftragsverarbeiter.</li>
<li>Über beabsichtigte Änderungen (Hinzuziehen oder Ersetzen) informiert der Auftragsverarbeiter die Admins des Verantwortlichen mindestens 30 Tage vorher in Textform. Der Verantwortliche kann aus wichtigem Grund widersprechen. Widerspricht er nicht, gilt die Änderung als genehmigt; einigen sich die Parteien nach einem Widerspruch nicht, kann der Verantwortliche diesen Vertrag fristlos kündigen.</li>
<li>Der Auftragsverarbeiter erlegt jedem Unterauftragsverarbeiter vertraglich dieselben Datenschutzpflichten auf, die dieser Vertrag ihm auferlegt, und haftet gegenüber dem Verantwortlichen für deren Einhaltung.</li>
<li>Eine Verarbeitung außerhalb der EU und des EWR erfolgt nur unter den Voraussetzungen der Art. 44 ff. DSGVO.</li>
</ol>

<h2>§ 6 Nachweise und Kontrollen</h2>
<p>Der Auftragsverarbeiter stellt dem Verantwortlichen alle erforderlichen Informationen zum Nachweis der Einhaltung dieses Vertrags zur Verfügung (Beschreibung der Maßnahmen, Nachweise der Unterauftragsverarbeiter). Er ermöglicht Überprüfungen durch den Verantwortlichen oder einen von ihm beauftragten Prüfer nach Anmeldung mit mindestens 14 Tagen Vorlauf, soweit sie den Betrieb nicht unverhältnismäßig stören.</p>

<h2>§ 7 Löschung und Rückgabe</h2>
<ol>
<li>Der Verantwortliche kann Turniere und Teilnehmerdaten jederzeit selbst im Dienst löschen.</li>
<li>Nach Ende dieses Vertrags stellt der Auftragsverarbeiter dem Verantwortlichen auf Wunsch seine Turniere als Exportdatei bereit und löscht die Daten danach innerhalb von 30 Tagen. In Sicherungen enthaltene Daten werden mit dem regulären Ablauf spätestens nach ${e(sicherungTage)} Tagen gelöscht; bis dahin bleiben sie verschlüsselt und werden nicht verwendet.</li>
<li>Gesetzliche Aufbewahrungspflichten (z. B. für Rechnungen) bleiben unberührt.</li>
</ol>

<h2>§ 8 Haftung und Schlussbestimmungen</h2>
<ol>
<li>Für Schäden, die Betroffene wegen einer Verarbeitung erleiden, gilt Art. 82 DSGVO. Im Innenverhältnis haften die Parteien nach den gesetzlichen Vorschriften.</li>
<li>Der Vertrag kommt zustande, indem eine zur Vertretung des Verantwortlichen berechtigte Person ihn in Hajime Pro annimmt. Der Auftragsverarbeiter speichert den angenommenen Text mit Name und Funktion der annehmenden Person und dem Zeitpunkt; die Admins des Verantwortlichen können ihn jederzeit abrufen und ausdrucken.</li>
<li>Änderungen bedürfen der Textform. Eine neue Fassung dieses Vertrags gilt, sobald der Verantwortliche sie angenommen hat.</li>
<li>Es gilt deutsches Recht. Sollte eine Bestimmung unwirksam sein, bleibt der Vertrag im Übrigen wirksam.</li>
</ol>

<h2>Anlage 1: Technische und organisatorische Maßnahmen</h2>
<ul>
<li><strong>Zugang und Zugriff:</strong> persönliche Konten mit Passwort (PBKDF2-HMAC-SHA512, 210.000 Durchläufe, Salz je Passwort, mindestens 8 Zeichen), Zwei-Faktor-Anmeldung für die Administratoren der Plattform, Ratenbegrenzung gegen das Raten von Passwörtern, sperrbare Konten; Rollen je Verein (Admin, Benutzer, Helfer), serverseitig bei jeder Anfrage geprüft; neue Mitglieder schalten die Admins des Vereins frei.</li>
<li><strong>Trennung:</strong> Die Daten jedes Vereins sind über die Vereinszuordnung logisch getrennt; Admins sehen nur die Daten ihres Vereins.</li>
<li><strong>Verschlüsselung:</strong> Übertragung ausschließlich per HTTPS (TLS); Sicherungen mit AES-256-GCM; IBAN in der Datenbank feldverschlüsselt (AES-256-GCM), in Oberfläche und Protokollen nur maskiert.</li>
<li><strong>Datenminimierung und Pseudonymisierung:</strong> nur das Geburtsjahr statt des Geburtsdatums, kein Foto; die Teilnehmer-App zeigt weder Judopass-Nummer noch genaues Gewicht und arbeitet mit gesalzenen Personenschlüsseln; keine Cookies, kein Tracking, keine eingebundenen Drittanbieter.</li>
<li><strong>Eingabekontrolle:</strong> Aktionsprotokoll für jede schreibende Aktion und jede Anmeldung (wer, wann, was).</li>
<li><strong>Verfügbarkeit:</strong> tägliche verschlüsselte Sicherung mit Prüfung, Wiederherstellung als Ganzes, Überwachung und automatischer Neustart des Dienstes.</li>
<li><strong>Löschfristen:</strong> automatische Löschung von Live-Daten der Teilnehmer-App, Push-Anmeldungen, unbestätigten Konten, alten Nachrichten und Protokollen nach den in der Datenschutzerklärung genannten Fristen.</li>
<li><strong>Organisation:</strong> Verpflichtung auf Vertraulichkeit, Verträge zur Auftragsverarbeitung mit allen Unterauftragsverarbeitern, Updates erst nach automatisierten Tests.</li>
</ul>

<h2>Anlage 2: Unterauftragsverarbeiter</h2>
<table>
<thead><tr><th>Unternehmen</th><th>Leistung</th><th>Daten</th><th>Standort</th><th>Grundlage Drittland</th></tr></thead>
<tbody>
${unterauftrag}
</tbody>
</table>`;
}

function annahmeBlock(a) {
    return `
<h2>Annahme</h2>
<p>Angenommen für <strong>${e(a.verein_name)}</strong> am ${e(zeitpunkt(a.angenommen_am))} Uhr durch ${e(a.name)} (${e(a.funktion)}${a.email ? `, ${e(a.email)}` : ''}) in Hajime Pro.</p>`;
}

async function letzteAnnahme(knex, vereinId) {
    return knex('av_vertrag_annahmen').where({ verein_id: vereinId }).orderBy('angenommen_am', 'desc').orderBy('id', 'desc').first();
}

/** Ist der Vertrag in der aktuellen Fassung angenommen? (je Verein-ID: Datum der Annahme oder null) */
export async function ladeAnnahmenJeVerein(knex) {
    const zeilen = await knex('av_vertrag_annahmen').where({ fassung: AV_VERTRAG_FASSUNG }).groupBy('verein_id').select('verein_id').max('angenommen_am as am');
    return new Map(zeilen.map((z) => [z.verein_id, z.am]));
}

/**
 * Stand für den aktiven Verein des Kontos: angenommen (mit dem gespeicherten Text) oder offen (mit dem aktuellen Text).
 * Nur für Admins des Vereins (freigegebene Mitgliedschaft): der Nachweis enthält Name und E-Mail-Adresse der annehmenden Person,
 * und aktiver_verein_id kann auch auf einen noch nicht freigegebenen Beitritt zeigen. Alle anderen bekommen verein: null.
 * vollstaendig: false, solange Betreiberangaben fehlen.
 */
export async function ladeAvVertragStatus(knex, benutzerId, { rechtliches, env = process.env }) {
    const benutzer = await ladeBenutzerMitAktivemVerein(knex, benutzerId);
    if (!benutzer) throw new FachFehler(401, 'Nicht angemeldet.');
    const istAdmin = !!benutzer.verein_id && benutzer.verein_rolle === 'admin';
    const verein = istAdmin ? await knex('vereine').where({ id: benutzer.verein_id }).first('id', 'name') : null;
    if (!verein) return { aktiv: true, fassung: AV_VERTRAG_FASSUNG, verein: null };

    const annahme = await letzteAnnahme(knex, verein.id);
    const aktuell = annahme && annahme.fassung === AV_VERTRAG_FASSUNG ? annahme : null;
    const html = aktuell ? aktuell.text_html : rendereAvVertragText(rechtliches, { vereinName: verein.name, env });
    const hatTurnier = !!(await knex('turniere').where({ verein_id: verein.id }).first('id'));
    return {
        aktiv: true,
        fassung: AV_VERTRAG_FASSUNG,
        verein: { id: verein.id, name: verein.name },
        angenommen: aktuell ? { am: aktuell.angenommen_am, name: aktuell.name, funktion: aktuell.funktion, email: aktuell.email } : null,
        fruehereFassung: annahme && !aktuell ? { fassung: annahme.fassung, am: annahme.angenommen_am } : null,
        hatTurnier,
        darfAnnehmen: true,
        vollstaendig: !enthaeltLuecke(html),
        html
    };
}

function textFeld(wert, bezeichnung) {
    const t = typeof wert === 'string' ? wert.trim().replace(/\s+/g, ' ') : '';
    if (t.length < 2) throw new FachFehler(400, `Bitte ${bezeichnung} angeben.`);
    if (t.length > MAX_FELD) throw new FachFehler(400, `${bezeichnung} ist zu lang (höchstens ${MAX_FELD} Zeichen).`);
    return t;
}

/**
 * Nimmt den Vertrag für den aktiven Verein an (nur Admins). `fassung` muss die gezeigte Fassung sein, damit niemand
 * einen inzwischen geänderten Text unbesehen annimmt. Eine schon angenommene Fassung wird nicht doppelt gespeichert.
 */
export async function nimmAvVertragAn(knex, benutzerId, eingabe, { rechtliches, env = process.env }) {
    const { name, funktion, bestaetigt, fassung } = eingabe || {};
    if (bestaetigt !== true) throw new FachFehler(400, 'Bitte bestätigen Sie, dass Sie den Verein vertreten dürfen und den Vertrag annehmen.');
    if (fassung !== AV_VERTRAG_FASSUNG) throw new FachFehler(409, 'Der Vertragstext wurde inzwischen geändert. Bitte die Seite neu laden und den aktuellen Text lesen.', { code: 'fassung_veraltet' });
    const annehmer = textFeld(name, 'Ihren Namen');
    const rolle = textFeld(funktion, 'Ihre Funktion im Verein');

    const benutzer = await ladeBenutzerMitAktivemVerein(knex, benutzerId);
    if (!benutzer || !benutzer.verein_id) throw new FachFehler(400, 'Bitte zuerst einen aktiven Verein wählen.');
    if (benutzer.verein_rolle !== 'admin') throw new FachFehler(403, 'Den Vertrag nimmt ein Admin des Vereins an.');
    const verein = await knex('vereine').where({ id: benutzer.verein_id }).first('id', 'name');
    if (!verein) throw new FachFehler(404, 'Verein nicht gefunden.');

    const vorhanden = await letzteAnnahme(knex, verein.id);
    if (vorhanden && vorhanden.fassung === AV_VERTRAG_FASSUNG) return { bereits: true, angenommen_am: vorhanden.angenommen_am };

    const text = rendereAvVertragText(rechtliches, { vereinName: verein.name, env });
    if (enthaeltLuecke(text)) throw new FachFehler(409, 'Die Angaben des Betreibers sind noch unvollständig. Der Vertrag kann erst angenommen werden, wenn sie ergänzt sind.', { code: 'angaben_fehlen' });

    const annahme = { verein_name: verein.name, name: annehmer, funktion: rolle, email: benutzer.email || '', angenommen_am: new Date() };
    const textHtml = text + annahmeBlock(annahme);
    await knex('av_vertrag_annahmen').insert({
        verein_id: verein.id,
        fassung: AV_VERTRAG_FASSUNG,
        benutzer_id: benutzer.id,
        ...annahme,
        text_html: textHtml,
        text_sha256: sha256(textHtml)
    });
    return { bereits: false, angenommen_am: annahme.angenommen_am };
}

/** Vor dem Anlegen eines Turniers: ohne angenommenen Vertrag ein Fehler mit code av_vertrag_fehlt, sonst null. */
export async function pruefeAvVertragFuerTurnier(knex, vereinId) {
    const annahme = await knex('av_vertrag_annahmen').where({ verein_id: vereinId, fassung: AV_VERTRAG_FASSUNG }).first('id');
    if (annahme) return null;
    const verein = await knex('vereine').where({ id: vereinId }).first('name');
    return new FachFehler(403, `${verein ? verein.name : 'Der Verein'} hat den Vertrag zur Auftragsverarbeitung noch nicht angenommen. Ein Admin des Vereins nimmt ihn im Profil unter „Auftragsverarbeitung“ an; danach lassen sich Turniere anlegen.`, { code: 'av_vertrag_fehlt' });
}

