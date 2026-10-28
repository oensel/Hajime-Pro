// Impressum und Datenschutzerklärung als HTML (serverseitig erzeugt, ohne JavaScript lesbar). Die Texte beschreiben die Datenverarbeitung,
// die Hajime Pro tatsächlich ausführt (siehe docs/datenschutz/verarbeitungsverzeichnis.md); die Betreiberangaben kommen aus
// src/services/rechtliches.js. Fehlende Pflichtangaben erscheinen rot als „[ANGABE FEHLT: …]“, nie als stiller Leerraum.
// WICHTIG: Das sind Textbausteine nach bestem Wissen, keine Rechtsberatung. Vor dem Einsatz von einer fachkundigen Person prüfen lassen.

const ersetzt = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const e = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => ersetzt[z]);

export const fehlt = (beschreibung) => `<span class="fehlt">[ANGABE FEHLT: ${e(beschreibung)}]</span>`;
export const feld = (wert, beschreibung) => (wert ? e(wert) : fehlt(beschreibung));
export const mailLink = (m) => (m ? `<a href="mailto:${e(m)}">${e(m)}</a>` : '');

export function datumDeutsch(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : new Date().toLocaleDateString('de-DE');
}

// Natürliche Personen mit Vor- und Nachnamen, alle anderen mit Name und Rechtsform (z. B. „JC Beispiel e. V.“)
export function anzeigeName(b) {
    return b.art === 'privatperson' || b.art === 'einzelunternehmen'
        ? [b.vorname, b.name].filter(Boolean).join(' ')
        : [b.name, b.rechtsform].filter(Boolean).join(' ');
}

export function anschriftBlock(b) {
    return [
        `<strong>${feld(anzeigeName(b), 'Name bzw. Firma')}</strong>`,
        b.zusatz ? e(b.zusatz) : '',
        feld(b.strasse, 'Straße und Hausnummer'),
        `${feld(b.plz, 'PLZ')} ${feld(b.ort, 'Ort')}`,
        e(b.land || 'Deutschland')
    ].filter(Boolean).join('<br>');
}

const SEITEN_CSS = `
:root { color-scheme: light dark; --bg: #fcf9f2; --card: #ffffff; --text: #1e293b; --muted: #64748b; --rand: #d9d4c7; --link: #1e3a8a; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0f19; --card: #111827; --text: #f3f4f6; --muted: #9ca3af; --rand: #1f2937; --link: #93c5fd; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
nav { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 14px 16px; border-bottom: 2px solid var(--rand); background: var(--card); font-size: 14px; font-weight: 600; }
nav a { color: var(--link); text-decoration: none; }
nav a:hover, nav a[aria-current] { text-decoration: underline; }
article { background: var(--card); border: 2px solid var(--rand); border-radius: 8px; padding: 22px 26px; }
h1 { margin: 0 0 6px; font-size: 28px; } h2 { margin: 28px 0 6px; font-size: 19px; } h3 { margin: 18px 0 4px; font-size: 16px; }
p, li { margin: 6px 0; } ul { padding-left: 22px; } a { color: var(--link); }
.stand { color: var(--muted); font-size: 14px; }
.fehlt { background: #fee2e2; color: #991b1b; font-weight: 700; padding: 0 4px; border-radius: 3px; }
.kasten { border: 2px solid var(--link); border-radius: 6px; padding: 4px 16px 10px; margin: 24px 0 0; } .kasten h2 { margin-top: 12px; }
.warnung { background: #fef3c7; color: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 10px 14px; margin: 0 0 16px; font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rand); vertical-align: top; } th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
`;

