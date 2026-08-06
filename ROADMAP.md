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
| **Wiederkehrende Buchungen** | Intervalle wöchentlich bis jährlich (auch viertel- & halbjährlich), Dauer-Umbuchungen zwischen Konten, Pausieren und optionales Enddatum (abgelaufen = archiviert), täglicher Cron-Job verbucht Fälliges automatisch — keine freien Intervalle (z. B. alle 2 Wochen) |
| **Sparziele** | Zielbetrag, Stichtag, Fortschritt aus verknüpften Konten (ganzes Konto / fixer Anteil / Prozent, Sichtbarkeitsfilter), Herkunfts-Aufschlüsselung inkl. Alt-Bestand, ETA-Prognose über Dauerbuchungen |
| **Prognosen** | Kontostand-Prognose inkl. Dauerbuchungen, Budget-Hochrechnung, Sparziel-ETA, Prognose-Tabelle (Horizont bis 10 Jahre, Spalten je Monat/Quartal/Halbjahr/Jahr) — ein Szenario, keine "Was-wäre-wenn"-Varianten |
| **Benutzer & Auth** | Setup-Wizard, E-Mail/Passwort, Einladungslinks (Server-Log), Admin/Member-Rollen, keine 2FA |
| **International** | Zahlen- und Datumsformate folgen der Systemregion (z. B. de-DE `1.234,56` vs. de-CH `1'234.56`), haushaltsweite Leitwährung (20 Währungen), UI-Sprache Deutsch |
| **Hypotheken** | Liegenschaft mit Verkehrswert, Tranchen (Fest/SARON/variabel), direkte & indirekte Amortisation, Belehnung, Tragbarkeit, Schuldenverlauf, Nettovermögen; Übernahme als Dauerbuchung |
| **Versicherungen** | Policen des Haushalts (gemeinsam & personenbezogen) mit Sparte, Prämie, Selbstbehalt, freien Deckungs-Zeilen, Dokumenten und Angeboten; Vergleich von bis zu vier Policen, regelbasierter Deckungs-Check, Kündigungsfrist-Erinnerung, Übernahme als Dauerbuchung |
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
- ✅ Buchungen bearbeiten mit Änderungshistorie (Stift-Button in der
  Transaktionsliste, type unveränderlich, optionaler Änderungskommentar,
  serverseitiges Feld-Diff in `transaction_changes`, „bearbeitet"-Badge
  öffnet den Änderungsverlauf)
- Tags/Labels zusätzlich zur Kategorie (mehrere pro Buchung), Volltextsuche über Notizen ✅
  (Tags haushaltsweit: `tags`/`transaction_tags`, Verwaltung in den Einstellungen,
  Auswahl im Buchungsdialog, Filter + Badges + Tag-Suche in der Transaktionsliste;
  die Notizsuche existierte bereits und durchsucht jetzt auch Tag-Namen)
- Massenbearbeitung (mehrere Buchungen markieren → Kategorie/Tag ändern)
- Split-Transaktionen nach Kategorie (eine Buchung, mehrere Kategorien/Beträge)
- CSV-Import mit Kategorie-Mapping-Regeln (lernende Zuordnung statt nur Name)

### B. Konten
- ✅ Saldo-Verlaufschart pro Konto (Historie, nicht nur aktueller Stand)
- Freie Anordnung (Drag & Drop) mit persistierten Positionen für das
  Geldfluss-Diagramm — als spätere Ergänzung des automatischen
  Spalten-Layouts vorgemerkt

### C. Budgets
- Envelope-/Umschlag-Budgetierung als Alternative zur Kategorie-Grenze
- Budget-Vorlagen pro Kategorie-Gruppe

### D. Kostenaufteilung
- Aufteilungsvorlagen (z. B. 60/40 statt nur gleichmäßig/individuell), gespeichert pro Kategorie oder Person

### E. Prognosen & Auswertungen
- ✅ Netto-Vermögensentwicklung über Zeit (inkl. Schulden) — `forecast.balance`
  liefert eine `netWorth`-Reihe (Kontosalden + Verkehrswert − Restschuld),
  die Prognose-Seite zeigt sie als dritte Linie. Sparziele bleiben offen.
