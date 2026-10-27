// Link zur Helfer-App (public/helfer.html) für Mails an Helfer. Ohne gültige Basis-URL (Cloud ohne PUBLIC_BASE_URL) gibt es keinen Link.
/**
 * @param {string|null|undefined} basisUrl - Origin ohne Slash am Ende (ermittleBasisUrl)
 * @param {string} [bereich] - Reiter der App: 'turniere' | 'dienste' | 'aufgaben' | 'nachrichten' | 'profil'
 * @returns {string|null}
 */
export function helferAppLink(basisUrl, bereich = '') {
    if (!basisUrl) return null;
    return `${String(basisUrl).replace(/\/+$/, '')}/helfer.html${bereich ? `#${bereich}` : ''}`;
}

/** Absatz für Mailtexte („

In der Helfer-App: …“) oder leer, wenn es keinen Link gibt. */
export function helferAppAbsatz(basisUrl, bereich, einleitung = 'Deine Helfer-App:') {
    const link = helferAppLink(basisUrl, bereich);
    return link ? `

${einleitung}
${link}` : '';
}