export function seite({ titel, aktiv, inhalt, rechtliches }) {
    const unvollstaendig = !rechtliches.vollstaendig;
    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index,follow">
<title>${e(titel)} – Hajime Pro</title>
<style>${SEITEN_CSS}</style>
</head>
<body>
<nav aria-label="Rechtliches">
<a href="/impressum.html"${aktiv === 'impressum' ? ' aria-current="page"' : ''}>Impressum</a>
<a href="/datenschutz.html"${aktiv === 'datenschutz' ? ' aria-current="page"' : ''}>Datenschutzerklärung</a>
${aktiv === 'av-vertrag' ? '<a href="/av-vertrag.html" aria-current="page">Auftragsverarbeitung</a>' : ''}
<a href="/">Zur Anwendung</a>
</nav>
<main>
${unvollstaendig ? `<p class="warnung" role="alert"><strong>Achtung, unvollständige Angaben:</strong> Der Betreiber hat nicht alle Pflichtangaben hinterlegt. Die rot markierten Stellen müssen ergänzt werden (Datei <code>${e(process.env.RECHTLICHES_DATEI || 'data/rechtliches.json')}</code>), bevor diese Seite veröffentlicht wird.</p>` : ''}
<article>
${inhalt}
</article>
</main>
</body>
</html>`;
}

// ------------------------------------------------------------------------------------------------------------------------------
export function rendereImpressum(rechtliches) {
    const { daten } = rechtliches;
    const b = daten.betreiber;
    const kontakt = [
        `E-Mail: ${b.email ? mailLink(b.email) : fehlt('E-Mail-Adresse')}`,
        b.telefon ? `Telefon: ${e(b.telefon)}` : '',
        b.kontaktformularUrl ? `Kontaktformular: <a href="${e(b.kontaktformularUrl)}" rel="noopener">${e(b.kontaktformularUrl)}</a>` : '',
        !b.telefon && !b.kontaktformularUrl ? fehlt('zweiter Kontaktweg (Telefonnummer oder Kontaktformular)') : ''
    ].filter(Boolean).join('<br>');

    const inhalt = `
<h1>Impressum</h1>
<p class="stand">Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>

<h2>Anbieter</h2>
<p>${anschriftBlock(b)}</p>
${['verein', 'gbr', 'ug', 'gmbh', 'sonstige'].includes(b.art) ? `<p><strong>Vertreten durch:</strong> ${feld(b.vertretung, 'Vertretungsberechtigte')}</p>` : ''}

<h2>Kontakt</h2>
<p>${kontakt}</p>

${(b.registergericht || b.registernummer || (['verein', 'ug', 'gmbh'].includes(b.art) && !b.ohneRegister)) ? `<h2>Registereintrag</h2>
<p>Eintragung im ${b.art === 'verein' ? 'Vereinsregister' : 'Handelsregister'}.<br>Registergericht: ${feld(b.registergericht, 'Registergericht')}<br>Registernummer: ${feld(b.registernummer, 'Registernummer')}</p>` : ''}

${b.umsatzsteuerId ? `<h2>Umsatzsteuer-ID</h2><p>Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz: ${e(b.umsatzsteuerId)}</p>` : ''}
${b.wirtschaftsId ? `<h2>Wirtschafts-Identifikationsnummer</h2><p>${e(b.wirtschaftsId)}</p>` : ''}

${(daten.redaktionell.name || daten.redaktionell.anschrift) ? `<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2><p>${e(daten.redaktionell.name)}<br>${e(daten.redaktionell.anschrift)}</p>` : ''}

${daten.verbraucherstreit === 'bereit' ? `<h2>Verbraucherstreitbeilegung</h2><p>Wir sind bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>` : ''}
${daten.verbraucherstreit === 'nicht-bereit' ? `<h2>Verbraucherstreitbeilegung</h2><p>Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>` : ''}

<h2>Hinweis zum Angebot</h2>
<p>Hajime Pro ist eine Software zur Organisation von Judo-Turnieren (Anmeldung, Auslosung, Wettkampfablauf, Ergebnislisten). Für die Inhalte der einzelnen Turniere (Ausschreibung, Teilnehmer- und Ergebnisdaten) ist der jeweilige Veranstalter verantwortlich.</p>

<p class="stand">Stand: ${e(daten.stand ? datumDeutsch(daten.stand) : datumDeutsch())}</p>`;
    return seite({ titel: 'Impressum', aktiv: 'impressum', inhalt, rechtliches });
}

// ------------------------------------------------------------------------------------------------------------------------------
// Laufzeit des Sitzungs-Tokens aus JWT_EXPIRES_IN (Schreibweise von jsonwebtoken: „24h“, „7d“, „90m“) als Text; Unbekanntes bleibt wörtlich.
function dauerText(wert) {
    const m = /^(\d+)\s*(m|min|h|d)$/i.exec(String(wert || '').trim());
    if (!m) return String(wert || '');
    const n = Number(m[1]);
    const [eins, mehr] = { m: ['Minute', 'Minuten'], min: ['Minute', 'Minuten'], h: ['Stunde', 'Stunden'], d: ['Tag', 'Tage'] }[m[2].toLowerCase()];
    return `${n} ${n === 1 ? eins : mehr}`;
}

// Fristen wie im Programm: ungültige oder fehlende Werte fallen auf den Standard zurück (gleiche Regel wie `Number(env.X) || standard`).
export const tageAus = (wert, standard) => (Number(wert) > 0 ? Number(wert) : standard);

// Querverweise zwischen den Abschnitten: die Nummern ergeben sich erst, wenn feststeht, welche Abschnitte erscheinen.
const verweis = (id) => `{{abschnitt:${id}}}`;

export function rendereDatenschutz(rechtliches, env = process.env) {
    const { daten } = rechtliches;
    const b = daten.betreiber;
    const ds = daten.datenschutz;
    const app = daten.teilnehmerApp.aktiv;
    const protokollTage = tageAus(env.PROTOKOLL_AUFBEWAHRUNG_TAGE, 365);
    const fehlerTage = tageAus(env.FEHLER_AUFBEWAHRUNG_TAGE, 30);
    const liveTage = tageAus(env.LIVE_AUFBEWAHRUNG_TAGE, 7);
    const pushTage = tageAus(env.LIVE_PUSH_AUFBEWAHRUNG_TAGE, 3);
    const unbestaetigtTage = tageAus(env.UNBESTAETIGT_TAGE, 30);
    const nachrichtenTage = tageAus(env.NACHRICHTEN_AUFBEWAHRUNG_TAGE, 365);
    const sicherungTage = tageAus(daten.backup.aufbewahrungTage, 60);
    const sitzung = dauerText(env.JWT_EXPIRES_IN || '24h');
    const dsMail = ds.email ? mailLink(ds.email) : fehlt('E-Mail-Adresse für Datenschutzanfragen');

    const dienstleister = [
        `<li><strong>Hosting (Server):</strong> ${feld(daten.hosting.anbieter, 'Hosting-Anbieter')}${daten.hosting.standort ? `, Standort ${e(daten.hosting.standort)}` : ''}. Der Anbieter verarbeitet Daten in unserem Auftrag auf Grundlage eines Vertrags zur Auftragsverarbeitung (Art. 28 DSGVO).</li>`,
        `<li><strong>Datenbank:</strong> ${feld(daten.datenbank.anbieter, 'Datenbank-Anbieter')}${daten.datenbank.region ? `, Rechenzentrum ${e(daten.datenbank.region)}` : ''}. Auftragsverarbeitung nach Art. 28 DSGVO.</li>`,
        `<li><strong>E-Mail-Versand:</strong> ${feld(daten.mail.anbieter, 'E-Mail-Anbieter')} (Versand von Bestätigungs-, Einladungs-, Benachrichtigungs- und Erinnerungs-E-Mails). Auftragsverarbeitung nach Art. 28 DSGVO.</li>`,
        daten.backup.aktiv ? `<li><strong>Sicherungskopie:</strong> ${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}. Die Sicherungsdateien werden <em>vor</em> der Übertragung mit AES-256 verschlüsselt; der Anbieter kann den Inhalt nicht lesen.</li>` : ''
    ].filter(Boolean).join('\n');

    // Art. 13 Abs. 1 lit. f DSGVO: je Übermittlung die Garantie, auf der sie beruht
    const garantieFehlt = 'Grundlage der Drittlandübermittlung';
    const drittland = [
        daten.datenbank.drittland ? `<li><strong>Datenbank</strong> (${feld(daten.datenbank.anbieter, 'Datenbank-Anbieter')}): ${feld(daten.datenbank.garantie, garantieFehlt)}.</li>` : '',
        daten.backup.aktiv && daten.backup.drittland ? `<li><strong>Sicherungskopie</strong> (${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}): ${feld(daten.backup.garantie, garantieFehlt)}. Übertragen werden nur verschlüsselte Sicherungsdateien.</li>` : '',
        app ? `<li><strong>Push-Dienste der Browserhersteller</strong> (${verweis('app')}): Die Hersteller (z. B. Google, Apple, Mozilla) können die Benachrichtigungen auch in den USA verarbeiten. Das geschieht nur, wenn Sie Benachrichtigungen selbst einschalten; soweit für den Hersteller kein Angemessenheitsbeschluss gilt, beruht die Übermittlung auf Ihrer ausdrücklichen Einwilligung (Art. 49 Abs. 1 lit. a DSGVO). Dort haben Behörden unter Umständen Zugriff auf Gerätedaten, ohne dass Ihnen dieselben Rechtsbehelfe wie in der EU zustehen. Der Inhalt der Benachrichtigung wird verschlüsselt übertragen und ist für den Push-Dienst nicht lesbar.</li>` : ''
    ].filter(Boolean);

    const abschnitte = [
        { id: 'verantwortlicher', titel: 'Verantwortlicher und Rollen', html: `
<p><strong>Verantwortlicher</strong> im Sinne der Datenschutz-Grundverordnung (DSGVO) für Benutzerkonten, Anmeldung, Kontaktanfragen, Nachrichten und den Betrieb der Plattform ist:</p>
<p>${anschriftBlock(b)}<br>E-Mail: ${b.email ? mailLink(b.email) : fehlt('E-Mail-Adresse')}${b.telefon ? `<br>Telefon: ${e(b.telefon)}` : ''}</p>
<p>Datenschutzanfragen richten Sie bitte an ${dsMail}.${ds.beauftragter.name ? ` Unser Datenschutzbeauftragter ist ${e(ds.beauftragter.name)}${ds.beauftragter.email ? `, ${mailLink(ds.beauftragter.email)}` : ''}.` : ''}</p>
<p><strong>Turnierdaten:</strong> Hajime Pro wird von Judo-Vereinen genutzt, um Turniere zu organisieren. Für die Daten der <em>Teilnehmenden, Helfenden und Kampfrichter eines Turniers</em> ist der jeweilige <strong>Veranstalter</strong> (der Verein, der das Turnier ausrichtet) verantwortlich. ${e(anzeigeName(b) || 'Der Betreiber')} verarbeitet diese Daten als <strong>Auftragsverarbeiter</strong> nach Art. 28 DSGVO ausschließlich auf Weisung des Veranstalters. Meldet ein Verein Teilnehmende zu einem Turnier eines anderen Vereins, übermittelt er die Daten seiner Mitglieder in eigener Verantwortung an den Veranstalter. Betroffene wenden sich für Auskunft, Berichtigung und Löschung dieser Daten bitte zuerst an den Veranstalter des Turniers.</p>` },

        { id: 'zugriff', titel: 'Aufruf der Website, Server-Protokolle', html: `
<p>Beim Aufruf unserer Seiten verarbeitet der Server technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge und Browserkennung. Das ist zur Auslieferung der Seiten und zur Abwehr von Angriffen erforderlich (Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an einem sicheren und stabilen Betrieb). Diese Server-Protokolle werden nach ${e(ds.logfileTage)} Tagen gelöscht.</p>` },

        { id: 'konto', titel: 'Registrierung und Benutzerkonto', html: `
<p><strong>Daten:</strong> Vorname, Nachname, E-Mail-Adresse, Passwort (nur als nicht umkehrbarer Prüfwert gespeichert), gewählter Verein, Rolle im Verein (Admin, Benutzer, Helfer), Zeitpunkte von Registrierung und Bestätigung.</p>
<p><strong>Zweck und Rechtsgrundlage:</strong> Bereitstellung des Kontos und der Funktionen der Plattform (Art. 6 Abs. 1 lit. b DSGVO). Zur Bestätigung Ihrer E-Mail-Adresse senden wir einen Link (Double-Opt-in); nach der Bestätigung erhalten die Administratoren des gewählten Vereins eine E-Mail mit Ihrem Namen und Ihrer Adresse, um Sie freizuschalten.</p>
<p><strong>Speicherdauer:</strong> bis zur Löschung des Kontos. Konten, deren E-Mail-Adresse nicht bestätigt wird, werden nach ${e(unbestaetigtTage)} Tagen automatisch gelöscht.</p>
<p><strong>Vertrag zur Auftragsverarbeitung:</strong> Nimmt ein Admin für seinen Verein den Vertrag zur Auftragsverarbeitung an, speichern wir den angenommenen Text mit Name, Funktion und E-Mail-Adresse der annehmenden Person und dem Zeitpunkt. Zweck und Rechtsgrundlage: Nachweis des Vertragsschlusses (Art. 28 Abs. 9 und Art. 5 Abs. 2 DSGVO, Art. 6 Abs. 1 lit. c und f DSGVO). Speicherdauer: solange der Verein in Hajime Pro besteht; mit dem Löschen des Kontos bleibt der Nachweis erhalten.</p>` },

        { id: 'sicherheit', titel: 'Anmeldung, Sicherheit und Protokollierung', html: `
<ul>
<li><strong>Anmeldung:</strong> Nach der Anmeldung erhalten Sie ein befristetes Sitzungs-Token (${e(sitzung)}), das in Ihrem Browser gespeichert wird (siehe ${verweis('speicher')}). Administratoren der Plattform (Super-Admins) melden sich zusätzlich mit einem zweiten Faktor (Authenticator-App) an.</li>
<li><strong>Aktionsprotokoll:</strong> Zur Nachvollziehbarkeit und IT-Sicherheit protokollieren wir, welches Konto wann welche ändernde Aktion ausgeführt hat (z. B. Turnier angelegt, Rolle geändert) sowie Anmeldeereignisse einschließlich der IP-Adresse (erfolgreiche und fehlgeschlagene Anmeldungen). Eingegebene Inhalte und Passwörter werden nicht protokolliert. Die Administratoren eines Vereins sehen die Einträge ihres Vereins. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Sicherheit, Missbrauchsabwehr, Nachweis). Speicherdauer: ${e(protokollTage)} Tage.</li>
<li><strong>Fehlerprotokoll:</strong> Technische Fehler des Servers und der Seiten im Browser werden zur Störungsbeseitigung festgehalten (Fehlermeldung, aufgerufene Seite, bei angemeldeten Konten die E-Mail-Adresse). Zugangsdaten werden dabei geschwärzt. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Speicherdauer: ${e(fehlerTage)} Tage.</li>
<li><strong>Ratenbegrenzung:</strong> Zum Schutz vor Missbrauch (z. B. massenhafte Anmeldeversuche oder Kontaktanfragen) zählt der Server Anfragen je IP-Adresse im Arbeitsspeicher; die Zähler werden nach wenigen Minuten verworfen.</li>
</ul>` },

        { id: 'turnier', titel: 'Turnierverwaltung (im Auftrag des Veranstalters)', html: `
