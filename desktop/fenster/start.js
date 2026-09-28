const status = document.getElementById('status');
const form = document.getElementById('kopplung');
const fehler = document.getElementById('fehler');
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
    else fehler.textContent = ergebnis.fehler;
});
