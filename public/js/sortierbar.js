// Sortierbare Listen per Zeiger-Ereignisse (Maus, Stift und Touch -- HTML5-Drag&Drop funktioniert auf
// Tablets an der Matte nicht zuverlässig). Zeilen mit data-sortierbar="1", data-kampf-id und einem
// Griff (.sortier-griff) lassen sich verschieben; beim Loslassen meldet onNeueReihenfolge die IDs in
// neuer Reihenfolge. Move/Up hören während des Ziehens am Dokument: das Umhängen der Zeile im DOM
// beendet sonst die Zeigererfassung des Griffs.
window.macheSortierbar = function (container, onNeueReihenfolge) {
    function ids() {
        return [...container.querySelectorAll('[data-sortierbar="1"]')].map(z => z.dataset.kampfId);
    }

    container.querySelectorAll('.sortier-griff').forEach(griff => {
        griff.style.touchAction = 'none';
        griff.style.cursor = 'grab';
        griff.addEventListener('pointerdown', (e) => {
            const gezogen = griff.closest('[data-sortierbar="1"]');
            if (!gezogen) return;
            e.preventDefault();
            const vorher = ids();
            gezogen.classList.add('sortier-aktiv');

            const bewegen = (ev) => {
                const ziel = document.elementFromPoint(ev.clientX, ev.clientY);
                const zeile = ziel && ziel.closest('[data-sortierbar="1"]');
                if (!zeile || zeile === gezogen || zeile.parentNode !== gezogen.parentNode) return;
                const rect = zeile.getBoundingClientRect();
                const nachUnten = ev.clientY > rect.top + rect.height / 2;
                gezogen.parentNode.insertBefore(gezogen, nachUnten ? zeile.nextSibling : zeile);
            };
            const beenden = async () => {
                document.removeEventListener('pointermove', bewegen);
                document.removeEventListener('pointerup', beenden);
                document.removeEventListener('pointercancel', beenden);
                gezogen.classList.remove('sortier-aktiv');
                const nachher = ids();
                if (JSON.stringify(nachher) !== JSON.stringify(vorher)) await onNeueReihenfolge(nachher);
            };
            document.addEventListener('pointermove', bewegen);
            document.addEventListener('pointerup', beenden);
            document.addEventListener('pointercancel', beenden);
        });
    });
};
