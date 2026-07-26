# Finance Fox — Feature-Roadmap

Dieses Dokument analysiert den aktuellen Funktionsumfang von Finance Fox,
sammelt sinnvolle Erweiterungen und ordnet sie zu einer Roadmap. Es ergänzt
`README.md` (Nutzung) und `AGENTS.md` (Technik) um eine produktseitige
Perspektive.

## Leitplanken (nicht verhandelbar)

Jede Erweiterung muss zu diesen Grundsätzen passen:

- **Self-hosted bleibt Pflicht.** Keine Funktion darf einen externen Server
  des Projekts, ein Pflicht-Konto oder eine Cloud-Komponente voraussetzen.
- **Kein SaaS-Betrieb.** Kein Abo, kein Lizenzserver, kein Nutzungs-Tracking,
  kein "Call home". Alles läuft in der eigenen Docker-Instanz.
- **Zielgruppe ist der Mehrpersonen-Haushalt** (Paare, WGs, Familien) — nicht
  Einzelnutzer-Buchhaltung, nicht B2B/Freelancer-Rechnungswesen.
- Optionale externe Integrationen (Bank-Import, Benachrichtigungen) müssen
  **opt-in**, lokal konfigurierbar und ohne Anthropic/Drittanbieter-Pflicht
  sein (z. B. selbstgehostetes ntfy statt eines proprietären Push-Diensts).

## 1. Analyse: Aktueller Funktionsumfang

| Bereich | Status heute |
|---|---|
| **Dashboard** | Gesamtvermögen, Einnahmen/Ausgaben, Sparrate, Cashflow- & Kategorien-Charts |
| **Transaktionen** | Einnahmen/Ausgaben/Umbuchungen, Suche & Filter, eine Kategorie pro Buchung |
| **Konten** | Giro/Bargeld/Sparkonto, Saldo wird aus Buchungen berechnet (kein manueller Kontoabgleich) |
| **Kategorien** | Flache Liste (keine Über-/Unterkategorien), fixe Farbe |
| **Budgets** | Ein monatliches Limit pro Kategorie, Fortschrittsanzeige, kein Rollover, keine Jahresbudgets |
| **Kostenaufteilung** | Splits pro Transaktion, Salden zwischen Personen, Ausgleichsvorschläge (nur 1 Haushalt, kein Gruppen-/Projektkonzept) |
| **Wiederkehrende Buchungen** | Intervalle weekly/monthly/yearly, täglicher Cron-Job verbucht Fälliges automatisch |
| **Sparziele** | Zielbetrag, Stichtag, Fortschritt — Zuweisung des gesparten Betrags ist manuell |
| **Prognosen** | Kontostand-Prognose inkl. Dauerbuchungen, Budget-Hochrechnung, Sparziel-ETA — ein Szenario, keine "Was-wäre-wenn"-Varianten |
| **Benutzer & Auth** | Setup-Wizard, E-Mail/Passwort, Einladungslinks (nur im Server-Log, kein Mailversand), Admin/Member-Rollen, keine 2FA |
| **Daten & Betrieb** | SQLite-Datei via sql.js, ein Docker-Container, keine Backup-Funktion in der UI, kein Datenexport, keine PWA/Offline-Fähigkeit |

**Kurz gesagt:** Der Kern (Buchen, Budgetieren, Splitten, Prognostizieren)
ist solide und bereits mehrpersonentauglich. Es fehlen vor allem: Im-/Export,
Belege/Anhänge, Struktur bei Kategorien/Budgets (Gruppen, Rollover),
Benachrichtigungen, Datensicherung aus der UI und Barrierefreiheit für den
Alltag auf dem Handy (PWA).

## 2. Erweiterungsideen

### A. Transaktionen & Kategorien
- Tags/Labels zusätzlich zur Kategorie (mehrere pro Buchung), Volltextsuche über Notizen
- Beleg-/Foto-Anhänge pro Transaktion (lokal im Volume gespeichert)
- Ober-/Unterkategorien (z. B. "Wohnen" → "Strom", "Miete")
- CSV-Import (Kontoauszug) mit Kategorie-Mapping-Regeln; CSV-Export aller Transaktionen
- Massenbearbeitung (mehrere Buchungen markieren → Kategorie/Tag ändern)
- Split-Transaktionen nach Kategorie (eine Buchung, mehrere Kategorien/Beträge)

### B. Konten
- Manueller Kontoabgleich (Ist-Saldo erfassen, Differenz als Korrekturbuchung)
- Kreditkarten-/Darlehenskonto-Typ mit Zinsen/Sollzins-Feld
- Saldo-Verlaufschart pro Konto (Historie, nicht nur aktueller Stand)
- Mehrwährungs-Konten (Fremdwährungskonto mit Umrechnungskurs, ergänzend zur haushaltsweiten Leitwährung)

### C. Budgets
- Jahres- und Wochenbudgets zusätzlich zu monatlichen
- Rollover-Option (Restbudget in Folgemonat übernehmen)
- Envelope-/Umschlag-Budgetierung als Alternative zur Kategorie-Grenze
- Budget-Vorlagen pro Kategorie-Gruppe

### D. Kostenaufteilung
- Aufteilungsvorlagen (z. B. 60/40 statt nur gleichmäßig/individuell), gespeichert pro Kategorie oder Person
- Ausgleichszahlung direkt als Umbuchung verbuchen (1 Klick aus dem Ausgleichsvorschlag)
- "Projekte"/Gruppen innerhalb des Haushalts (z. B. gemeinsamer Urlaub separat von laufenden Haushaltskosten)

