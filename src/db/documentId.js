import { randomUUID } from 'node:crypto';

export function createId(typePrefix) {
    return `${typePrefix}:${randomUUID()}`;
}

export function getTypeFromId(id) {
    return id.split(':')[0];
}
