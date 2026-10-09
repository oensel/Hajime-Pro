// Liest eine E-Mail (.eml oder eingefügten Text) und sucht darin Kämpfer mit Name, Geburtsdatum/-jahr,
// Geschlecht, Verein, Gewicht usw. Regelbasiert (keine KI), framework-/DB-frei: läuft im Browser
// (teilnehmer.js, Drag & Drop) und in den Unit-Tests identisch. Das Ergebnis wird dem Nutzer zur
// Korrektur gezeigt und erst danach über den normalen Import gespeichert.

// ---------------------------------------------------------------------------------------------
// 1. MIME: .eml in Text und Anhänge zerlegen
// ---------------------------------------------------------------------------------------------

function bytesZuLatin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return s;
}

function latin1ZuBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

function dekodiereBytes(bytes, charset) {
    try {
        return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(bytes);
    } catch (e) {
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function dekodiereTransfer(body, encoding) {
    const enc = String(encoding || '').trim().toLowerCase();
    if (enc === 'base64') {
        const bin = atob(body.replace(/[^A-Za-z0-9+/]/g, ''));
        return latin1ZuBytes(bin);
    }
    if (enc === 'quoted-printable') {
        const ohneUmbruch = body.replace(/=\r?\n/g, '');
        const bytes = [];
        for (let i = 0; i < ohneUmbruch.length; i++) {
            const c = ohneUmbruch[i];
            if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(ohneUmbruch.slice(i + 1, i + 3))) {
                bytes.push(parseInt(ohneUmbruch.slice(i + 1, i + 3), 16));
                i += 2;
            } else {
                bytes.push(c.charCodeAt(0) & 0xff);
            }
        }
        return Uint8Array.from(bytes);
    }
    return latin1ZuBytes(body);
}

// Kopfzeilen -> { name(klein): wert }, Rest = Körper
function trenneKopf(roh) {
    const m = roh.match(/\r?\n\r?\n/);
    const kopfText = m ? roh.slice(0, m.index) : roh;
    const body = m ? roh.slice(m.index + m[0].length) : '';
    const kopf = {};
    kopfText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(zeile => {
        const i = zeile.indexOf(':');
        if (i > 0) {
            const name = zeile.slice(0, i).trim().toLowerCase();
            if (!(name in kopf)) kopf[name] = zeile.slice(i + 1).trim();
        }
    });
    return { kopf, body };
}

function parameter(wert, name) {
    if (!wert) return '';
    const erweitert = wert.match(new RegExp(`${name}\\*=(?:[\\w-]*)'[^']*'([^;]+)`, 'i'));
    if (erweitert) {
        try { return decodeURIComponent(erweitert[1].trim()); } catch (e) { /* weiter */ }
    }
    const m = wert.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
    return m ? (m[1] ?? m[2] ?? '') : '';
}

// RFC 2047 ("=?UTF-8?Q?M=C3=BCller?=") in Kopfzeilen wie Betreff, Absender und Dateiname
export function dekodiereKopfwert(wert) {
    return String(wert || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, art, text) => {
        const bytes = art.toLowerCase() === 'b'
            ? dekodiereTransfer(text, 'base64')
            : dekodiereTransfer(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, '=$1'), 'quoted-printable');
        return dekodiereBytes(bytes, charset);
    }).replace(/\?=\s+=\?/g, '');
}

const HTML_ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", auml: 'ä', ouml: 'ö', uuml: 'ü',
    Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', ndash: '–', mdash: '—'
};

export function htmlZuText(html) {
    return String(html || '')
        .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6]|table|ul|ol)>/gi, '\n')
        .replace(/<\/t[dh]>/gi, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (voll, code) => {
            if (code[0] === '#') {
                const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                return Number.isFinite(n) ? String.fromCodePoint(n) : voll;
            }
            return HTML_ENTITIES[code] ?? voll;
        })
        .replace(/[  ]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
}