<p><strong>Daten der Teilnehmenden:</strong> Judopass-Nummer, Vorname, Nachname, Geburtsjahr, Geschlecht, Verein, Gewicht (Wiegeergebnis), Alters- und Gewichtsklasse, Graduierung, Lizenzablauf, Anmeldestatus sowie Kampfergebnisse und Platzierungen. Betroffen sind auch <strong>Minderjährige</strong>.</p>
<p><strong>Zweck:</strong> Anmeldung, Einwiegen, Auslosung, Zeit- und Mattenplanung, Durchführung des Wettkampfs, Ergebnislisten, Siegerehrung und Urkunden. <strong>Rechtsgrundlage</strong> (durch den Veranstalter): Durchführung der Teilnahme bzw. Mitgliedschaft (Art. 6 Abs. 1 lit. b DSGVO) und berechtigtes Interesse an der ordnungsgemäßen Durchführung und Dokumentation des Wettkampfs (Art. 6 Abs. 1 lit. f DSGVO)${app ? `; für darüber hinausgehende Veröffentlichungen gilt ${verweis('app')}` : ''}.</p>
<p><strong>Helfende und Orga:</strong> Für den Helferplan und die Vorbereitung eines Turniers werden Namen, E-Mail-Adressen, Einsatzzeiten und Aufgaben verarbeitet. Wer keine Mail-Adresse bekommen soll, wird nur mit dem Namen geführt.</p>
<p><strong>Speicherdauer:</strong> Die Daten bleiben gespeichert, bis der Veranstalter das Turnier löscht oder die Löschung verlangt. Danach verbleiben sie nur noch in den Sicherungskopien (${verweis('sicherung')}) bis zu deren Ablauf.</p>` },

        { id: 'startgeld', titel: 'Startgeld-Abrechnung (im Auftrag des Veranstalters)', html: `