- ✅ Sparziele an Konten knüpfen („Sparziele 2.0", aus Nutzerwunsch):
  Fortschritt aus verknüpften Konten (Modi ganzes Konto / absoluter Betrag /
  Prozent) statt manueller Einzahlungen, Herkunfts-Aufschlüsselung,
  ETA-Prognose über Dauerbuchungen auf den verknüpften Konten;
  manuelle Einzahlungen/Beiträge gesperrt (Alt-Bestand bleibt lesbar).
  Davon unberührt bleibt der weiterhin offene Punkt „Automatische Zuweisung
  von Budget-Überschüssen an Sparziele".
- ✅ Prognose-Tabelle mit frei wählbarem Horizont und Aggregationsgröße
  (`forecast.table`): Kontosalden, Sparziel-Fortschritt (offene Ziele ohne
  Zielbetrag inklusive), Ein-/Ausgaben und Nettovermögen je Periode, Ø
  variabler Buchungen zuschaltbar; zusätzlich eine Prognose-Fortsetzung im
  Saldo-Verlauf der Konten-Seite (`forecast.accountBalance`). Die
  Dauerbuchungs-Simulation liegt dafür zentral in `api/lib/forecastEngine.ts`
  — vorher dreifach kopiert, wobei die Prognose-Kopien `endDate` ignorierten.
- Automatische Zuweisung von Budget-Überschüssen an Sparziele (unverbrauchtes
  Budget periodisch auf ein verknüpftes Ziel-Konto umbuchen)

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

### Phase 4 — Vorsorge & Altersprognose ✅ *vollständig umgesetzt*

1. **Vorsorge-Modul (Schweizer 3-Säulen-Prinzip)** als eigenständiges,
   privates Modul pro Benutzer (Route `/vorsorge`): Bruttolohn-Timeline
   (fix oder monatlich variabel für Schicht/Stundenlohn/Spesen) mit frei
   definierbaren Abzügen (Prozent- oder Fixbeträge) → Netto-Berechnung;
   AHV-Daten (1. Säule), Pensionskasse & Freizügigkeitskonten (2. Säule),
   Säule-3a-Konten — jeweils mit Datei-Anhängen (Reglemente, Auszüge) und
   lückenloser Änderungshistorie. Die Architektur (`country`-Feld,
   austauschbare Prognose-Engine) hält spätere Ländermodelle offen.
2. **Altersprognose**: monatliche Simulation der Kapitalentwicklung bis
   zur Pensionierung (Säule 2 mit Umwandlungssatz, 3a mit Entnahmeplan,
   AHV-Schätzung), monatliches Einkommen im Alter und Ersatzrate zum
   heutigen Netto, Warnungen bei fehlenden Daten.
3. **Optionale Verknüpfung mit dem Finanzmodul**: 3a-Konten können an
   Finanz-Konten geknüpft werden (Saldo-Sync; in Sparzielen verplante
   Anteile werden abgezogen und mit Hinweis ausgewiesen — keine
   Doppelzählung), und das berechnete Netto lässt sich per Klick als
   wiederkehrende Einnahme übertragen (Kopie, kein Live-Sync).
   Nicht-Ziel bleibt die Anbindung von Pensionskassen-APIs.

### Phase 5 — Wohneigentum ✅ *vollständig umgesetzt*

1. **Hypotheken-Modul** (Route `/hypotheken`) als haushaltsweites Gegenstück
   zur privaten Vorsorge: Liegenschaft (Verkehrswert mit Stichtag, Nutzung,
   Bruttojahreseinkommen für die Tragbarkeit) plus beliebig viele Tranchen
   (Festhypothek, SARON mit Marge, variabel) mit eigenem Zinssatz, Ablauf
   der Zinsbindung und Zahlungsrhythmus. Direkte Amortisation senkt die
   Restschuld, indirekte zahlt auf ein Säule-3a-/Sparkonto ein.
   Änderungshistorie wie im Vorsorge-Modul.
2. **Belehnung & Tragbarkeit nach Schweizer Praxis**: 1./2. Hypothek,
   maximale Belehnung, kalkulatorischer Zins, Unterhaltspauschale und die
   Pflicht-Amortisation — alle fünf Bank-Parameter pro Objekt
   überschreibbar, weil sie je nach Bank und Nutzungsart abweichen.
   Warnungen bei überschrittener Belehnung, Untragbarkeit, ungedeckter
   Amortisationspflicht, veraltetem Restschuld-Stichtag und ablaufender
   Zinsbindung (zusätzlich als Benachrichtigung 90/30 Tage vorher).
3. **Nettovermögen** an drei Stellen: eigene Karte im Modul, Zusatzzeile
   „inkl. Immobilie" auf dem Dashboard und eine Vermögens-Zeitreihe in den
   Prognosen. Die Architektur (`country`-Feld, austauschbare
   Berechnungs-Engine) hält spätere Ländermodelle offen.
4. **Übernahme als Dauerbuchung**: Zins und Amortisation lassen sich per
   Klick als wiederkehrende Buchung anlegen (Kopie, kein Live-Sync).
   Dafür kennen Dauerbuchungen jetzt auch **viertel- und halbjährliche**
   Intervalle — Schweizer Hypothekarzins wird quartalsweise belastet.

Nicht-Ziel bleibt die Anbindung von Banken-APIs; Zinssätze und Restschuld
werden von Hand gepflegt.

### Phase 6 — Versicherungen ✅ *vollständig umgesetzt*

1. **Versicherungs-Modul** (Route `/versicherungen`) als zweites
   haushaltsweites Modul neben den Hypotheken: alle Policen zentral, mit
   Sparte aus einem festen Katalog (14 Sparten für den CH/DE-Haushalt),
   Versicherer, Prämie samt Zahlungsintervall, Selbstbehalt, Vertragsdaten
   und Kündigungsfrist. Die Zuordnung zu Personen ist reine Zuschreibung —
   keine Zuordnung heißt „gemeinsame Police"; sichtbar ist alles für alle,
   sonst könnte die Lückenanalyse nicht über den Haushalt rechnen.
   Änderungshistorie und Dokument-Anhänge wie im Vorsorge-Modul.
2. **Deckungen als freie Zeilen** (Bezeichnung, Summe, abweichender
   Selbstbehalt, Notiz) statt fester Felder pro Sparte — Versicherer
   benennen dieselbe Deckung unterschiedlich. Die Sparte liefert nur
   Vorschläge. Damit beantwortet das Modul die Alltagsfrage „wofür bin ich
   eigentlich versichert?" direkt auf der Karte, ohne Dialog.
3. **Vergleichsansicht**: bis zu vier Policen nebeneinander, inklusive
   Angeboten — genau der Fall, für den man vergleicht. Normalisierte
   Jahresprämie und vereinigte Deckungszeilen; der beste Wert je Zeile ist
   hervorgehoben.
4. **Deckungs-Check**: regelbasierte Hinweise auf fehlende Sparten (pro
   Person bzw. pro Haushalt), auf eine fehlende Gebäudeversicherung bei
   erfasstem Wohneigentum, auf auslaufende Deckungen ohne Nachfolge,
   nahende und verpasste Kündigungsfristen sowie Datenqualität. Einzelne
   Empfehlungen lassen sich mit Begründung ausblenden und zurückholen.
5. **Kündigungsfrist-Erinnerung** 90/30 Tage vorher (ntfy/Webhook) und
   **Übernahme der Prämie als Dauerbuchung** (Kopie, kein Live-Sync).

Nicht-Ziel bleibt die Anbindung von Versicherer-Portalen; Policen und
Deckungen werden von Hand gepflegt.

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
- **Kreditkarten- und Konsumkreditkonten mit Zins-Tracking.** Die
  Kontoführung selbst decken eigene Kontotypen bereits ab; Zins-/
  Tilgungsrechnung für Kleinkredite ist Buchhaltung, nicht
  Haushaltsüberblick. *(Eingegrenzt mit Phase 5: Die **Hypothek** ist
  ausgenommen — sie ist für einen Eigentümer-Haushalt kein Randfall,
  sondern der größte Fixposten und der größte Bilanzposten überhaupt.)*
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

Alle sechs Phasen sind umgesetzt. Als Nächstes stehen Kandidaten aus dem
Backlog (Abschnitt 3) zur Bewertung an — naheliegend: Massenbearbeitung,
CSV-Import mit Kategorie-Mapping-Regeln, Sparziele in der
Netto-Vermögensreihe.
Diese bei Bedarf als GitHub Issues aufbrechen und einzeln priorisieren.
Denkbar sind auch Erweiterungen des Vorsorge-Moduls (weitere
Ländermodelle neben CH, Kapitalbezug-vs-Rente-Szenarien).
