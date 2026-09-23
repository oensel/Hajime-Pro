import { letztesKampfEndeProTeilnehmer, pruefeKampfPause } from '../../shared/pausenRegel.js';

// Verbindet die reine, seiteneffektfreie pausenRegel.js-Engine mit dem kaempfeRepository:
// lädt ALLE Kämpfe des Turniers (nicht nur eines Pools, siehe findAll() in kaempfeRepository.js)
// und prüft einen anstehenden Kampf gegen die DJB-WKO-Mindestpause.
export async function pruefePauseFuerKampf(kaempfeRepository, kampf, altersklasse, jetztMs = Date.now()) {
    const alleKaempfe = await kaempfeRepository.findAll();
    const letztesEndeMap = letztesKampfEndeProTeilnehmer(alleKaempfe);
    return pruefeKampfPause(kampf, altersklasse, letztesEndeMap, jetztMs);
}