<p>Erhebt der Veranstalter ein Startgeld, kann er es über die Plattform abrechnen. Verarbeitet werden: die <strong>Rechnungsdaten der meldenden Vereine</strong> (Vereinsname, Ansprechperson, E-Mail-Adresse, Anschrift, gewählter Zahlweg Überweisung oder Bar), die Zahl der gemeldeten Kämpfer und der Betrag, die Barzahlungen an der Waage (Verein, Betrag, Zeitpunkt) sowie die Bankverbindung des Veranstalters (Kontoinhaber und IBAN des Empfängerkontos). Die IBAN des Veranstalters wird in der Datenbank <strong>verschlüsselt</strong> gespeichert und in Protokollen geschwärzt; auf einer Rechnung erscheint sie notwendigerweise im Klartext, weil Zahlende sie dort ablesen müssen.</p>
<p>Rechnungen und Quittungen werden als PDF erzeugt, unveränderlich festgehalten und <strong>per E-Mail</strong> an die hinterlegte Rechnungsadresse des Vereins versandt. Zweck und Rechtsgrundlage: Abwicklung der Teilnahme und Erfüllung steuer- und handelsrechtlicher Pflichten des Veranstalters (Art. 6 Abs. 1 lit. b und c DSGVO). Rechnungen und Quittungen unterliegen gesetzlichen Aufbewahrungspflichten und werden <strong>acht Jahre</strong> aufbewahrt (ab Ende des Kalenderjahres der Ausstellung); sie verbleiben auch nach dem Löschen des Turniers erhalten. Das Journal der Barzahlungen wird mit dem Turnier gelöscht. Verantwortlich ist der Veranstalter; wir verarbeiten die Daten als Auftragsverarbeiter.</p>` },

        { id: 'lastschrift', titel: 'SEPA-Lastschrift (im Auftrag des Veranstalters)', html: `