### E. Sparziele
- Mehrere Beitragszahler pro Ziel mit Einzel-Fortschritt
- Automatische Zuweisung von Budget-Überschüssen an ein Ziel (Regel-basiert)
- Ziel-Kategorien/Icons (Notgroschen, Urlaub, Anschaffung)

### F. Prognosen & Auswertungen
- Szenario-Planung ("Was, wenn Gehalt X% steigt / Ausgabe Y wegfällt")
- Jahresrückblick/-vergleich (Vorjahresvergleich je Kategorie)
- Netto-Vermögensentwicklung über Zeit (inkl. Sparziele, Schulden)
- Report-Export als PDF/CSV für Steuerunterlagen oder eigene Archivierung

### G. Benachrichtigungen (self-hosted, opt-in)
- Budget-Überschreitung, fällige wiederkehrende Buchung, Sparziel-Meilenstein
- Anbindung an selbstgehostete Kanäle: ntfy, Apprise, Gotify, Webhook — **kein**
  Pflicht-E-Mail-Versand über Drittanbieter; SMTP-Konfiguration bleibt optional
  und lokal (eigener Mailserver des Nutzers)

### H. Import/Export & Datensicherheit
- Backup-/Restore-Knopf in den Einstellungen (DB-Datei herunterladen/wiederherstellen)
- Vollständiger Datenexport (JSON/CSV) für Portabilität — wichtig gerade *weil*
  self-hosted: Nutzer sollen jederzeit ohne Lock-in exportieren können
- Optionale FinTS/HBCI- oder CAMT.053-Unterstützung für (deutsche) Banken —
  strikt lokal, keine Drittanbieter-Aggregation der Kontodaten

### I. Mobile & Bedienung
- PWA (Installierbar, Offline-Zugriff auf zuletzt geladene Daten)
- Schnellerfassung (ein Tap → Standardkategorie/-konto, für unterwegs)
- Dashboard-Widgets konfigurierbar/sortierbar pro Nutzer

### J. Benutzerverwaltung & Sicherheit
- 2FA/TOTP für Login
- Feingranulare Rollen (z. B. "nur lesen"-Gast, Kinder-Profil mit Ausgabenlimit)
- Aktivitäts-/Audit-Log ("Wer hat was gebucht/geändert")
- E-Mail-Versand für Einladungen/Reset optional über selbstkonfigurierten SMTP
  (statt nur Server-Log) — weiterhin ohne Pflicht-Cloud-Dienst

### K. Internationalisierung & Anpassung
- i18n-Grundgerüst (DE bleibt Standard/Quelle, EN als zweite Sprache)
- Vollständiger Dark-Mode-Toggle (next-themes ist bereits Abhängigkeit, aber
  ungenutzt — aktuell kein Umschalter im UI)
- Individuelle Kategorie-Icons/Farben statt fixer Farbliste

## 3. Priorisierte Roadmap

### Phase 1 — Fundament & Alltagstauglichkeit (kurzfristig)
Fokus: Dinge, die *jeder* Haushalt sofort spürt, geringes Risiko, baut auf
bestehendem Schema auf.

1. Backup-/Restore-Funktion in den Einstellungen (Datensicherheit ohne Docker-CLI)
2. CSV-Export aller Transaktionen (+ einfacher CSV-Import)
3. Beleg-/Foto-Anhänge an Transaktionen
4. Ausgleichszahlung aus der Kostenaufteilung mit einem Klick verbuchen
5. Dark-Mode-Toggle im UI (next-themes ist schon vorhanden)
6. PWA-Grundgerüst (installierbar, Manifest, Icons)

### Phase 2 — Struktur & Auswertung (mittelfristig)
Fokus: Tiefere Funktionalität für Budgetierung und Reporting.

1. Ober-/Unterkategorien
2. Budget-Rollover + Jahresbudgets
3. Jahresrückblick/Vorjahresvergleich, PDF-Export von Reports
4. Szenario-Planung in den Prognosen
5. Benachrichtigungen via ntfy/Apprise/Webhook (Budget-Warnungen, fällige Buchungen)
6. Manueller Kontoabgleich

### Phase 3 — Sicherheit, Skalierung im Haushalt (längerfristig)
Fokus: Größere Haushalte, mehr Sicherheit, mehr Automatisierung.

1. 2FA/TOTP, Audit-Log, feingranulare Rollen (Gast, Kind)
2. Mehrere Beitragszahler pro Sparziel, automatische Überschuss-Zuweisung
3. Aufteilungsvorlagen & "Projekte" in der Kostenaufteilung
4. Optionaler FinTS/CAMT-Bankimport (strikt lokal)
5. i18n (DE/EN)
6. Kreditkarten-/Darlehenskonten mit Zins-Tracking, Mehrwährungs-Konten

### Bewusst zurückgestellt / Nicht-Ziele
- Kein Multi-Tenant-Betrieb für fremde Haushalte auf einer Instanz (jede
  Installation bleibt ein Haushalt — passt nicht zum Self-Hosting-Gedanken)
- Keine Bank-Aggregation über Drittanbieter-APIs, die Zugangsdaten extern
  speichern (z. B. klassische Fintech-SaaS-Aggregatoren)
- Keine Pflicht-Cloud-Synchronisierung; wenn Multi-Device-Sync später gewünscht
  ist, dann nur als selbstgehostete Option (z. B. eigener Reverse-Proxy/VPN),
  nie als gehosteter Dienst des Projekts

## 4. Nächste Schritte

Diese Roadmap ist eine Diskussionsgrundlage. Empfehlung: Phase 1 zuerst als
GitHub Issues aufbrechen (ein Issue pro Punkt), da diese Punkte unabhängig
voneinander sind und schnell Nutzen stiften, ohne das Datenschema grundlegend
zu ändern.
