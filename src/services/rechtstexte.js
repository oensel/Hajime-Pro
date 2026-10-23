// Impressum und Datenschutzerklärung als HTML (serverseitig erzeugt, ohne JavaScript lesbar). Die Texte beschreiben die Datenverarbeitung,
// die Hajime Pro tatsächlich ausführt (siehe docs/datenschutz/verarbeitungsverzeichnis.md); die Betreiberangaben kommen aus
// src/services/rechtliches.js. Fehlende Pflichtangaben erscheinen rot als „[ANGABE FEHLT: …]“, nie als stiller Leerraum.
// WICHTIG: Das sind Textbausteine nach bestem Wissen, keine Rechtsberatung. Vor dem Einsatz von einer fachkundigen Person prüfen lassen.

const ersetzt = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const e = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => ersetzt[z]);

const fehlt = (beschreibung) => `<span class="fehlt">[ANGABE FEHLT: ${e(beschreibung)}]</span>`;
const feld = (wert, beschreibung) => (wert ? e(wert) : fehlt(beschreibung));
const mailLink = (m) => (m ? `<a href="mailto:${e(m)}">${e(m)}</a>` : '');

function datumDeutsch(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : new Date().toLocaleDateString('de-DE');
}

function anschriftBlock(b) {
    const name = [b.vorname, b.name].filter(Boolean).join(' ');
    return [
        `<strong>${feld(b.art === 'privatperson' || b.art === 'einzelunternehmen' ? name : [b.name, b.rechtsform].filter(Boolean).join(' '), 'Name bzw. Firma')}</strong>`,
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
.warnung { background: #fef3c7; color: #78350f; border: 2px solid #f59e0b; border-radius: 6px; padding: 10px 14px; margin: 0 0 16px; font-size: 14px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rand); vertical-align: top; } th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
`;

function seite({ titel, aktiv, inhalt, rechtliches }) {
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
export function rendereDatenschutz(rechtliches, env = process.env) {
    const { daten } = rechtliches;
    const b = daten.betreiber;
    const ds = daten.datenschutz;
    const protokollTage = Number(env.PROTOKOLL_AUFBEWAHRUNG_TAGE) || 365;
    const fehlerTage = Number(env.FEHLER_AUFBEWAHRUNG_TAGE) || 30;
    const liveTage = Number(env.LIVE_AUFBEWAHRUNG_TAGE) || 7;
    const sicherungTage = Number(daten.backup.aufbewahrungTage) || 60;
    const betreiberName = [b.vorname, b.name].filter(Boolean).join(' ');

    const dienstleister = [
        `<li><strong>Hosting (Server):</strong> ${feld(daten.hosting.anbieter, 'Hosting-Anbieter')}${daten.hosting.standort ? `, Standort ${e(daten.hosting.standort)}` : ''}. Der Anbieter verarbeitet Daten in unserem Auftrag auf Grundlage eines Vertrags zur Auftragsverarbeitung (Art. 28 DSGVO).</li>`,
        `<li><strong>Datenbank:</strong> ${feld(daten.datenbank.anbieter, 'Datenbank-Anbieter')}${daten.datenbank.region ? `, Rechenzentrum ${e(daten.datenbank.region)}` : ''}. Auftragsverarbeitung nach Art. 28 DSGVO.</li>`,
        `<li><strong>E-Mail-Versand:</strong> ${feld(daten.mail.anbieter, 'E-Mail-Anbieter')} (Versand von Bestätigungs-, Einladungs- und Erinnerungs-E-Mails). Auftragsverarbeitung nach Art. 28 DSGVO.</li>`,
        daten.backup.aktiv ? `<li><strong>Sicherungskopie:</strong> ${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}. Die Sicherungsdateien werden <em>vor</em> der Übertragung mit AES-256 verschlüsselt; der Anbieter kann den Inhalt nicht lesen.</li>` : ''
    ].filter(Boolean).join('\n');

    const drittland = daten.datenbank.drittland || daten.backup.drittland;

    const inhalt = `
<h1>Datenschutzerklärung</h1>
<p class="stand">Stand: ${e(daten.stand ? datumDeutsch(daten.stand) : datumDeutsch())}</p>

<h2 id="verantwortlicher">1. Verantwortlicher und Rollen</h2>
<p><strong>Verantwortlicher</strong> im Sinne der Datenschutz-Grundverordnung (DSGVO) für Benutzerkonten, Anmeldung und Betrieb der Plattform ist:</p>
<p>${anschriftBlock(b)}<br>E-Mail: ${b.email ? mailLink(b.email) : fehlt('E-Mail-Adresse')}${b.telefon ? `<br>Telefon: ${e(b.telefon)}` : ''}</p>
<p>Datenschutzanfragen richten Sie bitte an ${ds.email ? mailLink(ds.email) : fehlt('E-Mail-Adresse für Datenschutzanfragen')}.${ds.beauftragter.name ? ` Unser Datenschutzbeauftragter ist ${e(ds.beauftragter.name)}${ds.beauftragter.email ? `, ${mailLink(ds.beauftragter.email)}` : ''}.` : ''}</p>
<p><strong>Turnierdaten:</strong> Hajime Pro wird von Judo-Vereinen genutzt, um Turniere zu organisieren. Für die Daten der <em>Teilnehmenden, Helfenden und Kampfrichter eines Turniers</em> ist der jeweilige <strong>Veranstalter</strong> (der Verein, der das Turnier ausrichtet) verantwortlich. ${e(betreiberName || 'Der Betreiber')} verarbeitet diese Daten als <strong>Auftragsverarbeiter</strong> nach Art. 28 DSGVO ausschließlich auf Weisung des Veranstalters. Betroffene wenden sich für Auskunft, Berichtigung und Löschung dieser Daten bitte zuerst an den Veranstalter des Turniers.</p>

<h2 id="zugriff">2. Aufruf der Website, Server-Protokolle</h2>
<p>Beim Aufruf unserer Seiten verarbeitet der Server technisch notwendige Daten: IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge und Browserkennung. Das ist zur Auslieferung der Seiten und zur Abwehr von Angriffen erforderlich (Art. 6 Abs. 1 lit. f DSGVO, berechtigtes Interesse an einem sicheren und stabilen Betrieb). Diese Server-Protokolle werden nach ${e(ds.logfileTage)} Tagen gelöscht.</p>

<h2 id="konto">3. Registrierung und Benutzerkonto</h2>
<p><strong>Daten:</strong> Vorname, Nachname, E-Mail-Adresse, Passwort (nur als nicht umkehrbarer Prüfwert gespeichert), gewählter Verein, Rolle im Verein (Admin, Benutzer, Helfer), Zeitpunkte von Registrierung und Bestätigung.</p>
<p><strong>Zweck und Rechtsgrundlage:</strong> Bereitstellung des Kontos und der Funktionen der Plattform (Art. 6 Abs. 1 lit. b DSGVO). Zur Bestätigung Ihrer E-Mail-Adresse senden wir einen Link (Double-Opt-in); nach der Bestätigung erhalten die Administratoren des gewählten Vereins eine E-Mail mit Ihrem Namen und Ihrer Adresse, um Sie freizuschalten.</p>
<p><strong>Speicherdauer:</strong> bis zur Löschung des Kontos. Konten, deren E-Mail-Adresse nicht bestätigt wird, werden nach 30 Tagen automatisch gelöscht.</p>

<h2 id="sicherheit">4. Anmeldung, Sicherheit und Protokollierung</h2>
<ul>
<li><strong>Anmeldung:</strong> Nach der Anmeldung erhalten Sie ein befristetes Sitzungs-Token (24 Stunden), das in Ihrem Browser gespeichert wird (siehe Abschnitt 9). Administratoren der Plattform melden sich zusätzlich mit einem zweiten Faktor (Authenticator-App) an.</li>
<li><strong>Aktionsprotokoll:</strong> Zur Nachvollziehbarkeit und IT-Sicherheit protokollieren wir, welches Konto wann welche ändernde Aktion ausgeführt hat (z. B. Turnier angelegt, Rolle geändert) sowie Anmeldeereignisse einschließlich der IP-Adresse (erfolgreiche und fehlgeschlagene Anmeldungen). Eingegebene Inhalte und Passwörter werden nicht protokolliert. Die Administratoren eines Vereins sehen die Einträge ihres Vereins. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (Sicherheit, Missbrauchsabwehr, Nachweis). Speicherdauer: ${e(protokollTage)} Tage.</li>
<li><strong>Fehlerprotokoll:</strong> Technische Fehler des Servers und der Seiten im Browser werden zur Störungsbeseitigung festgehalten (Fehlermeldung, aufgerufene Seite, bei angemeldeten Konten die E-Mail-Adresse). Zugangsdaten werden dabei geschwärzt. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Speicherdauer: ${e(fehlerTage)} Tage.</li>
<li><strong>Ratenbegrenzung:</strong> Zum Schutz vor Missbrauch (z. B. massenhafte Anmeldeversuche) zählt der Server Anfragen je IP-Adresse im Arbeitsspeicher; die Zähler werden nach wenigen Minuten verworfen.</li>
</ul>

<h2 id="turnier">5. Turnierverwaltung (im Auftrag des Veranstalters)</h2>
<p><strong>Daten der Teilnehmenden:</strong> Judopass-Nummer, Vorname, Nachname, Geburtsjahr, Geschlecht, Verein, Gewicht (Wiegeergebnis), Alters- und Gewichtsklasse, Graduierung, Lizenzablauf, Anmeldestatus sowie Kampfergebnisse und Platzierungen. Betroffen sind auch <strong>Minderjährige</strong>.</p>
<p><strong>Zweck:</strong> Anmeldung, Einwiegen, Auslosung, Zeit- und Mattenplanung, Durchführung des Wettkampfs, Ergebnislisten, Siegerehrung und Urkunden. <strong>Rechtsgrundlage</strong> (durch den Veranstalter): Durchführung der Teilnahme bzw. Mitgliedschaft (Art. 6 Abs. 1 lit. b DSGVO) und berechtigtes Interesse an der ordnungsgemäßen Durchführung und Dokumentation des Wettkampfs (Art. 6 Abs. 1 lit. f DSGVO); für darüber hinausgehende Veröffentlichungen gilt Abschnitt 6.</p>
<p><strong>Helfende und Orga:</strong> Für den Helferplan und die Vorbereitung eines Turniers werden Namen, E-Mail-Adressen, Einsatzzeiten und Aufgaben verarbeitet. Wer keine Mail-Adresse bekommen soll, wird nur mit dem Namen geführt.</p>
<p><strong>Speicherdauer:</strong> Die Daten bleiben gespeichert, bis der Veranstalter das Turnier löscht oder die Löschung verlangt. Danach verbleiben sie nur noch in den Sicherungskopien (Abschnitt 8) bis zu deren Ablauf.</p>

${daten.teilnehmerApp.aktiv ? `<h2 id="app">6. Teilnehmer-App und öffentliche Anzeige</h2>
<p>Wenn der Veranstalter die Live-Anzeige für ein Turnier freigibt, werden Daten des Turniers an unseren Server übertragen und können in der <strong>Teilnehmer-App</strong> abgerufen werden. Die App öffnet sich nur über einen <strong>QR-Code, den der Veranstalter in der Halle aushängt</strong>; er enthält einen zufälligen Zugangscode, der nur für dieses Turnier gilt und mit dem Ende des Turniertags (6 Uhr am Folgetag) abläuft. Der Veranstalter kann den Code jederzeit erneuern oder sperren. Es gibt keine öffentliche Turnierliste und keine Suche ohne diesen Code; der Code steht in der Adresse hinter dem „#“ und gelangt dadurch nicht in unsere Server-Protokolle. Wer den Code erhält (z. B. durch ein weitergegebenes Foto des Aushangs), kann die Daten bis zum Ablauf einsehen. Innerhalb der App können die Daten durchsucht werden. Angezeigt werden: Vorname und Nachname, Verein, Altersklasse, Gewichtsklasse, Geschlecht, Pool und Matte, Kampfstand (anstehend, aktuell, beendet), Kampfergebnisse und Platzierung. Die Judopass-Nummer und das genaue Gewicht werden <strong>nicht</strong> veröffentlicht.</p>
<p><strong>Rechtsgrundlage:</strong> Der Veranstalter entscheidet über die Freigabe und ist dafür verantwortlich, die Teilnehmenden (bei Minderjährigen die Erziehungsberechtigten) vorher zu informieren und, wo erforderlich, ihre Einwilligung einzuholen (Art. 6 Abs. 1 lit. a oder lit. f DSGVO). Die Teilnehmenden können der Veröffentlichung gegenüber dem Veranstalter widersprechen.</p>
<p><strong>Speicherdauer:</strong> Die Live-Daten werden ${e(liveTage)} Tage nach dem Turnier gelöscht.</p>
<p><strong>Auf Ihrem Gerät</strong> speichert die App Ihre Auswahl (z. B. gemerkte Kämpfer und Vereine) und Zwischenspeicher der Anzeige im lokalen Speicher des Browsers. Dazu gehört der Zugangscode aus dem QR-Code. Diese Daten verlassen Ihr Gerät nicht (der Code wird nur bei den Abfragen an unseren Server mitgeschickt) und lassen sich in den Browser-Einstellungen löschen.</p>
<p><strong>Benachrichtigungen (Web-Push):</strong> Wenn Sie in der App Benachrichtigungen einschalten, fragt Ihr Browser nach Ihrer Erlaubnis (Einwilligung, Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG). Wir speichern dafür die Adresse Ihres Geräts beim Push-Dienst Ihres Browser-Herstellers und die technischen Schlüssel, außerdem, für welche Kämpfer Sie Benachrichtigungen wünschen. Die Mitteilungen laufen über den Push-Dienst des Herstellers Ihres Browsers (z. B. Google, Mozilla, Apple), der dadurch Kenntnis von Ihrem Gerät und dem Zeitpunkt erhält. Die Daten werden spätestens 3 Tage nach dem Turnier gelöscht; Sie können die Benachrichtigungen jederzeit in der App oder im Browser ausschalten (Widerruf).</p>` : ''}

<h2 id="mail">7. E-Mail-Versand</h2>
<p>Wir versenden E-Mails zur Bestätigung Ihrer Adresse, zur Freischaltung, zum Zurücksetzen des Passworts, für Einladungen (z. B. zum Verein oder zu einem Turnier) und für Erinnerungen an Aufgaben, wenn Sie eine Aufgabe übernommen haben. Rechtsgrundlage ist die Erfüllung des Nutzungsverhältnisses (Art. 6 Abs. 1 lit. b DSGVO). Es erfolgt keine Werbung und kein Newsletter. Wer per Einladung hinzugefügt wird, erhält genau eine Einladungs-Mail; der Link verfällt nach 14 Tagen.</p>

<h2 id="sicherung">8. Datensicherung</h2>
<p>Zum Schutz vor Datenverlust sichern wir die gesamte Datenbank täglich (Art. 6 Abs. 1 lit. f DSGVO und Art. 32 DSGVO). Die Sicherungsdateien sind mit AES-256 verschlüsselt. Sie werden auf unserem Server und ${daten.backup.aktiv ? `zusätzlich bei ${feld(daten.backup.anbieter, 'Anbieter der Sicherungskopie')}` : 'ohne zusätzliche Kopie bei einem Dritten'} aufbewahrt und nach spätestens ${e(sicherungTage)} Tagen gelöscht. Daten, die Sie oder ein Veranstalter in der Plattform löschen, verschwinden aus den Sicherungen deshalb mit dieser Verzögerung.</p>

<h2 id="empfaenger">9. Empfänger und Auftragsverarbeiter</h2>
<p>Wir setzen die folgenden Dienstleister ein, die Daten ausschließlich nach unserer Weisung verarbeiten. Mit allen besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO:</p>
<ul>
${dienstleister}
</ul>
<p>Darüber hinaus erhalten Administratoren und Mitglieder desselben Vereins im Rahmen ihrer Rolle Zugriff auf die Daten ihres Vereins und der von ihm ausgerichteten Turniere. Eine Weitergabe an sonstige Dritte findet nicht statt, es sei denn, wir sind gesetzlich dazu verpflichtet.</p>
${drittland ? `<h3>Übermittlung in Drittländer</h3><p>Soweit einer der genannten Dienstleister seinen Sitz in einem Land außerhalb der EU/des EWR hat oder dort Daten verarbeitet (insbesondere USA), erfolgt die Übermittlung auf Grundlage eines Angemessenheitsbeschlusses (EU-US Data Privacy Framework) oder von Standardvertragsklauseln der EU-Kommission (Art. 45, 46 DSGVO), ergänzt durch die beschriebene Verschlüsselung.</p>` : ''}

<h2 id="speicher">10. Lokaler Speicher im Browser (keine Cookies)</h2>
<p>Hajime Pro setzt <strong>keine Cookies</strong> und verwendet keine Werbe- oder Analysedienste. Der Browser speichert lokal ausschließlich, was für den Betrieb notwendig ist: das Sitzungs-Token und die Kontoinformationen nach der Anmeldung (bis zur Abmeldung bzw. maximal 24 Stunden gültig), die gewählte Darstellung (hell oder dunkel), den Zustand des Menüs sowie die Daten der Teilnehmer-App nach Abschnitt 6. Dieser Zugriff ist unbedingt erforderlich, damit der von Ihnen gewünschte Dienst bereitgestellt werden kann (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist dafür nicht notwendig.</p>

<h2 id="dauer">11. Speicherdauer im Überblick</h2>
<table>
<thead><tr><th>Daten</th><th>Speicherdauer</th></tr></thead>
<tbody>
<tr><td>Benutzerkonto</td><td>bis zur Löschung des Kontos; Konten ohne bestätigte E-Mail-Adresse werden nach 30 Tagen gelöscht</td></tr>
<tr><td>Turnier-, Teilnehmer- und Helferdaten</td><td>bis zur Löschung durch den Veranstalter, danach nur noch in Sicherungen (siehe unten)</td></tr>
<tr><td>Live-Daten der Teilnehmer-App</td><td>${e(liveTage)} Tage nach dem Turnier</td></tr>
<tr><td>Push-Anmeldungen</td><td>spätestens 3 Tage nach dem Turnier</td></tr>
<tr><td>Aktionsprotokoll</td><td>${e(protokollTage)} Tage</td></tr>
<tr><td>Fehlerprotokoll</td><td>${e(fehlerTage)} Tage</td></tr>
<tr><td>Server-Protokolle des Hosters</td><td>${e(ds.logfileTage)} Tage</td></tr>
<tr><td>Sicherungskopien</td><td>höchstens ${e(sicherungTage)} Tage</td></tr>
</tbody>
</table>
<p>Gesetzliche Aufbewahrungspflichten bleiben unberührt.</p>

<h2 id="pflicht">12. Pflicht zur Bereitstellung, automatisierte Entscheidungen</h2>
<p>Für die Nutzung der Plattform sind Name, E-Mail-Adresse und Passwort erforderlich; ohne diese Angaben ist kein Konto möglich. Für die Teilnahme an einem Turnier verlangt der Veranstalter die Angaben, die er für die Durchführung braucht. Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt. Die Auslosung der Kämpfe erfolgt nach den Regeln der Wettkampfordnung und hat keine rechtliche Wirkung auf Sie.</p>

<h2 id="rechte">13. Ihre Rechte</h2>
<p>Sie haben gegenüber dem Verantwortlichen das Recht auf <strong>Auskunft</strong> (Art. 15 DSGVO), <strong>Berichtigung</strong> (Art. 16), <strong>Löschung</strong> (Art. 17), <strong>Einschränkung der Verarbeitung</strong> (Art. 18), <strong>Datenübertragbarkeit</strong> (Art. 20) und <strong>Widerspruch</strong> gegen die Verarbeitung aus Gründen, die sich aus Ihrer besonderen Situation ergeben (Art. 21), soweit die Verarbeitung auf berechtigten Interessen beruht. Eine erteilte <strong>Einwilligung</strong> können Sie jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3). Für Turnierdaten richten Sie Ihre Anfrage an den Veranstalter; wir unterstützen ihn dabei.</p>
<p>Sie haben außerdem das Recht, sich bei einer <strong>Datenschutz-Aufsichtsbehörde</strong> zu beschweren (Art. 77 DSGVO). Zuständig für uns ist: ${e(ds.aufsichtsbehoerde.name)}${ds.aufsichtsbehoerde.anschrift ? `, ${e(ds.aufsichtsbehoerde.anschrift)}` : ''}${ds.aufsichtsbehoerde.web ? `, <a href="${e(ds.aufsichtsbehoerde.web)}" rel="noopener">${e(ds.aufsichtsbehoerde.web)}</a>` : ''}.</p>

<h2 id="sicherheit-massnahmen">14. Sicherheit</h2>
<p>Wir schützen Ihre Daten durch technische und organisatorische Maßnahmen, insbesondere: verschlüsselte Übertragung (HTTPS), nicht umkehrbare Speicherung der Passwörter, zweiten Faktor für Administratoren, rollenbasierte Zugriffsrechte, Protokollierung, verschlüsselte Sicherungen.</p>

<h2 id="aenderungen">15. Änderungen</h2>
<p>Wir passen diese Erklärung an, wenn sich die Plattform oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.</p>`;
    return seite({ titel: 'Datenschutzerklärung', aktiv: 'datenschutz', inhalt, rechtliches });
}