<p>Bietet der Veranstalter den Einzug des Startgelds per SEPA-Lastschrift an, erteilt der meldende Verein dafür ein <strong>SEPA-Lastschriftmandat</strong> (Einmal-Mandat je Turnier). Verarbeitet werden: Kontoinhaber und IBAN des zu belastenden Kontos, Mandatsreferenz, der Wortlaut des Mandats in der erteilten Fassung, die Bestätigung der Vertretungsberechtigung sowie als <strong>Nachweis</strong> Zeitstempel, Benutzerkonto und IP-Adresse der Erteilung bzw. Bestätigung. Kontoinhaber und IBAN werden in der Datenbank <strong>verschlüsselt</strong> gespeichert und in Protokollen und Oberflächen nur maskiert angezeigt. Erteilt eine nicht vertretungsberechtigte Person das Mandat, erhalten die Administratoren des Vereins einen Bestätigungslink per E-Mail.</p>
<p>Zum Einzug erzeugt der Veranstalter eine <strong>Sammeldatei im Format pain.008</strong>, die Kontoinhaber, IBAN, Betrag und Verwendungszweck enthält, und reicht sie bei seiner Bank ein; damit wird die Bankverbindung an die Bank des Veranstalters weitergegeben. Die Datei selbst wird bei uns nicht gespeichert, nur ihre Kopfdaten (Erzeugungszeitpunkt, Anzahl, Summe, Fälligkeit). Zweck und Rechtsgrundlage: Durchführung des Zahlungsverkehrs und Nachweis des Mandats (Art. 6 Abs. 1 lit. b und f DSGVO).</p>
<p><strong>Löschung:</strong> Die Daten des Mandats (IBAN und Kontoinhaber) werden <strong>14 Monate nach dem letzten Einzug</strong> gelöscht; wurde nie eingezogen (Widerruf, Ablehnung, Umstellung auf Barzahlung), 14 Monate nach der Entscheidung. Bei Widerruf, Ablehnung oder Umstellung wird die IBAN sofort gelöscht, der Nachweisdatensatz bleibt bis zur Löschfrist. Auf einer Rechnung verbleiben nur die Mandatsreferenz und die maskierte IBAN.</p>` },

        app && { id: 'app', titel: 'Teilnehmer-App und öffentliche Anzeige', html: `
