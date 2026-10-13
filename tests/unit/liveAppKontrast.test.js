import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../teilnehmer-app/css/app.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function tokens(block) {
    const t = {};
    for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2];
    return t;
}
const dunkelStart = css.indexOf('@media (prefers-color-scheme: dark)');
const hell = tokens(css.slice(0, dunkelStart));
const dunkelBlock = css.slice(dunkelStart);
const dunkel = { ...hell, ...tokens(dunkelBlock.slice(0, dunkelBlock.indexOf('}\n}') + 1)) };

function leuchtdichte(hex) {
    const kanal = (i) => {
        const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
}
function verhaeltnis(a, b) {
    const [hell1, dunkel1] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
    return (hell1 + 0.05) / (dunkel1 + 0.05);
}

// [Vordergrund, Untergrund, Mindestverhältnis]
const PAARE = [
    ['text', 'card', 4.5], ['text', 'bg', 4.5],
    ['muted', 'card', 4.5], ['muted', 'bg', 4.5],
    ['primary', 'card', 4.5], ['primary', 'bg', 4.5],
    ['on-primary', 'primary', 4.5],
    ['star-on', 'card', 3], ['star-on', 'bg', 3],
    ['ok', 'card', 4.5], ['warn', 'card', 4.5], ['live', 'card', 4.5], ['live', 'bg', 4.5],
    ['border-strong', 'card', 3]
];

test('Kontrast: das Dunkelmodus-Token-Set wurde wirklich gelesen', () => {
    assert.notEqual(dunkel.bg, hell.bg);
    assert.equal(dunkel.primary, '#3b82f6');
});

for (const [name, farben] of [['hell', hell], ['dunkel', dunkel]]) {
    test(`Kontrast ${name}: alle Farbpaare erreichen das Mindestverhältnis`, () => {
        for (const [vorn, grund, minimum] of PAARE) {
            assert.ok(farben[vorn] && farben[grund], `Token fehlt: ${vorn} oder ${grund}`);
            const v = verhaeltnis(farben[vorn], farben[grund]);
            assert.ok(v >= minimum, `${vorn} auf ${grund}: ${v.toFixed(2)} < ${minimum} (${farben[vorn]} auf ${farben[grund]})`);
        }
    });
}