function parseTeil(roh, tiefe = 0) {
    const { kopf, body } = trenneKopf(roh);
    const contentType = kopf['content-type'] || 'text/plain';
    const typ = contentType.split(';')[0].trim().toLowerCase();
    const ergebnis = { texte: [], anhaenge: [] };

    if (typ.startsWith('multipart/') && tiefe < 8) {
        const grenze = parameter(contentType, 'boundary');
        if (!grenze) return ergebnis;
        const teile = body.split('--' + grenze);
        for (let i = 1; i < teile.length; i++) {
            if (teile[i].startsWith('--')) break;
            const teil = parseTeil(teile[i].replace(/^\r?\n/, ''), tiefe + 1);
            ergebnis.texte.push(...teil.texte);
            ergebnis.anhaenge.push(...teil.anhaenge);
        }
        return ergebnis;
    }

    const bytes = dekodiereTransfer(body, kopf['content-transfer-encoding']);

    if (typ === 'message/rfc822' && tiefe < 8) {
        const teil = parseTeil(bytesZuLatin1(bytes), tiefe + 1);
        ergebnis.texte.push(...teil.texte);
        ergebnis.anhaenge.push(...teil.anhaenge);
        return ergebnis;
    }

    const dateiname = dekodiereKopfwert(
        parameter(kopf['content-disposition'], 'filename') || parameter(contentType, 'name')
    );
    if (dateiname || !typ.startsWith('text/')) {
        ergebnis.anhaenge.push({ name: dateiname, typ, daten: bytes });
        return ergebnis;
    }

    const text = dekodiereBytes(bytes, parameter(contentType, 'charset'));
    ergebnis.texte.push({ typ, text: typ === 'text/html' ? htmlZuText(text) : text });
    return ergebnis;
}

// bytes: Uint8Array einer .eml-Datei -> { betreff, von, text, anhaenge:[{name, typ, daten}] }
export function parseEml(bytes) {
    const roh = bytesZuLatin1(bytes);
    const { kopf } = trenneKopf(roh);
    const teil = parseTeil(roh);
    const plain = teil.texte.filter(t => t.typ !== 'text/html' && t.text.trim());
    const gewaehlt = plain.length > 0 ? plain : teil.texte;
    return {
        betreff: dekodiereKopfwert(kopf.subject),
        von: dekodiereKopfwert(kopf.from),
        text: gewaehlt.map(t => t.text).join('\n\n').replace(/\r\n?/g, '\n'),
        anhaenge: teil.anhaenge
    };
}

// ---------------------------------------------------------------------------------------------
// 2. Kämpfer im Text finden
// ---------------------------------------------------------------------------------------------

export const MAIL_SPALTEN = ['Vorname', 'Name', 'Passnr', 'Geburtsdatum', 'Geschlecht', 'Verein', 'Team-Name', 'Graduierung', 'Gewicht'];
const FELDER = ['vorname', 'nachname', 'judopass_id', 'geburtsjahr', 'geschlecht', 'verein', 'mannschaft_name', 'graduierung', 'gewicht'];

const VEREINS_WORT = /\b(judo|jc|jk|jsv|sv|tv|tsv|vfl|vfb|turn|sport|club|dojo|budo|kai|kwai|verein|e\.\s?v\.)/i;
const KEIN_NAME = /^(hallo|hi|liebe|lieber|sehr|guten|gr(ü|ue)(ß|ss)e|gruss|mit|betreff|von|an|cc|gesendet|datum|tel|telefon|mobil|fax|mail|e-mail|www|http|anmeldung|meldung|turnier|bitte|danke|vielen|anbei|im anhang)\b/i;

function aktuellesJahr() {
    return new Date().getFullYear();
}

function normalisiereGeschlecht(wert) {
    const s = String(wert || '').trim().toLowerCase().replace(/[().]/g, '');
    if (/^(m|männlich|maennlich|jungen?|herren?|♂)$/.test(s)) return 'männlich';
    if (/^(w|weiblich|mädchen|maedchen|damen?|f|♀)$/.test(s)) return 'weiblich';
    return '';
}

function zweistelligesJahr(yy) {
    const aktuell = aktuellesJahr() % 100;
    return yy > aktuell ? 1900 + yy : 2000 + yy;
}