<p>Wenn der Veranstalter die Live-Anzeige für ein Turnier freigibt, werden Daten des Turniers an unseren Server übertragen und können in der <strong>Teilnehmer-App</strong> abgerufen werden. Die App öffnet sich nur über einen <strong>QR-Code, den der Veranstalter in der Halle aushängt</strong>; er enthält einen zufälligen Zugangscode, der nur für dieses Turnier gilt und mit dem Ende des Turniertags (6 Uhr am Folgetag) abläuft. Der Veranstalter kann den Code jederzeit erneuern oder sperren. Es gibt keine öffentliche Turnierliste und keine Suche ohne diesen Code; der Code steht in der Adresse hinter dem „#“ und gelangt dadurch nicht in unsere Server-Protokolle. Wer den Code erhält (z. B. durch ein weitergegebenes Foto des Aushangs), kann die Daten bis zum Ablauf einsehen. Innerhalb der App können die Daten durchsucht werden. Angezeigt werden: Vorname und Nachname, Verein, Altersklasse, Gewichtsklasse, Geschlecht, Pool und Matte, Kampfstand (anstehend, aktuell, beendet), Kampfergebnisse und Platzierung. Die Judopass-Nummer und das genaue Gewicht werden <strong>nicht</strong> veröffentlicht.</p>
<p><strong>Rechtsgrundlage:</strong> Der Veranstalter entscheidet über die Freigabe und ist dafür verantwortlich, die Teilnehmenden (bei Minderjährigen die Erziehungsberechtigten) vorher zu informieren und, wo erforderlich, ihre Einwilligung einzuholen (Art. 6 Abs. 1 lit. a oder lit. f DSGVO). Die Teilnehmenden können der Veröffentlichung gegenüber dem Veranstalter widersprechen.</p>
<p><strong>Speicherdauer:</strong> Die Live-Daten werden ${e(liveTage)} Tage nach dem Turnier gelöscht.</p>
<p><strong>Auf Ihrem Gerät</strong> speichert die App Ihre Auswahl (z. B. gemerkte Kämpfer und Vereine) und Zwischenspeicher der Anzeige im lokalen Speicher des Browsers. Dazu gehört der Zugangscode aus dem QR-Code. Diese Daten verlassen Ihr Gerät nicht (der Code wird nur bei den Abfragen an unseren Server mitgeschickt) und lassen sich in den Browser-Einstellungen löschen.</p>
<p><strong>Benachrichtigungen (Web-Push):</strong> Wenn Sie in der App Benachrichtigungen einschalten, fragt Ihr Browser nach Ihrer Erlaubnis (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Wir speichern dafür die Adresse Ihres Geräts beim Push-Dienst Ihres Browser-Herstellers und die technischen Schlüssel, außerdem, für welche Kämpfer Sie Benachrichtigungen wünschen. Die Mitteilungen laufen über den Push-Dienst des Herstellers Ihres Browsers (z. B. Google, Mozilla, Apple), der dadurch Kenntnis von Ihrem Gerät und dem Zeitpunkt erhält (zur Übermittlung in Drittländer siehe ${verweis('empfaenger')}). Die Daten werden spätestens ${e(pushTage)} Tage nach dem Turnier gelöscht; Sie können die Benachrichtigungen jederzeit in der App oder im Browser ausschalten (Widerruf).</p>` },

        { id: 'kontakt', titel: 'Kontaktformular und Nachrichten', html: `
<p><strong>Kontaktformular und Vereinsanfrage (ohne Konto):</strong> Wenn Sie uns über das Kontaktformular schreiben oder einen fehlenden Verein melden, verarbeiten wir Ihren Namen, Ihre E-Mail-Adresse, Betreff und Text der Nachricht bzw. den gewünschten Vereinsnamen. Die Nachricht erreicht die Administratoren der Plattform (Super-Admins), die per E-Mail einen Hinweis darauf erhalten; unsere Antwort senden wir an die angegebene E-Mail-Adresse.</p>
<p><strong>Nachrichten innerhalb der Plattform:</strong> Angemeldete Konten können Nachrichten schreiben: Benutzer und Helfer an die Administratoren der Plattform, Vereinsadministratoren außerdem an Mitglieder des eigenen Vereins und an Administratoren anderer Vereine. Gespeichert werden Betreff, Text, Name des Absenders, Empfänger, Zeitpunkte und bis zu welcher Nachricht ein Empfänger gelesen hat. Empfänger erhalten eine Benachrichtigung per E-Mail ohne den Inhalt der Nachricht.</p>
<p><strong>Zweck und Rechtsgrundlage:</strong> Bearbeitung Ihrer Anfrage und Kommunikation im Rahmen der Nutzung der Plattform (Art. 6 Abs. 1 lit. b DSGVO, soweit es um Ihr Konto, Ihren Verein oder ein Turnier geht; im Übrigen Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an der Beantwortung von Anfragen).</p>
<p><strong>Speicherdauer:</strong> Eine Unterhaltung wird ${e(nachrichtenTage)} Tage nach der letzten Nachricht automatisch gelöscht. Wird das Konto einer beteiligten Person gelöscht, bleiben ihre bereits geschriebenen Nachrichten mit ihrem Namen bis zu dieser Frist in der Unterhaltung erhalten.</p>` },

        { id: 'mail', titel: 'E-Mail-Versand', html: `
<p>Wir versenden E-Mails zur Bestätigung Ihrer Adresse, zur Freischaltung, zum Zurücksetzen des Passworts, für Einladungen (z. B. zum Verein oder zu einem Turnier), als Hinweis auf neue Nachrichten und für Erinnerungen an Aufgaben, wenn Sie eine Aufgabe übernommen haben. Rechtsgrundlage ist die Erfüllung des Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO). Es erfolgt keine Werbung und kein Newsletter. Wer per Einladung hinzugefügt wird, erhält genau eine Einladungs-Mail; der Link verfällt nach 14 Tagen.</p>
<p><strong>Turnier teilen:</strong> Der Verwalter eines Turniers kann einen Link zum Turnier an E-Mail-Adressen schicken, die er selbst einträgt, und an die Administratoren ausgewählter Vereine. Die eingetragenen Adressen werden nur für diesen Versand verwendet und nicht gespeichert; festgehalten wird lediglich, welche Vereine eingeladen wurden. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse des Veranstalters, auf sein Turnier hinzuweisen).</p>` },

        { id: 'sicherung', titel: 'Datensicherung', html: `
