import { expect } from '@playwright/test';

// Listet die Elemente, die über den rechten Rand ragen (sichtbar in der Fehlermeldung); die Kanji-Wasserzeichen sind dekorativ.
export const keinSeitwaertsScrollen = async (page) => {
    const zuBreit = await page.evaluate(() => {
        const breite = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= breite) return [];
        return [...document.querySelectorAll('body *')]
            .filter((e) => !e.closest('.app-sidebar') && !e.matches('.kanji-left, .kanji-right') && e.getBoundingClientRect().right > breite + 1)
            .slice(0, 8)
            .map((e) => `${e.tagName}.${e.className} ${e.textContent.trim().slice(0, 30)} -> ${Math.round(e.getBoundingClientRect().right)}`);
    });
    expect(zuBreit).toEqual([]);
};
