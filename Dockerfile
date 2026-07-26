# Finance Fox — Self-Hosting (Full-Stack: Frontend + API + SQLite via WASM)
# Start:  docker compose up -d --build
# Danach: http://<heimserver>:8080
#
# Hinweis: Die Datenbank läuft über sql.js (SQLite als WebAssembly) — rein
# JavaScript-basiert, keine nativen Module, kein Compile-Step beim Installieren.
# Funktioniert dadurch zuverlässig in jeder Build-Umgebung.

# ---------- Build ----------
FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install-Skripte sind blockiert (Sicherheit) — sql.js braucht keine,
# und der esbuild-Fallback (node-gyp) ist nicht nötig, da die WASM-Datei
# bereits im Paket enthalten ist.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
# Frontend bauen + Server bündeln (esbuild)
RUN npm run build

# ---------- Runtime ----------
FROM node:26-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Datenbankverzeichnis (per Volume persistent machen!)
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "dist/boot.js"]
