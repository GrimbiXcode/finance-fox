# Finance Fox

Self-gehostete Full-Stack-Webapp zur Organisation der Finanzen eines Haushalts
mit einer oder mehreren Personen. Alle Daten liegen in einer **SQLite-Datenbank
auf deinem eigenen Server** — nichts verlässt dein Netz.

## Funktionen

- **Dashboard** — Gesamtvermögen, Einnahmen/Ausgaben, Sparrate, Cashflow- und Kategorien-Charts
- **Transaktionen** — Einnahmen, Ausgaben, Umbuchungen; Suche & Filter
- **Konten** — Giro, Bargeld, Sparkonto mit automatisch berechneten Salden
- **Budgets** — monatliche Limits pro Kategorie mit Fortschritt und Warnung
- **Kostenaufteilung** — Ausgaben splitten, Salden, Ausgleichsvorschläge
- **Wiederkehrende Buchungen** — der Server verbucht Fälliges **täglich per Cron-Job** (03:00 Uhr) und bei jedem Start
- **Sparziele** — Ziele mit Fortschritt und Stichtag
- **Prognosen** — Kontostand-Prognose (inkl. Dauerbuchungen), Budget-Hochrechnung, Sparziel-ETA
- **Benutzer & Login** — Ersteinrichtungs-Wizard, E-Mail/Passwort-Login,
  Einladungslinks für weitere Personen, Admin-Verwaltung

## Architektur

- **Frontend**: React 19 + TypeScript + Vite + Tailwind + shadcn/ui + Recharts
- **Backend**: Hono + tRPC (End-to-end typisiert), Sessions via signiertem HttpOnly-Cookie
- **Datenbank**: SQLite über sql.js (WebAssembly, Drizzle ORM) — eine Datei,
  ideal fürs Self-Hosting; keine nativen Module, kein Compile-Step beim Installieren
- **Hintergrundjobs**: node-cron (tägliche Verbuchung wiederkehrender Transaktionen)
- Alle Geldbeträge werden intern in Cent (Integer) gespeichert.

## Self-Hosting auf dem Heimserver

### Docker (empfohlen)

```bash
# Optional: eigenes Secret setzen
export JWT_SECRET="$(openssl rand -hex 32)"
export PUBLIC_URL="http://192.168.1.10:8080"   # so erreichst du die App im Heimnetz

docker compose up -d --build
```

Die App läuft danach unter `http://<heimserver>:8080`.
Die Datenbank liegt im Docker-Volume `finance-fox-data` —
für Backups genügt es, dieses Volume (bzw. die `.db`-Datei) zu sichern.

**Einladungs- und Passwort-Reset-Links** werden im Container-Log ausgegeben:

```bash
docker logs finance-fox
```

### Ohne Docker

```bash
npm ci
npm run build
JWT_SECRET="langer-zufallsstring" PUBLIC_URL="http://localhost:3000" npm start
```

## Ersteinrichtung

1. App im Browser öffnen → der **Setup-Wizard** startet automatisch
2. Administratorkonto anlegen (Name, E-Mail, Passwort)
3. Weitere Haushaltsmitglieder einladen (Einladungslink kopieren oder aus dem Log holen)
4. Optional: lokale Daten aus der alten App-Version (localStorage) importieren

## Entwicklung

```bash
npm install
npm run db:push   # Schema anwenden
npm run dev       # http://localhost:3000 (Frontend + API mit HMR)
```

Wichtige Befehle: `npm run check` (Type-Check), `npm run build` (Produktion),
`npm run db:push` (Schema synchronisieren).
