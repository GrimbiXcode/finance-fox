# Finance Fox — Feature-Roadmap

Dieses Dokument beschreibt den aktuellen Funktionsumfang von Finance Fox und
die geplanten Erweiterungen. Es ergänzt `README.md` (Nutzung) und `AGENTS.md`
(Technik) um eine produktseitige Perspektive.

**Produktleitbild:** Deutschsprachige Finanz-App für den Mehrpersonen-Haushalt
(Paare, WGs, Familien), self-hosted in einem Docker-Container, alltagstauglich
auf dem Handy, ohne Cloud-Zwang. Bewusst einfach statt buchhalterisch
vollständig — Ziel ist ein schneller, geteilter Überblick über das
Haushaltsgeld, nicht das Rechnungswesen.

## Leitplanken (nicht verhandelbar)

Jede Erweiterung muss zu diesen Grundsätzen passen:

- **Self-hosted bleibt Pflicht.** Keine Funktion darf einen externen Server
  des Projekts, ein Pflicht-Konto oder eine Cloud-Komponente voraussetzen.
- **Kein SaaS-Betrieb.** Kein Abo, kein Lizenzserver, kein Nutzungs-Tracking,
  kein "Call home". Alles läuft in der eigenen Docker-Instanz.
- **Zielgruppe ist der Mehrpersonen-Haushalt** — nicht Einzelnutzer-
  Buchhaltung, nicht B2B/Freelancer-Rechnungswesen.
- Optionale externe Integrationen (Bank-Import, Benachrichtigungen) müssen
  **opt-in**, lokal konfigurierbar und ohne Drittanbieter-Pflicht sein
  (z. B. selbstgehostetes ntfy statt eines proprietären Push-Diensts).
- **Einfachheit vor Vollständigkeit.** Features, die nur ein kleines
  Power-User-Segment braucht, aber für alle Komplexität bringen, werden
  nicht gebaut.

## 1. Analyse: Aktueller Funktionsumfang

| Bereich | Status heute |
|---|---|
| **Dashboard** | Gesamtvermögen, Einnahmen/Ausgaben, Sparrate, Cashflow- & Kategorien-Charts |
| **Transaktionen** | Einnahmen/Ausgaben/Umbuchungen, Suche & Filter, eine Kategorie pro Buchung (inline anlegbar), Beleg-Anhänge (Foto/PDF), CSV-Export & -Import, entschlackte Erfassungsmaske |
| **Konten** | Eigene Kontotypen anlegbar (z. B. Säule 3a, Anlagekonto), Bank & IBAN, Bearbeiten-Dialog, Löschen nur mit Namensbestätigung, Besitz & Sichtbarkeit (privat vs. Gemeinschaftskonto, individuelle Ansehen-/Bearbeiten-Freigaben, serverseitig durchgesetzt) |
| **Kategorien** | Flache Liste (keine Über-/Unterkategorien), Inline-Anlage in der Erfassungsmaske, automatische Farbvergabe |
| **Budgets** | Ein monatliches Limit pro Kategorie, Fortschrittsanzeige, kein Rollover, keine Jahresbudgets |
| **Kostenaufteilung** | Splits pro Transaktion, Salden zwischen Personen, Ausgleichsvorschläge mit 1-Klick-Verbuchung (kein Gruppen-/Projektkonzept) |
| **Wiederkehrende Buchungen** | Intervalle weekly/monthly/yearly, täglicher Cron-Job verbucht Fälliges automatisch |
| **Sparziele** | Zielbetrag, Stichtag, Fortschritt — Zuweisung des gesparten Betrags ist manuell |
| **Prognosen** | Kontostand-Prognose inkl. Dauerbuchungen, Budget-Hochrechnung, Sparziel-ETA — ein Szenario, keine "Was-wäre-wenn"-Varianten |
| **Benutzer & Auth** | Setup-Wizard, E-Mail/Passwort, Einladungslinks (Server-Log), Admin/Member-Rollen, keine 2FA |
| **International** | Zahlen- und Datumsformate folgen der Systemregion (z. B. de-DE `1.234,56` vs. de-CH `1'234.56`), haushaltsweite Leitwährung (20 Währungen), UI-Sprache Deutsch |
| **Daten & Betrieb** | SQLite-Datei via sql.js, ein Docker-Container, Backup/Restore in den Einstellungen, CSV-Export, PWA (installierbar), Dark Mode |