<p>Zum Schutz vor Datenverlust sichern wir die gesamte Datenbank täglich (Art. 6 Abs. 1 lit. f DSGVO und Art. 32 DSGVO). Die Sicherungsdateien sind mit AES-256 verschlüsselt. Sie werden auf unserem Server und ${daten.backup.aktiv ? `zusätzlich bei ${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}` : 'ohne zusätzliche Kopie bei einem Dritten'} aufbewahrt und nach spätestens ${e(sicherungTage)} Tagen gelöscht. Daten, die Sie oder ein Veranstalter in der Plattform löschen, verschwinden aus den Sicherungen deshalb mit dieser Verzögerung.</p>` },

        { id: 'empfaenger', titel: 'Empfänger und Auftragsverarbeiter', html: `
<p>Wir setzen die folgenden Dienstleister ein, die Daten ausschließlich nach unserer Weisung verarbeiten. Mit allen besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO:</p>
<ul>
${dienstleister}
</ul>
<p>Innerhalb der Plattform erhalten Zugriff:</p>
<ul>
<li>Administratoren und Mitglieder eines Vereins im Rahmen ihrer Rolle auf die Daten ihres Vereins und der von ihm ausgerichteten Turniere, einschließlich der Meldungen anderer Vereine zu diesen Turnieren;</li>
<li>die Administratoren der Plattform (Super-Admins), soweit es für Betrieb, Störungsbeseitigung und Unterstützung erforderlich ist. Den Zugriff auf alle Daten haben sie nur in einem eigens eingeschalteten Super-Admin-Modus; ihre ändernden Aktionen werden protokolliert (${verweis('sicherheit')}).</li>
</ul>
<p>Eine Weitergabe an sonstige Dritte findet nicht statt, es sei denn, wir sind gesetzlich dazu verpflichtet.</p>
${drittland.length ? `<h3>Übermittlung in Drittländer</h3>
<p>Einzelne Empfänger haben ihren Sitz außerhalb der EU/des EWR (insbesondere in den USA) oder können Daten dort verarbeiten. Die Übermittlung beruht jeweils auf der folgenden Grundlage; eine Kopie der Standardvertragsklauseln erhalten Sie auf Anfrage unter ${dsMail}:</p>
<ul>
${drittland.join('\n')}
</ul>` : ''}` },

        { id: 'speicher', titel: 'Lokaler Speicher im Browser (keine Cookies)', html: `
