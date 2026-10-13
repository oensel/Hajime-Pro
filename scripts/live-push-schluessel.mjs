// Erzeugt ein VAPID-Schlüsselpaar für die Push-Nachrichten: node scripts/live-push-schluessel.mjs
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`LIVE_PUSH_VAPID_PUBLIC=${publicKey}`);
console.log(`LIVE_PUSH_VAPID_PRIVATE=${privateKey}`);
console.log('LIVE_PUSH_BETREFF=mailto:<Kontaktadresse>');
console.log('Der private Schlüssel gehört nur in die Cloud-Umgebung (.env), nie ins Repository.');
