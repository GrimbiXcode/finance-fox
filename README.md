# Finance Fox

Self-gehostete Full-Stack-Webapp zur Organisation der Finanzen eines Haushalts
mit einer oder mehreren Personen. Alle Daten liegen in einer **SQLite-Datenbank
auf deinem eigenen Server** — nichts verlässt dein Netz.

## Funktionen

- **Dashboard** — Gesamtvermögen, Einnahmen/Ausgaben, Sparrate, Cashflow- und Kategorien-Charts
- **Transaktionen** — Einnahmen, Ausgaben, Umbuchungen; Suche & Filter, Tags, Beleg-Anhänge (Foto/PDF), Bearbeiten mit Änderungshistorie, CSV- & CAMT.053-Import, CSV-Export
- **Konten** — eigene Kontotypen, Bank & IBAN, Saldo-Verlauf, Besitz & Sichtbarkeit (privat vs. Gemeinschaftskonto mit Freigaben, serverseitig durchgesetzt)
- **Budgets** — Monats- oder Jahreslimits pro Kategorie mit Fortschritt, Warnung und optionalem Rollover
- **Kostenaufteilung** — Ausgaben splitten (auch gewichtet über Vorlagen), Projekte, Salden, Ausgleichsvorschläge mit 1-Klick-Verbuchung
- **Wiederkehrende Buchungen** — wöchentlich bis jährlich (auch viertel- und halbjährlich), inkl. Dauer-Umbuchungen; der Server verbucht Fälliges **täglich per Cron-Job** (03:00 Uhr) und bei jedem Start
- **Sparziele** — Fortschritt aus verknüpften Konten (ganzes Konto / fixer Anteil / Prozent), Herkunfts-Aufschlüsselung, ETA-Prognose
- **Prognosen & Auswertung** — Kontostand-Prognose, Budget-Hochrechnung, Sparziel-ETA, Szenario-Planung, Jahresvergleich; dazu eine **Prognose-Tabelle** mit frei wählbarem Horizont (bis 10 Jahre) und Spaltenbreite (Monat/Quartal/Halbjahr/Jahr) für Kontosalden, Sparziel-Fortschritt, Ein-/Ausgaben und Nettovermögen — optional inklusive dem Durchschnitt der variablen Buchungen
- **Hypotheken** — Liegenschaft mit Verkehrswert, mehrere Tranchen (Festhypothek/SARON/variabel) mit eigenem Zinssatz und Ablauf, direkte und indirekte Amortisation, Belehnung und Tragbarkeit nach Schweizer Praxis, Schuldenverlauf und Nettovermögen; Zins und Amortisation per Klick als Dauerbuchung, Erinnerung vor Ablauf der Zinsbindung
- **Versicherungen** — alle Policen des Haushalts zentral (gemeinsame wie personenbezogene): Sparte, Prämie, Selbstbehalt, Deckungen als freie Zeilen („wofür bin ich versichert?"), Dokumente, Angebote zum Vergleich; Vergleichsansicht für bis zu vier Policen nebeneinander, regelbasierter Deckungs-Check auf Lücken, Erinnerung vor Ablauf der Kündigungsfrist, Prämie per Klick als Dauerbuchung
- **Vorsorge (privat pro Benutzer)** — Schweizer 3-Säulen-Prinzip: Lohn & Abzüge (fix oder monatlich variabel), **AHV mit echter Rentenberechnung** (Rentenformel nach Art. 34 AHVG, Beitragsjahre aus dem IK-Auszug, Rentenskala und Beitragslücken, Erziehungs- und Betreuungsgutschriften, flexibler Rentenbezug mit Vorbezug/Aufschub/Teilrente im Variantenvergleich, 13. Altersrente, Plafonierung für Ehepaare und Einkommensteilung nach beidseitiger Verknüpfung), Pensionskasse, Säule 3a mit Dokument-Anhängen, Änderungshistorie und Altersprognose (Kapitalentwicklung, Rente, Ersatzrate); optional mit Konten verknüpfbar, Nettolohn per Klick als Dauerbuchung
- **Bericht (Export)** — Konten und ihre Verwendung als Dokument zum Mitnehmen ins Bank- oder Beratungsgespräch: frei wählbare Abschnitte (Konten, Sparziele, Hypotheken, Vorsorge, Versicherungen, Cashflow der letzten 12 Monate, Fixkosten, Nettovermögens-Prognose) als **PDF-Bericht** oder als **Excel-Mappe** mit einem Blatt je Abschnitt und Beträgen als echten Zahlen. Beide Formate entstehen serverseitig ohne zusätzliche Abhängigkeit
- **Benutzer & Login** — Ersteinrichtungs-Wizard, E-Mail/Passwort-Login, optionale 2FA (TOTP), Einladungslinks, Admin-Verwaltung, Aktivitäts-Log
- **Offline auf dem Handy** — die App lässt sich zum Home-Bildschirm hinzufügen und funktioniert **auch ohne Verbindung zum Heimserver vollständig**: Buchungen erfassen und bearbeiten, Budgets, Sparziele, Prognosen, Vorsorge, Hypotheken, Versicherungen und Belege. Im Heimnetz holt sie sich die neueste Version und gleicht alle Daten in beide Richtungen ab. Ändert dieselbe Buchung jemand zuhause und du unterwegs, führt die App verschiedene Felder selbst zusammen (nachvollziehbar protokolliert) und fragt nur bei echten Kollisionen — Feld für Feld, unter „Abgleich". Voraussetzung: HTTPS im Heimnetz (siehe unten)
- **Rundherum** — Benachrichtigungen (opt-in, ntfy/Webhook), Backup/Restore, Dark Mode, Zahlen- und Datumsformate nach Systemregion, 20 Währungen

## Screenshots

![Dashboard — Vermögen, Cashflow und Ausgaben nach Kategorie auf einen Blick](docs/screenshots/dashboard.png)

![Transaktionen — Suche, Filter, Tags und Belege pro Buchung](docs/screenshots/transaktionen.png)

![Konten — Salden, Bank & IBAN, aufklappbarer Saldo-Verlauf](docs/screenshots/konten.png)

![Budgets — Limits mit Fortschritt und Rollover](docs/screenshots/budgets.png)

![Kostenaufteilung — Salden und Ausgleichsvorschläge mit 1-Klick-Verbuchung](docs/screenshots/splitting.png)

![Sparziele — konto-verknüpfter Fortschritt mit Herkunft und Prognose](docs/screenshots/sparziele.png)

![Auswertung — Jahresvergleich pro Kategorie](docs/screenshots/auswertung.png)

| Dark Mode | Mobil |
|---|---|
| ![Dashboard im Dark Mode](docs/screenshots/dashboard-dark.png) | ![Dashboard auf dem Handy](docs/screenshots/mobile-dashboard.png) |

## Architektur

- **Frontend**: React 19 + TypeScript + Vite + Tailwind + shadcn/ui + Recharts
- **Backend**: Hono + tRPC (End-to-end typisiert), Sessions via signiertem HttpOnly-Cookie
- **Datenbank**: SQLite über sql.js (WebAssembly, Drizzle ORM) — eine Datei,
  ideal fürs Self-Hosting; keine nativen Module, kein Compile-Step beim Installieren
- **Offline**: Ein Service Worker führt dieselbe SQLite-Datenbank als Kopie im
  Browser und beantwortet die API von dort — mit demselben Code, der auf dem
  Server läuft. Deshalb rechnet die App unterwegs weiter, statt nur
  gespeicherte Antworten zu zeigen. Der Abgleich läuft zeilenweise mit
  Drei-Wege-Vergleich; jedes Gerät vergibt IDs aus einem eigenen Zahlenraum
- **Hintergrundjobs**: node-cron (tägliche Verbuchung wiederkehrender Transaktionen)
- Alle Geldbeträge werden intern in Cent (Integer) gespeichert.

## Self-Hosting auf dem Heimserver

### Docker (empfohlen)

```bash
# Optional: eigenes Secret setzen
export JWT_SECRET="$(openssl rand -hex 32)"
export PUBLIC_URL="http://192.168.1.10:8080"   # so erreichst du die App im Heimnetz

# Variante A: fertiges Image von ghcr.io verwenden (empfohlen)
docker compose pull
docker compose up -d

# Variante B: Image lokal bauen
docker compose up -d --build
```

Die App läuft danach unter `http://<heimserver>:8080`.
Die Datenbank liegt im Docker-Volume `finance-fox-data` —
für Backups genügt es, dieses Volume (bzw. die `.db`-Datei) zu sichern.

**Einladungs- und Passwort-Reset-Links** werden im Container-Log ausgegeben:

```bash
docker logs finance-fox
```

Wer über **Portainer** aufsetzt, kann keine Dateien neben das Compose-File
legen — dafür gibt es einen eigenen, direkt einfügbaren Stack weiter unten
unter [Portainer](#portainer-stack-ohne-datei-upload).

### Ohne Docker

```bash
npm ci
npm run build
JWT_SECRET="langer-zufallsstring" PUBLIC_URL="http://localhost:3000" npm start
```

### HTTPS im Heimnetz (für die Offline-App)

Die App lässt sich auf dem iPhone zum Home-Bildschirm hinzufügen und dann auch
**ohne Verbindung zum Heimserver** benutzen (siehe „Offline-Betrieb"). Dafür
braucht der Browser einen sogenannten *secure context* — also `https://` oder
`localhost`. Ein Aufruf über `http://192.168.1.10:8080` genügt **nicht**: dort
registriert iOS Safari keinen Service Worker, und ohne den gibt es keinen
Offline-Betrieb. Die App weist im Bereich Einstellungen darauf hin, wenn sie in
einem unsicheren Kontext läuft.

Wer bereits einen Reverse-Proxy mit gültigem Zertifikat betreibt (Traefik,
Nginx Proxy Manager, eigene Caddy-Instanz), stellt Finance Fox einfach dahinter
und ist fertig. Für alle anderen liegt ein fertiges Profil bei:

```bash
# 192.168.1.10 durch die Adresse ersetzen, unter der ihr die App aufruft
export FF_PUBLIC_HOST="192.168.1.10"
export PUBLIC_URL="https://192.168.1.10"

docker compose --profile tls up -d
```

Caddy stellt das Zertifikat mit einer **eigenen lokalen CA** aus — ohne
Internet, ohne Domain, ohne Let's Encrypt. Die App läuft danach unter
`https://192.168.1.10` (Port 443).

Damit die Geräte dem Zertifikat vertrauen, muss das Root-Zertifikat dieser CA
einmalig auf jedes Gerät:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./finance-fox-ca.crt
```

**Auf dem iPhone** (zwei Schritte — der zweite wird gerne vergessen):

1. `finance-fox-ca.crt` aufs Gerät bringen (AirDrop, Mail an sich selbst oder
   im Safari herunterladen) und antippen → *Einstellungen* → *Profil geladen* →
   **Installieren**.
2. *Einstellungen* → *Allgemein* → *Info* → **Zertifikatsvertrauenseinstellungen**
   → Finance Fox aktivieren. Ohne diesen Schritt bleibt das Zertifikat
   installiert, aber ungültig.

Auf macOS: Doppelklick auf die Datei → Schlüsselbundverwaltung → *System* →
Zertifikat auf „Immer vertrauen" stellen. Unter Android/Windows analog über
den jeweiligen Zertifikatsspeicher.

Danach die App unter `https://…` aufrufen und zum Home-Bildschirm hinzufügen.

### Portainer (Stack ohne Datei-Upload)

Portainers Stack-Editor nimmt **eine** Compose-Datei entgegen — Dateien
daneben gibt es dort nicht. Das `docker-compose.yml` aus diesem Repo setzt
aber zwei davon voraus: `./Caddyfile` (eingehängt in den Caddy-Container) und
das Build-Verzeichnis hinter `build: .`. Ohne das `Caddyfile` startet Caddy mit
seiner Standardseite statt als Reverse-Proxy — kein HTTPS, und damit kein
Offline-Betrieb.

Beides lässt sich auflösen: Die Caddy-Konfiguration wandert über `configs` in
das Compose-File selbst, `build:` fällt weg. Dieser Stack ist vollständig und
lässt sich direkt einfügen:

```yaml
services:
  finance-fox:
    image: ghcr.io/grimbixcode/finance-fox:latest
    container_name: finance-fox
    ports:
      - "8080:3000"   # optional, aber praktisch solange dem Zertifikat noch kein Gerät traut
    environment:
      - JWT_SECRET=${JWT_SECRET:-please-change-me-to-a-long-random-string}
      - PUBLIC_URL=${PUBLIC_URL:-https://localhost}
      - DATABASE_URL=file:/app/data/finance-fox.db
    volumes:
      - finance-fox-data:/app/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    container_name: finance-fox-caddy
    ports:
      - "80:80"
      - "443:443"
    environment:
      - FF_PUBLIC_HOST=${FF_PUBLIC_HOST:-localhost}
    configs:
      - source: caddyfile
        target: /etc/caddy/Caddyfile
    volumes:
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - finance-fox
    restart: unless-stopped

configs:
  caddyfile:
    content: |
      {$$FF_PUBLIC_HOST:localhost} {
        tls internal
        encode zstd gzip
        reverse_proxy finance-fox:3000
      }

volumes:
  finance-fox-data:
  caddy-data:
  caddy-config:
```

Unter *Environment variables* gehören drei Werte hinein:

| Variable | Beispiel | Wozu |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` | Signatur der Login-Cookies — unbedingt setzen |
| `FF_PUBLIC_HOST` | `192.168.1.10` | Adresse, für die Caddy das Zertifikat ausstellt |
| `PUBLIC_URL` | `https://192.168.1.10` | **mit `https://`** — sonst stehen falsche Adressen in den Einladungslinks und das Session-Cookie bekommt kein Secure-Flag |

> **Das doppelte `$` ist kein Tippfehler.** Compose ersetzt `$…` auch
> *innerhalb* von `content`. Mit einem einfachen `$` verschluckt es Caddys
> eigenen Platzhalter, und im Container landet eine kaputte Adresse:
>
> | im Compose-File | was im Container ankommt |
> |---|---|
> | `{$FF_PUBLIC_HOST:localhost}` | `{192.168.1.10:localhost}` ❌ |
> | `{$$FF_PUBLIC_HOST:localhost}` | `{$FF_PUBLIC_HOST:localhost}` ✅ |
>
> `$$` ist die Escape-Schreibweise von Compose; Caddy löst den Platzhalter
> dann selbst aus seiner Umgebungsvariablen auf.

Danach wie oben beschrieben das Root-Zertifikat der internen CA auf die Geräte
bringen — der Pfad im Container ist derselbe:

```bash
docker cp finance-fox-caddy:/data/caddy/pki/authorities/local/root.crt ./finance-fox-ca.crt
```

`configs` mit `content` gibt es seit **Docker Compose 2.23.1** (November 2023);
auf dem Heimserver zeigt `docker compose version`, was installiert ist. Ist die
Portainer-Installation älter, den Stack stattdessen **aus dem Git-Repository**
anlegen — dann liegt das `Caddyfile` daneben und das normale
`docker-compose.yml` funktioniert unverändert.

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
