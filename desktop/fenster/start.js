const status = document.getElementById('status');
const form = document.getElementById('kopplung');
const fehler = document.getElementById('fehler');
const manuell = document.getElementById('manuell');
const adresseFehler = document.getElementById('adresseFehler');
const MANUELL_NACH_MS = 15000;

// Manuelle Server-Adresse: nach 15 s ohne Kopplungsformular (Suche erfolglos) und immer, wenn der
// Server beim Koppeln nicht erreichbar ist.
function zeigeManuell() { manuell.style.display = 'block'; }
setTimeout(() => { if (form.style.display !== 'block') zeigeManuell(); }, MANUELL_NACH_MS);

window.hajime.onStatus((text) => { status.textContent = text; });
window.hajime.onKopplungNoetig((grund) => {
    if (grund) document.getElementById('kopplungGrund').textContent = grund;
    form.style.display = 'block';
    document.getElementById('code').focus();
});
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    fehler.textContent = '';
    const ergebnis = await window.hajime.koppeln(document.getElementById('code').value);
    if (ergebnis.ok) form.style.display = 'none';
    else {
        fehler.textContent = ergebnis.fehler;
        if (ergebnis.unerreichbar) zeigeManuell();
    }
});
manuell.addEventListener('submit', async (e) => {
    e.preventDefault();
    adresseFehler.textContent = 'Prüfe …';
    const ergebnis = await window.hajime.serverAdresse(document.getElementById('adresse').value);
    if (ergebnis.ok) {
        adresseFehler.textContent = '';
        manuell.style.display = 'none';
        fehler.textContent = '';
    } else {
        adresseFehler.textContent = ergebnis.fehler;
    }
});
