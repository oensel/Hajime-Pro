// Prüfung der SEPA-Gläubiger-Identifikationsnummer (framework-frei).
// Aufbau: Land (2 Buchstaben) + Prüfziffern (2) + Geschäftsbereichskennung (3, für die Prüfung
// ignoriert) + nationale Kennung. DE: genau 18 Zeichen, sonst 8 bis 35.

function alsZiffern(text) {
    return [...text].map((z) => (/[A-Z]/.test(z) ? String(z.charCodeAt(0) - 55) : z)).join('');
}

function mod97(ziffern) {
    let rest = 0;
    for (const z of ziffern) rest = (rest * 10 + Number(z)) % 97;
    return rest;
}

export function pruefeGlaeubigerId(text) {
    const fehler = (meldung) => ({ ok: false, wert: null, fehler: meldung });
    const roh = String(text ?? '').replace(/\s+/g, '');
    if (!roh) return fehler('Die Gläubiger-ID fehlt.');
    // Erst prüfen, dann umwandeln: toUpperCase() würde z. B. ß zu SS falten.
    if (/[^\x00-\x7F]/.test(roh)) return fehler('Die Gläubiger-ID darf nur Buchstaben und Ziffern enthalten.');
    const wert = roh.toUpperCase();
    if (!/^[A-Z0-9]+$/.test(wert)) return fehler('Die Gläubiger-ID darf nur Buchstaben und Ziffern enthalten.');
    if (!/^[A-Z]{2}[0-9]{2}/.test(wert)) {
        return fehler('Die Gläubiger-ID beginnt mit Länderkennung und zwei Prüfziffern, z. B. DE98.');
    }
    const land = wert.slice(0, 2);
    if (land === 'DE') {
        if (wert.length !== 18) return fehler('Eine deutsche Gläubiger-ID hat genau 18 Zeichen.');
    } else if (wert.length < 8 || wert.length > 35) {
        return fehler('Die Gläubiger-ID hat 8 bis 35 Zeichen.');
    }
    const pruefziffern = wert.slice(2, 4);
    const national = wert.slice(7);
    const erwartet = String(98 - mod97(alsZiffern(national + land + '00'))).padStart(2, '0');
    if (erwartet !== pruefziffern) return fehler('Die Prüfziffern der Gläubiger-ID stimmen nicht.');
    return { ok: true, wert, fehler: null };
}