**Kurz gesagt:** Kern und Alltagstauglichkeit stehen — buchen, teilen,
budgetieren, prognostizieren, sichern, auch unterwegs. Die nächsten Lücken
sind Struktur (Kategorie-Hierarchien, flexible Budgets), Auswertung über
längere Zeiträume und proaktive Hinweise (Benachrichtigungen).

## 2. Umgesetzte Roadmap-Punkte

Phase 1 (Fundament & Alltagstauglichkeit) ist vollständig umgesetzt:

1. ✅ Konten bearbeiten + entschärftes Löschen (Namensbestätigung)
2. ✅ Konten-Besitz & Sichtbarkeit (privat vs. Gemeinschaftskonto, Freigaben)
3. ✅ Backup/Restore in den Einstellungen
4. ✅ CSV-Export aller Transaktionen + einfacher CSV-Import
5. ✅ Beleg-/Foto-Anhänge an Transaktionen
6. ✅ Ausgleichszahlung mit einem Klick verbuchen
7. ✅ Dark-Mode-Toggle
8. ✅ PWA-Grundgerüst (installierbar, Manifest, Icons)

Darüber hinaus auf Nutzerwunsch umgesetzt: Locale-bewusste Zahlenformate,
eigene Kontotypen, Bank & IBAN, Inline-Kategorie-Anlage, überarbeitete
Erfassungsmaske.

## 3. Erweiterungsideen (Backlog, unbewertet)

### A. Transaktionen & Kategorien
- Tags/Labels zusätzlich zur Kategorie (mehrere pro Buchung), Volltextsuche über Notizen
- Massenbearbeitung (mehrere Buchungen markieren → Kategorie/Tag ändern)
- Split-Transaktionen nach Kategorie (eine Buchung, mehrere Kategorien/Beträge)
- CSV-Import mit Kategorie-Mapping-Regeln (lernende Zuordnung statt nur Name)

### B. Konten
- Saldo-Verlaufschart pro Konto (Historie, nicht nur aktueller Stand)

### C. Budgets
- Envelope-/Umschlag-Budgetierung als Alternative zur Kategorie-Grenze
- Budget-Vorlagen pro Kategorie-Gruppe

### D. Kostenaufteilung
- Aufteilungsvorlagen (z. B. 60/40 statt nur gleichmäßig/individuell), gespeichert pro Kategorie oder Person

### E. Prognosen & Auswertungen
- Netto-Vermögensentwicklung über Zeit (inkl. Sparziele, Schulden)

### F. Benutzerverwaltung & Sicherheit
- Feingranulare Rollen (z. B. "nur lesen"-Gast, Kinder-Profil mit Ausgabenlimit)
- E-Mail-Versand für Einladungen/Reset optional über selbstkonfigurierten SMTP

### G. Internationalisierung & Anpassung
- i18n-Grundgerüst (DE bleibt Standard/Quelle, EN als zweite Sprache)
- Individuelle Kategorie-Icons/Farben statt fixer Farbliste

## 4. Priorisierte Roadmap

### Phase 2 — Struktur & proaktiver Alltag ✅ *vollständig umgesetzt*

Fokus: bessere Einordnung der Buchungen, flexiblere Budgets, die App meldet
sich von selbst. Reihenfolge = empfohlene Umsetzungsreihenfolge.

1. **Ober-/Unterkategorien** (z. B. "Wohnen" → "Strom", "Miete"). ✅
2. **Budget-Rollover + Jahresbudgets.** ✅
3. **Benachrichtigungen via ntfy + generischem Webhook** (selbstgehostet,
   opt-in): Budget-Überschreitung, fällige wiederkehrende Buchung,
   Sparziel-Meilenstein. ✅
4. **Manueller Kontoabgleich** (Ist-Saldo erfassen, Differenz als
   Korrekturbuchung). ✅
