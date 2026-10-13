// Echter Versand über web-push (VAPID). Im Test wird stattdessen ein Sender injiziert.
import webpush from 'web-push';

export function erzeugeSender(konfig) {
    webpush.setVapidDetails(konfig.betreff, konfig.publicKey, konfig.privateKey);
    return async (abo, nachricht) => {
        await webpush.sendNotification(
            { endpoint: abo.endpoint, keys: abo.keys },
            JSON.stringify(nachricht),
            { TTL: 600, urgency: 'high' }
        );
    };
}