// Datum (TT.MM.JJJJ, TT.MM.JJ, JJJJ-MM-TT) oder Jahr -> Text für die Spalte "Geburtsdatum"; sonst ''.
function leseGeburt(text) {
    const str = String(text || '');
    const iso = str.match(/(?<!\d)((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/);
    if (iso) return { wert: `${iso[3]}.${iso[2]}.${iso[1]}`, treffer: iso[0] };
    const de = str.match(/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/);
    if (de) {
        const jahr = de[3].length === 2 ? zweistelligesJahr(parseInt(de[3], 10)) : parseInt(de[3], 10);
        return { wert: `${de[1].padStart(2, '0')}.${de[2].padStart(2, '0')}.${jahr}`, treffer: de[0] };
    }
    const mitMarke = str.match(/(?:\*|geb\.?|jg\.?|jahrgang|geboren)\s*:?\s*((?:19|20)\d{2})(?!\d)/i);
    if (mitMarke) return { wert: mitMarke[1], treffer: mitMarke[0] };
    const nackt = str.match(/(?<!\d|\d[.,])((?:19|20)\d{2})(?!\d|[.,]\d)/);
    if (nackt) {
        const jahr = parseInt(nackt[1], 10);
        if (jahr >= aktuellesJahr() - 90 && jahr <= aktuellesJahr() - 3) return { wert: nackt[1], treffer: nackt[0] };
    }
    return null;
}

function leseGewicht(text) {
    const m = String(text || '').match(/(?:gewicht\s*:?\s*)?(\d{2,3}(?:[.,]\d{1,2})?)\s*kg\b/i)
        || String(text || '').match(/gewicht\s*:?\s*(\d{2,3}(?:[.,]\d{1,2})?)/i);
    return m ? { wert: m[1].replace('.', ','), treffer: m[0] } : null;
}

function leseGraduierung(text) {
    const str = String(text || '');
    const m = str.match(/(\d{1,2})\.?\s*(kyu|dan)\b/i) || str.match(/\b(kyu|dan)\s*\.?\s*(\d{1,2})\b/i);
    if (m) {
        const nr = /^\d/.test(m[1]) ? m[1] : m[2];
        const art = /^\d/.test(m[1]) ? m[2] : m[1];
        return { wert: `${nr}. ${art[0].toUpperCase()}${art.slice(1).toLowerCase()}`, treffer: m[0] };
    }
    const farbe = str.match(/\b(weiß|weiss|gelb|orange|grün|gruen|blau|braun|schwarz)(?:[-/ ](?:gelb|orange|grün|gruen|blau|braun))?[- ]?(?:gurt|gürtel|guertel)\b/i);
    return farbe ? { wert: farbe[0].replace(/[- ]?(gurt|gürtel|guertel)$/i, ''), treffer: farbe[0] } : null;
}

function lesePass(text) {
    const m = String(text || '').match(/(?:judo)?pass(?:nummer|nr\.?|-nr\.?)?\s*[:#]?\s*([A-Za-z]{0,3}-?\d{3,}[\w-]*)/i);
    return m ? { wert: m[1], treffer: m[0] } : null;
}

function leseGeschlechtImText(text) {
    const m = String(text || '').match(/(?<![\wäöüß])(männlich|maennlich|weiblich|jungen|junge|mädchen|maedchen|herren|damen)(?![\wäöüß])/i)
        || String(text || '').match(/(?<=^|[\s(,;/])([mw])(?=$|[\s),;/])/i);
    return m ? { wert: normalisiereGeschlecht(m[1]), treffer: m[0], index: m.index } : null;
}

function bereinigeNamen(s) {
    return s.replace(/[*:()[\]"“”„]/g, ' ').replace(/\s+/g, ' ').trim();
}

// "Max Mustermann" / "Mustermann, Max" -> { vorname, nachname }
export function teileName(text) {
    const s = bereinigeNamen(String(text || ''));
    if (!s) return null;
    if (s.includes(',')) {
        const [nach, vor] = s.split(',').map(t => t.trim());
        if (nach && vor) return { vorname: vor, nachname: nach };
    }
    const woerter = s.split(' ');
    if (woerter.length < 2) return null;
    const praefix = /^(van|von|vom|der|den|de|di|da|du|zu|zur|le|la|el|al|ten|ter|bin|ibn)$/i;
    let i = woerter.length - 1;
    while (i > 1 && praefix.test(woerter[i - 1])) i--;
    return { vorname: woerter.slice(0, i).join(' '), nachname: woerter.slice(i).join(' ') };
}

function istNamensWort(w) {
    return /^[A-ZÄÖÜÀ-ÝŠŽČĆ][\p{L}'’-]*\.?$/u.test(w) || /^(van|von|vom|der|den|de|di|da|du|zu|zur|le|la|el|al|ten|ter|bin|ibn)$/i.test(w);
}

function istPlausiblerName(n) {
    if (!n || !n.vorname || !n.nachname) return false;
    const woerter = `${n.vorname} ${n.nachname}`.split(' ');
    return woerter.length <= 6 && woerter.every(istNamensWort) && !KEIN_NAME.test(n.vorname);
}

function leereZeile() {
    return Object.fromEntries(FELDER.map(f => [f, '']));
}

// Freitext-Zeile wie "1. Max Mustermann, *2012, m, 34 kg, 5. Kyu" oder "Mustermann, Max (JC Senden) 01.05.2012"
function parseFreiZeile(zeile, kontext) {
    let rest = zeile.trim().replace(/^\s*(?:\d{1,3}[.)]|[-–•*·]|\(\d+\))\s+/, '');
    if (!rest) return null;
    const satz = leereZeile();

    const geburt = leseGeburt(rest);
    if (!geburt) return null; // ohne Geburtsangabe keine Kämpfer-Zeile
    satz.geburtsjahr = geburt.wert;
    rest = rest.replace(geburt.treffer, ' ');

    for (const [feld, leser] of [['judopass_id', lesePass], ['gewicht', leseGewicht], ['graduierung', leseGraduierung]]) {
        const fund = leser(rest);
        if (fund) {
            satz[feld] = fund.wert;
            rest = rest.replace(fund.treffer, ' ');
        }
    }

    const geschlecht = leseGeschlechtImText(rest);
    if (geschlecht) {
        satz.geschlecht = geschlecht.wert;
        // an der Fundstelle entfernen: ein einzelnes "m" käme sonst zuerst im Namen vor
        rest = rest.slice(0, geschlecht.index) + ' ' + rest.slice(geschlecht.index + geschlecht.treffer.length);
    }

    const verein = rest.match(/verein\s*[:=]\s*([^,;|\t(]+)/i);
    if (verein) {
        satz.verein = verein[1].trim();
        rest = rest.replace(verein[0], ' ');
    }
    const klammer = rest.match(/\(([^()]{3,60})\)/);
    if (klammer && VEREINS_WORT.test(klammer[1]) && !satz.verein) {
        satz.verein = klammer[1].trim();
        rest = rest.replace(klammer[0], ' ');
    }

    const segmente = rest.split(/[,;|\t]|\s[-–]\s|\s{2,}/).map(bereinigeNamen).filter(s => /\p{L}/u.test(s));
    let name = null;
    let verbraucht = 0;
    if (segmente.length > 0) {
        name = teileName(segmente[0]);
        verbraucht = 1;
        if ((!name || !segmente[0].includes(' ')) && segmente.length > 1 && !segmente[0].includes(' ') && !segmente[1].includes(' ') && !VEREINS_WORT.test(segmente[1])) {
            name = { vorname: segmente[1], nachname: segmente[0] };
            verbraucht = 2;
        }
    }
    if (!istPlausiblerName(name)) return null;
    satz.vorname = name.vorname;
    satz.nachname = name.nachname;

    if (!satz.verein) {
        const vereinSegment = segmente.slice(verbraucht).find(s => VEREINS_WORT.test(s));
        satz.verein = vereinSegment || kontext.verein || '';
    }
    if (!satz.geschlecht) satz.geschlecht = kontext.geschlecht || '';
    return satz;
}

// --- Tabellen (Tab / ; / |) mit Kopfzeile ---

function teileZellen(zeile) {
    if (zeile.includes('\t')) return zeile.split('\t').map(z => z.trim());
    if (zeile.includes(';')) return zeile.split(';').map(z => z.trim());
    if (zeile.includes('|')) return zeile.split('|').map(z => z.trim()).filter((z, i, a) => !(z === '' && (i === 0 || i === a.length - 1)));
    return null;
}

const KOPF_FELD = {
    vorname: 'vorname', nachname: 'nachname', name: 'nachname', familienname: 'nachname',
    teilnehmer: 'voll', kaempfer: 'voll', kämpfer: 'voll', athlet: 'voll', namevorname: 'voll', vornamename: 'voll',
    geburtsdatum: 'geburt', geburtstag: 'geburt', geburtsjahr: 'geburt', jahrgang: 'geburt', jg: 'geburt', geb: 'geburt',
    gebdatum: 'geburt', geburtsjahrgang: 'geburt',
    verein: 'verein', club: 'verein',
    geschlecht: 'geschlecht', gender: 'geschlecht', mw: 'geschlecht', mf: 'geschlecht',
    gewicht: 'gewicht', kg: 'gewicht', gewichtkg: 'gewicht',
    pass: 'judopass_id', passnr: 'judopass_id', passnummer: 'judopass_id', judopass: 'judopass_id', judopassnr: 'judopass_id',
    graduierung: 'graduierung', kyu: 'graduierung', gurt: 'graduierung', grad: 'graduierung', guertel: 'graduierung',
    team: 'mannschaft_name', mannschaft: 'mannschaft_name', teamname: 'mannschaft_name'
};

function erkenneKopfzeile(zellen) {
    const spalten = zellen.map(z => KOPF_FELD[z.toLowerCase().replace(/[^a-zäöüß]/g, '')] || null);
    const bekannt = new Set(spalten.filter(Boolean));
    const hatName = bekannt.has('vorname') || bekannt.has('nachname') || bekannt.has('voll');
    return hatName && bekannt.size >= 2 ? spalten : null;
}

function parseTabellenZeile(zellen, spalten, kontext) {
    const satz = leereZeile();
    spalten.forEach((feld, i) => {
        const wert = (zellen[i] || '').trim();
        if (!feld || !wert) return;
        if (feld === 'voll') {
            const n = teileName(wert);
            if (n) { satz.vorname = n.vorname; satz.nachname = n.nachname; }
        } else if (feld === 'geburt') {
            satz.geburtsjahr = leseGeburt(wert)?.wert || wert;
        } else if (feld === 'geschlecht') {
            satz.geschlecht = normalisiereGeschlecht(wert) || wert;
        } else if (feld === 'gewicht') {
            satz.gewicht = wert.replace(/\s*kg$/i, '').replace('.', ',');
        } else {
            satz[feld] = wert;
        }
    });
    if (!satz.nachname || !satz.vorname) return null;
    if (!satz.verein) satz.verein = kontext.verein || '';
    if (!satz.geschlecht) satz.geschlecht = kontext.geschlecht || '';
    return satz;
}

// text -> Array von Kämpfer-Datensätzen (Felder wie in FELDER)
export function extrahiereKaempfer(text, optionen = {}) {
    const kontext = { verein: optionen.verein || '', geschlecht: '' };
    const ergebnis = [];
    let spalten = null;

    for (const zeile of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
        const getrimmt = zeile.trim();
        if (!getrimmt) continue;
        if (/^>/.test(getrimmt)) continue; // zitierte Antwort-Zeilen

        const zellen = teileZellen(zeile);
        if (zellen && zellen.length >= 2) {
            const kopf = erkenneKopfzeile(zellen);
            if (kopf) { spalten = kopf; continue; }
            if (spalten) {
                const satz = parseTabellenZeile(zellen, spalten, kontext);
                if (satz) { ergebnis.push(satz); continue; }
            }
        } else {
            spalten = null;
        }

        const satz = parseFreiZeile(zeile, kontext);
        if (satz) { ergebnis.push(satz); continue; }

        // Kontextzeilen: "Verein: JC Senden", "Jungen:", "Mädchen"
        const vereinZeile = getrimmt.match(/^verein\s*[:=]\s*(.+)$/i);
        if (vereinZeile) { kontext.verein = vereinZeile[1].trim(); continue; }
        if (getrimmt.length <= 40) {
            const g = leseGeschlechtImText(getrimmt);
            if (g && g.wert && getrimmt.replace(g.treffer, '').replace(/[\s:–-]/g, '').length <= 12) kontext.geschlecht = g.wert;
        }
    }

    const gesehen = new Set();
    return ergebnis.filter(s => {
        const schluessel = `${s.vorname}|${s.nachname}|${s.geburtsjahr}`.toLowerCase();
        if (gesehen.has(schluessel)) return false;
        gesehen.add(schluessel);
        return true;
    });
}

// Datensätze -> Zeilen für die Tabelle (Spalten wie MAIL_SPALTEN)
export function kaempferZuZeilen(saetze) {
    return saetze.map(s => FELDER.map(f => s[f] || ''));
}

// Tabelle -> CSV-Text (Komma, Anführungszeichen) für den normalen Import
export function tabelleZuCsv(headers, zeilen) {
    const zelle = (w) => {
        const s = String(w ?? '');
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers, ...zeilen].map(z => z.map(zelle).join(',')).join('\n');
}