5. **Schnellerfassung** (ein Tap → Standardkonto/-kategorie). ✅
6. **Jahresrückblick / Vorjahresvergleich** je Kategorie (im Web, ohne
   PDF — siehe Nicht-Ziele). ✅

### Phase 3 — Haushalts-Skalierung & Sicherheit ✅ *vollständig umgesetzt*

1. **"Projekte" in der Kostenaufteilung** (z. B. gemeinsamer Urlaub separat
   von laufenden Haushaltskosten) + Aufteilungsvorlagen (60/40 u. ä.).
   Der meistgefragte Haushaltsfall nach dem laufenden Splitten. ✅
2. **Mehrere Beitragszahler pro Sparziel** mit Einzel-Fortschritt — passt
   direkt zum Mehrpersonen-Leitbild. ✅
3. **CAMT.053-Bankimport (Datei-basiert)** als Nachfolger des einfachen
   CSV-Imports: ISO-20022-XML ist der Standard Schweizer (und zunehmend
   deutscher) Banken, strikt lokal parsebar, keine Drittanbieter. ✅
4. **2FA/TOTP** für den Login — sinnvoll, sobald die Instanz nicht nur im
   Heimnetz erreichbar ist. ✅
5. **Aktivitäts-/Audit-Log** ("Wer hat was gebucht/geändert") — klein
   gehalten: Chronik der fachlichen Mutationen pro Haushalt. ✅
6. **Szenario-Planung** in den Prognosen ("Was, wenn Gehalt X% steigt /
   Ausgabe Y wegfällt") — nützlich, aber klar hinter den Alltagsthemen. ✅

### Bewusst zurückgestellt / Nicht-Ziele

Mit Begründung — diese Punkte passen aktuell nicht zum Produktleitbild
("einfach statt buchhalterisch vollständig") oder ihr Nutzen deckt den
Aufwand nicht:

- **PDF-Report-Export.** CSV-Export + Browser-Druck decken Archivierung
  und Steuerbelege ab; eine PDF-Pipeline (Rendering, Fonts, Layout) ist
  unverhältnismäßig.
- **FinTS/HBCI-Live-Anbindung.** Hoher Implementierungs- und Wartungs-
  aufwand, fehleranfällig, nur deutsche Banken. Stattdessen: Datei-
  basierter CAMT.053-Import (Phase 3).
- **Mehrwährungs-Konten mit Kursumrechnung.** Erhebliche Komplexität
  (Kurse, Neubewertung, Summenlogik) für einen Randfall; die haushalts-
  weite Leitwährung reicht dem Leitbild. Workaround: Umbuchung mit Kurs
  in der Notiz.
- **Kreditkarten-/Darlehenskonten mit Zins-Tracking.** Die Kontoführung
  selbst decken eigene Kontotypen bereits ab; Zins-/Tilgungsrechnung ist
  Buchhaltung, nicht Haushaltsüberblick.
- **i18n (EN als Zweitsprache).** Das Produkt ist bewusst deutschsprachig;
  der Umbau aller UI-Texte lohnt sich erst bei echter Nachfrage außerhalb
  des DACH-Raums.
- **Feingranulare Rollen (Gast/Kind).** Die Konto-Sichtbarkeit (privat,
  Ansehen, Bearbeiten) deckt die meisten Fälle bereits ab; echte Rollen
  erst bei konkretem Bedarf.
- **Multi-Tenant-Betrieb für fremde Haushalte** auf einer Instanz — jede
  Installation bleibt ein Haushalt.
- **Bank-Aggregation über Drittanbieter-APIs**, die Zugangsdaten extern
  speichern, und jede Form von Pflicht-Cloud-Synchronisierung.

## 5. Nächste Schritte

Alle drei Phasen sind umgesetzt. Als Nächstes stehen Kandidaten aus dem
Backlog (Abschnitt 3) zur Bewertung an — naheliegend: Tags/Labels,
Massenbearbeitung, Saldo-Verlaufschart pro Konto, CSV-Import mit
Kategorie-Mapping-Regeln. Diese bei Bedarf als GitHub Issues aufbrechen
und einzeln priorisieren.