<p>Hajime Pro setzt <strong>keine Cookies</strong> und verwendet keine Werbe- oder Analysedienste. Der Browser speichert lokal ausschließlich, was für den Betrieb notwendig ist: das Sitzungs-Token und die Kontoinformationen nach der Anmeldung (bis zur Abmeldung bzw. höchstens ${e(sitzung)} gültig), das zuletzt gewählte Turnier und die Matte, das Ziel eines geteilten Turnier-Links bis zur Anmeldung (höchstens 7 Tage), die gewählte Darstellung (hell oder dunkel) und den Zustand des Menüs${app ? `, außerdem die Daten der Teilnehmer-App nach ${verweis('app')}` : ''}. Dieser Zugriff ist unbedingt erforderlich, damit der von Ihnen gewünschte Dienst bereitgestellt werden kann (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist dafür nicht notwendig.</p>` },

        { id: 'dauer', titel: 'Speicherdauer im Überblick', html: `
<table>
<thead><tr><th>Daten</th><th>Speicherdauer</th></tr></thead>
<tbody>
<tr><td>Benutzerkonto</td><td>bis zur Löschung des Kontos; Konten ohne bestätigte E-Mail-Adresse werden nach ${e(unbestaetigtTage)} Tagen gelöscht</td></tr>
<tr><td>Turnier-, Teilnehmer- und Helferdaten</td><td>bis zur Löschung durch den Veranstalter, danach nur noch in Sicherungen (siehe unten)</td></tr>
${app ? `<tr><td>Live-Daten der Teilnehmer-App</td><td>${e(liveTage)} Tage nach dem Turnier</td></tr>` : ''}
<tr><td>SEPA-Lastschriftmandate (IBAN, Kontoinhaber, Nachweis)</td><td>14 Monate nach dem letzten Einzug bzw. nach der Entscheidung, wenn nie eingezogen wurde; bei Widerruf, Ablehnung und Umstellung wird die IBAN sofort gelöscht</td></tr>
<tr><td>Rechnungen und Quittungen</td><td>8 Jahre ab Ende des Kalenderjahres der Ausstellung (gesetzliche Aufbewahrungspflicht), unabhängig vom Turnier</td></tr>
<tr><td>Annahme des Vertrags zur Auftragsverarbeitung (Text, Name, Funktion, E-Mail-Adresse)</td><td>solange der Verein in Hajime Pro besteht</td></tr>
<tr><td>Kontaktanfragen und Nachrichten</td><td>${e(nachrichtenTage)} Tage nach der letzten Nachricht der Unterhaltung</td></tr>
${app ? `<tr><td>Push-Anmeldungen</td><td>spätestens ${e(pushTage)} Tage nach dem Turnier</td></tr>` : ''}
<tr><td>Aktionsprotokoll</td><td>${e(protokollTage)} Tage</td></tr>
<tr><td>Fehlerprotokoll</td><td>${e(fehlerTage)} Tage</td></tr>
<tr><td>Server-Protokolle des Hosters</td><td>${e(ds.logfileTage)} Tage</td></tr>
<tr><td>Sicherungskopien</td><td>höchstens ${e(sicherungTage)} Tage</td></tr>
</tbody>
</table>
<p>Gesetzliche Aufbewahrungspflichten bleiben unberührt.</p>` },

        { id: 'pflicht', titel: 'Pflicht zur Bereitstellung, automatisierte Entscheidungen', html: `
<p>Für die Nutzung der Plattform sind Name, E-Mail-Adresse und Passwort erforderlich; ohne diese Angaben ist kein Konto möglich. Für die Teilnahme an einem Turnier verlangt der Veranstalter die Angaben, die er für die Durchführung braucht. Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt. Die Auslosung der Kämpfe erfolgt nach den Regeln der Wettkampfordnung und hat keine rechtliche Wirkung auf Sie.</p>` },

        { id: 'rechte', titel: 'Ihre Rechte', html: `
<p>Sie haben gegenüber dem Verantwortlichen das Recht auf <strong>Auskunft</strong> (Art. 15 DSGVO), <strong>Berichtigung</strong> (Art. 16), <strong>Löschung</strong> (Art. 17), <strong>Einschränkung der Verarbeitung</strong> (Art. 18), <strong>Datenübertragbarkeit</strong> (Art. 20) und <strong>Widerspruch</strong> (Art. 21, siehe ${verweis('widerspruch')}). Eine erteilte <strong>Einwilligung</strong> können Sie jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3). Für Turnierdaten richten Sie Ihre Anfrage an den Veranstalter; wir unterstützen ihn dabei.</p>
<p>Sie haben außerdem das Recht, sich bei einer <strong>Datenschutz-Aufsichtsbehörde</strong> zu beschweren (Art. 77 DSGVO). Zuständig für uns ist: ${feld(ds.aufsichtsbehoerde.name, 'zuständige Datenschutz-Aufsichtsbehörde')}${ds.aufsichtsbehoerde.anschrift ? `, ${e(ds.aufsichtsbehoerde.anschrift)}` : ''}${ds.aufsichtsbehoerde.web ? `, <a href="${e(ds.aufsichtsbehoerde.web)}" rel="noopener">${e(ds.aufsichtsbehoerde.web)}</a>` : ''}.</p>` },

        // Art. 21 Abs. 4 DSGVO: ausdrücklich und von anderen Informationen getrennt
        { id: 'widerspruch', titel: 'Widerspruchsrecht nach Art. 21 DSGVO', kasten: true, html: `
<p><strong>Sie haben das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit gegen die Verarbeitung Sie betreffender personenbezogener Daten Widerspruch einzulegen, die auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (berechtigte Interessen) erfolgt.</strong></p>
<p>Das betrifft hier insbesondere die Server-, Aktions- und Fehlerprotokolle, die Datensicherung, die Beantwortung allgemeiner Anfragen und den Hinweis auf Turniere. Legen Sie Widerspruch ein, verarbeiten wir Ihre Daten dafür nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen, Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen. Der Widerspruch ist formfrei; richten Sie ihn bitte an ${dsMail}. Für Turnierdaten richten Sie ihn an den Veranstalter.</p>` },

        { id: 'sicherheit-massnahmen', titel: 'Sicherheit', html: `
<p>Wir schützen Ihre Daten durch technische und organisatorische Maßnahmen, insbesondere: verschlüsselte Übertragung (HTTPS), nicht umkehrbare Speicherung der Passwörter, zweiten Faktor für Administratoren, rollenbasierte Zugriffsrechte, Protokollierung, verschlüsselte Sicherungen.</p>` },

        { id: 'aenderungen', titel: 'Änderungen', html: `
<p>Wir passen diese Erklärung an, wenn sich die Plattform oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.</p>` }
    ].filter(Boolean);

    const nummer = new Map(abschnitte.map((a, i) => [a.id, i + 1]));
    const teile = abschnitte.map((a) => {
        const block = `<h2 id="${a.id}">${nummer.get(a.id)}. ${e(a.titel)}</h2>${a.html}`;
        return a.kasten ? `<div class="kasten">\n${block}\n</div>` : block;
    });
    const inhalt = `
<h1>Datenschutzerklärung</h1>
<p class="stand">Stand: ${e(daten.stand ? datumDeutsch(daten.stand) : datumDeutsch())}</p>

${teile.join('\n\n')}`.replace(/\{\{abschnitt:([a-z-]+)\}\}/g, (_, id) => `<a href="#${id}">Abschnitt ${nummer.get(id)}</a>`);
    return seite({ titel: 'Datenschutzerklärung', aktiv: 'datenschutz', inhalt, rechtliches });
}
