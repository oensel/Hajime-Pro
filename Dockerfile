# Hajime Pro im Cloud-Modus (BETRIEBSMODUS=cloud): Vereinsverwaltung mit Login gegen PostgreSQL/Supabase.
# Build:  docker build -t hajime-pro .
FROM node:22-slim

ENV NODE_ENV=production \
    BETRIEBSMODUS=cloud \
    PORT=3000 \
    SICHERUNG_VERZEICHNIS=/var/backups/hajime

WORKDIR /app

# Abhängigkeiten zuerst (Layer-Cache). devDependencies (Electron, electron-builder, Playwright) entfallen.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Sicherungsverzeichnis (automatische Sicherung, Seite „Sicherung“): gehört dem Benutzer node und wird in docker-compose.yml als Volume
# eingebunden, damit die Sicherungen ein Update des Containers überleben.
RUN mkdir -p /var/backups/hajime && chown node:node /var/backups/hajime

# Läuft nicht als root.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/app.js"]
