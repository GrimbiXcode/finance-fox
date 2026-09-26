# Usability-Analyse & User Stories — Finance Fox

Stand: Version 1.31.0 (September 2026). Ergänzt `ROADMAP.md` (Funktionsumfang)
um die Frage: **Wie fühlt sich die App im Alltag an — und wo verliert sie
Nutzer, Zeit oder Erkenntnis?** Jede Beobachtung mündet in eine User Story mit
Akzeptanzkriterien und einem Prüfschritt, damit sich Lücken nachvollziehbar
finden und geschlossene Lücken abhaken lassen.

## Umsetzungsstand

Welle 1 ist umgesetzt (Stand: Branch `claude/app-usability-analysis-d06w62`):

| Story          | Umsetzung                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| K2             | `npm run seed:demo` (`scripts/seed-demo.mjs`) — Musterhaushalt über die tRPC-API                                     |
| J1             | Kennzahlen mit `tabular-nums`, Beträge brechen nicht mehr um (`index.css`)                                           |
| J2, J3 (teils) | Kompakte Geld-Achsen `axisMoney`; schräge Kategorie-Labels in der Auswertung; weniger Datums-Ticks im Konten-Verlauf |
| J5             | Prozentwerte der Sparziele ohne Umbruch                                                                              |
| A1             | Startkategorien: Wizard-Schritt, „Vorschläge ergänzen“ in den Einstellungen, idempotenter Endpunkt mit Tests         |
| A2             | „Erste Schritte“-Zettel auf dem Dashboard mit direkten Aktionen                                                      |
| A6 (teils)     | Filter der Transaktionen und Monat des Dashboards in der URL                                                         |
| B2             | „Speichern & weitere“ im Buchungsdialog, ⌘/Strg+Enter speichert                                                      |
| D1             | Monatswechsel auf dem Dashboard, Vergleich zu Vormonat und Vorjahresmonat                                            |
| D4 (teils)     | Kennzahlen, Kategorien-Legende und „Alle anzeigen“ führen zur gefilterten Transaktionsliste                          |
| C1 (teils)     | Monatsfilter mit Vor/Zurück in der Transaktionsliste                                                                 |
| E1             | Budget-Tempo: Zeitmarke im Balken, „im Plan / zu schnell“, Betrag pro Tag bzw. Monat                                 |
| E2, E4         | Budget bearbeiten, Löschen mit Bestätigung, Monats- und Jahresbudgets getrennt summiert                              |
| G1             | Summenzeile der Dauerbuchungen (Einnahmen, Ausgaben, Umbuchungen, Saldo pro Monat)                                   |
| G4             | Nötige Monatsrate je Sparziel mit Stichtag, „Sparrate einrichten“ öffnet die vorbefüllte Dauerbuchung                |

Welle 2 ist umgesetzt:

| Story    | Umsetzung                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| K1       | Buchungen serverseitig gefiltert, sortiert, seitenweise (`finance.searchTransactions`); keine Vollliste mehr pro Seite |
| C1       | Zeitraum mit Presets, Vor/Zurück um die eigene Länge, freie Spanne; Standard laufender Monat                           |
| C2, C3   | Gruppierung nach Tag/Monat mit Zwischensummen; „Weitere laden“ statt Schnitt bei 200                                   |
| C5       | Betragssuche in beiden Schreibweisen (vorgezogen, gehört zur Serversuche)                                              |
| C8       | Mobil: Suche plus Knopf „Filter“ (Bottom-Sheet), aktive Filter als Chips                                               |
| D2       | „Was ansteht“ auf dem Dashboard (`dashboard.attention`)                                                                |
| D3       | Budgets-Karte auf dem Dashboard mit Zeitmarke                                                                          |
| D4       | Drilldown aus Kennzahlen, Ring, Legende, Cashflow und letzten Buchungen                                                |
| B1       | Vorschläge aus früheren Buchungen im Buchungsdialog und in der Schnellerfassung                                        |
| F1       | Jahresvergleich im laufenden Jahr „bis heute“                                                                          |
| (Befund) | Aktivitäten-Log filtert nach Sichtbarkeit (siehe E-9)                                                                  |

Welle 3 ist umgesetzt:

| Story      | Umsetzung                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| A4         | Befehlspalette (⌘/Strg+K, Lupe in der Kopfzeile): Aktionen, Seiten, Buchungen, Konten mit Saldo, Kategorien, Ziele, Policen |
| A5         | Kürzel `n`, `s`, `/`, `?`; Enter im Betragsfeld springt zur Beschreibung; Kürzel in den Tooltips                           |
| A7         | Einstellungen in vier Tabs mit `?tab=`                                                                                     |
| C4         | Sortierung per Spaltenkopf, in der URL (`sortierung`, `richtung`)                                                          |
| C6         | Ruhige Zeilen; Klick/Enter öffnet ein Detail-Blatt mit Tags, Belegen, Verlauf, Stornieren, Löschen                         |
| D8         | Kennzahlen mobil als 2×2-Raster (Dashboard, Hypotheken, Versicherungen), gemeinsame `KpiCard`                              |
| E3, E5     | Budget-Verlauf der letzten sechs Perioden, Aufschlüsselung, Links in die Buchungen                                         |
| E6         | Karte „Ohne Budget“ mit Direkt-Anlage                                                                                      |
| E7         | Budgetvorschläge Ø 3 / Ø 6 Monate / höchster Monat im Budget-Dialog                                                        |
| F2         | Monatsmatrix Kategorie × Monat mit Tönung und aufklappbaren Unterkategorien                                                |
| F3         | Einnahmen, Ausgaben und Sparquote im Verlauf (zwei Diagramme, keine zweite Achse)                                          |
| F5         | Jede Matrix-Zelle, jede Säule (Verlauf, Jahresvergleich) und jede Jahresvergleichs-Zeile führt zu den Buchungen            |
| G2         | Fälligkeiten der nächsten 7/30/90 Tage mit Warnung bei drohendem Minus                                                     |
| H2 (teils) | Projekt-Karte in der Aufteilung; „abgeschlossen“-Status folgt mit Welle 5 (braucht Schema)                                 |
| H4         | Seite „Verlauf“ (Person, Zeitraum, Bereich) und Dashboard-Karte „Zuletzt im Haushalt“                                      |

Welle 4 ist umgesetzt:

| Story        | Umsetzung                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| B4           | Massenbearbeitung: Auswahl je Zeile, Kategorie/Projekt/Person/Tags setzen oder löschen, Verlauf und Audit je Buchung      |
| B5 (+B3)     | Schnellerfassung mit Schalter Ausgabe/Einnahme, Kategorie-Chips der häufigsten, „Rückgängig“ im Toast                     |
| B7           | „Wiederkehrend“ im Detail-Blatt: vorbefüllte Dauerbuchung, erste Fälligkeit nach heute, Ursprung im Aktivitäten-Log       |
| B8           | „Abhebung“ in der Schnellerfassung, Kasse im Minus mit „Abhebung nachtragen“, „Kasse zählen“ direkt an der Karte          |
| D5, D6       | Dashboard-Karten „Konten“ und „Sparziele“                                                                                 |
| F4           | Fixkosten-Karte: Quote, größte Fixposten, Schwankung der variablen Ausgaben                                               |
| F6, F8       | Aufschlüsselung nach Kategorie, Person, Konto, Tag oder Projekt für einen freien Zeitraum, Vergleich davor oder Vorjahr   |
| G7           | Geldfluss mobil standardmäßig als Liste                                                                                   |
| H1           | „Sichtbares Vermögen“ mit Hinweis, wenn Privatkonten anderer fehlen; „davon N nur lesend“ bei Lese-Freigaben              |
| I1           | Einrichtungs-Checklisten in Vorsorge, Hypotheken und Versicherungen; Vorsorge-Diagramm erst mit Kapital                   |
| I2, I3       | Deckungs-Check gruppiert und gebündelt, Hinweise mit Aktion (Police erfassen/bearbeiten, Tranche, Liegenschaft)           |
| J3, J4       | Weniger Monats-Ticks in der Prognose, gestaffelte Ablauf-Beschriftungen im Schuldenverlauf                                |
| J6, J7, J8   | „Spalten“ als Beschriftung vor dem Select, gemeinsames Buchungsart-Segment, Datumsfeld mit „Heute“/„Gestern“              |
| (Befund)     | Stornierte Buchungen zählen in keiner Summe mehr doppelt (siehe E-18)                                                     |

## 1. Kurzfassung

Finance Fox hat funktional mehr an Bord als die meisten Haushalts-Apps: sechs
Roadmap-Phasen, Offline-Betrieb, drei Fachmodule, Berichts-Export. Die
Schwächen liegen nicht im Fehlen von Funktionen, sondern darin, dass die
vorhandenen Informationen **nicht dort auftauchen, wo eine Frage entsteht**,
und dass die tägliche Kernschleife (buchen → nachsehen → verstehen) unnötig
viele Klicks braucht.

Die zehn größten Hebel, geordnet nach Nutzen pro Aufwand:

| #   | Hebel                                                                          | Stories        | Aufwand |
| --- | ------------------------------------------------------------------------------ | -------------- | ------- |
| 1   | Zeitraum-Filter, Gruppierung und Paginierung in der Transaktionsliste          | C1, C2, C3     | M       |
| 2   | Dashboard mit Monatswechsel, Vormonatsvergleich und „Was ansteht“-Zettel       | D1, D2         | M       |
| 3   | Startkategorien und Erste-Schritte-Checkliste beim Ersteinrichten              | A1, A2         | S       |
| 4   | Drilldown: jede Zahl in Dashboard, Budget, Auswertung führt zu ihren Buchungen | A6, D4, E5, F5 | M       |
| 5   | Budget-Tempo („63 % verbraucht, 83 % des Monats vorbei“) und Budget-Verlauf    | E1, E3         | S–M     |
| 6   | Zahlen- und Achsen-Umbrüche beheben (Beträge brechen mitten im Wert um)        | J1–J6          | S       |
| 7   | Vorschläge aus der Historie beim Buchen („Coop“ → Supermarkt, Haushaltskonto)  | B1, B2         | M       |
| 8   | Jahresvergleich „bis heute“ und Monatsmatrix je Kategorie                      | F1, F2         | M       |
| 9   | Globale Suche/Befehlspalette (⌘K) und Tastaturkürzel                           | A4, A5         | M       |
| 10  | Fixkosten-Summenzeile und Fälligkeitskalender bei den Dauerbuchungen           | G1, G2         | S       |

## 2. Vorgehen

- **Code-Durchsicht** aller 17 Seiten (`src/pages/`), der zentralen Dialoge
  und der tRPC-Router, mit Blick auf Navigation, Zustände (leer/voll/Fehler),
  Datenfluss und Konsistenz.
- **Durchklicken der laufenden App** (`npm run dev:agent`) mit einem
  realistischen Musterhaushalt: zwei Personen, acht Konten (gemeinsam, privat,
  Bargeld, Depot, Säule 3a), 32 Kategorien in zwei Ebenen, rund 520 Buchungen
  über 14 Monate inklusive Splits, Projekten und Tags, 16 Dauerbuchungen, sechs
  Budgets (Monat und Jahr), vier Sparziele, eine Liegenschaft mit zwei
  Tranchen, fünf Policen. Desktop (1440 px) und Mobil (390 px), hell und
  dunkel, als Admin **und** als zweites Mitglied.
- **Leerer Zustand** direkt nach der Ersteinrichtung, getrennt betrachtet.

Die Screenshots dieser Sitzung sind bewusst nicht eingecheckt; jede
Beobachtung lässt sich mit den Prüfschritten der Stories reproduzieren.

## 3. Was bereits gut funktioniert

Diese Stärken sollen die Stories nicht verwässern:

- **Erfassungsmaske**: Buchungsart als Segment, wenige Pflichtfelder, Details
  eingeklappt, Kategorie inline anlegbar, Splits mit Vorlagen. Das ist die
  richtige Grundform.
- **Schnellerfassung** mit gemerktem Konto und zuletzt genutzter Kategorie.
- **Konsequente Sicherheitsabfragen** mit Saldo-Effekt beim Löschen und
  Stornieren von Buchungen; Konten nur mit Namensbestätigung löschbar.
- **Fachmodule** mit strukturierten Hinweisen (`MortgageWarning`,
  `InsuranceGap`), ausblendbar mit Begründung, Verlauf je Modul.
- **Geldfluss-Diagramm** als eigenständige, verständliche Visualisierung der
  Fixkostenstruktur.
- **Prognose-Tabelle** mit frei wählbarem Horizont; die Zeile „Haushaltskasse
  (Bar) −3'799.91“ zeigt sofort, dass etwas nicht stimmt.
- **Papier-Design**: ruhig, gute Typografie, Farbe nur mit Bedeutung, Dark Mode
  ohne Brüche.
- **Mobile Navigation** (vier Schnellzugriffe plus „Mehr“-Sheet) und kein
  seitliches Scrollen der Seite.
- **Konto-Rechte** serverseitig, private Konten für Admins nur lesend, für
  andere unsichtbar — nachvollziehbar in beiden Identitäten geprüft.

## 4. Befunde

### 4.1 Ankommen und Orientierung

- **Keine Startkategorien.** Nach dem Setup-Wizard ist `listCategories` leer.
  Die erste Buchung zwingt zur Kategorie-Anlage, Budgets und die Auswertung
  bleiben so lange bedeutungslos. Der Wizard (`src/pages/Setup.tsx`) bietet
  nur Admin, Einladungen und Altdaten-Import.
- **Kein roter Faden nach dem Setup.** Das leere Dashboard zeigt vier
  Nullen und ein Cashflow-Diagramm mit leerer Achse („4 EUR … 0 EUR“). Es
  gibt keine Checkliste (Konto anlegen → Kategorien → erste Buchung →
  Partner einladen → Dauerbuchungen → Budget).
- **Querverweise fehlen.** Das Dashboard verweist auf „Aufteilung“ nur als
  Text; Kategorien im Ring, „Letzte Buchungen“, Budget-Karten und
  Auswertungszeilen sind nicht klickbar. Filter liegen in `useState`
  (`src/pages/Transactions.tsx`), nicht in der URL — kein Deep-Link „Zeig mir
  Lebensmittel im August“ möglich.
- **Keine globale Suche, keine Tastaturkürzel.** `cmdk` ist installiert, wird
  aber nur in `SearchableSelect` genutzt. Kein ⌘K, kein „n“ für neue Buchung.
- **Einstellungen sind eine 5'000 px lange Seite** mit zwölf Karten
  (`src/pages/Settings.tsx`, 1'419 Zeilen) ohne Sprungmarken oder Tabs. Das
  Aktivitäten-Log — die Antwort auf „was hat mein Partner gebucht?“ — liegt
  ganz unten darin.
- **Fachbegriffe ohne Erklärung**: Sparrate, Rollover, Belehnung,
  Tragbarkeit, Ersatzrate, Plafonierung, „offenes Ziel“. Kein Tooltip, kein
  Info-Popover (`TooltipContent`/`HoverCard` werden nirgends verwendet).

### 4.2 Buchen

- **Keine Vorschläge aus der Historie.** Wer „Coop“ tippt, muss Kategorie und
  Konto trotzdem jedes Mal wählen. Die Daten für „zuletzt wie diese Notiz“
  liegen im Client bereits vor (`useFinanceData().transactions`).
- **Kein „Speichern & weitere“.** Wer den Wocheneinkauf mit fünf Belegen
  nachträgt, öffnet den Dialog fünfmal.
- **Schnellerfassung**: die Konvention „negativ = Einnahme“ ist erklärt, aber
  ein Umschalter wäre auf dem Handy schneller als das Minuszeichen.
- **Massenbearbeitung fehlt** (im Roadmap-Backlog): 40 CAMT-Importzeilen
  einzeln kategorisieren ist die häufigste Fleißarbeit nach einem Import.
- **Bargeld-Kreislauf** wird nicht unterstützt: Es gibt keine Vorlage
  „Abhebung“ (Umbuchung Giro → Bar) und keinen Hinweis, wenn eine Kasse
  negativ wird — im Musterhaushalt stand die Haushaltskasse bei −3'800 ohne
  jede Warnung.
- **Kein „Wiederkehrend machen“** aus einer bestehenden Buchung; die
  Dauerbuchung muss neu erfasst werden.

### 4.3 Transaktionsliste

- **Kein Zeitraum-Filter.** Filter gibt es für Typ, Konto, Kategorie, Person,
  Tag und Suche — nicht für Monat, Quartal, Jahr oder freie Spanne. „Saldo der
  Auswahl“ summiert deshalb über alle Jahre (im Test 51'820 EUR, eine Zahl
  ohne Aussage).
- **Harter Schnitt bei 200 Zeilen** (`filtered.slice(0, 200)`) statt
  Paginierung; mobil ergibt das eine 11'000 px lange Seite.
- **Keine Gruppierung** (Tag/Monat mit Zwischensummen), **keine Sortierung**
  per Spaltenkopf, **kein laufender Saldo** bei Kontofilter.
- **Vier Icon-Aktionen pro Zeile** immer sichtbar (Stift, Tag, Büroklammer,
  Storno, Papierkorb) — viel Rauschen für seltene Aktionen.
- **Mobil** steht der Filterblock (sechs Felder gestapelt) vor der ersten
  Buchung; Kategorie- und Kontospalte sind ausgeblendet, ein Antippen der
  Zeile öffnet nichts.
- **Suche nach Betrag** vergleicht gegen `toFixed(2)` mit Punkt; „12,50“
  findet nichts bei de-DE-Nutzern.

### 4.4 Dashboard

- **Fest auf den aktuellen Monat** (`currentMonthKey()`), kein Wechsel, kein
  Vergleich zum Vormonat oder Vorjahresmonat.
- **Kein Handlungsbedarf-Bereich.** Budget-Überschreitungen (Budgets), fällige
  Dauerbuchungen (Wiederkehrend), Kündigungsfristen und Deckungslücken
  (Versicherungen), Zinsbindungs-Ablauf und veraltete Restschuld
  (Hypotheken), offene Salden (Aufteilung), negative Kasse — alles existiert,
  aber verteilt auf sieben Seiten.
- **Budgets, Sparziele, Kontosalden** fehlen auf dem Dashboard ganz.
- **Nicht klickbar**: Ring-Segmente, Legenden-Zeilen, letzte Buchungen.
- **Mobil** belegen vier gestapelte KPI-Karten den gesamten ersten Bildschirm.

### 4.5 Budgets

- **Kein Zeitbezug**: „63 %“ sagt nichts ohne „am 25. des Monats“. Die
  Budget-Hochrechnung existiert (`forecast.budgetForecast`), aber nur auf der
  Prognose-Seite.
- **Löschen ohne Bestätigung** (`deleteBudget.mutate` direkt am Papierkorb),
  **kein Bearbeiten** (nur „überschreiben“ über „Neues Budget“).
- **Kopfzeile addiert Monats- und Jahreslimits** („3'312 von 9'250“ = 2'050
  monatlich + 7'200 jährlich) — eine Zahl ohne Bedeutung.
- **Kein Verlauf** (eingehalten/überschritten der letzten Monate), **kein
  Drilldown** in Unterkategorien oder Buchungen, **keine Sicht auf
  unbudgetierte Ausgaben**.

### 4.6 Analysen

- **Jahresvergleich ist Ganzjahr gegen Ganzjahr** (Präfix-Vergleich in
  `yearComparison`). Im September vergleicht man neun gegen zwölf Monate; der
  Musterhaushalt zeigt „+109 %“, obwohl sich nichts geändert hat.
- **Nur Ausgaben, nur Oberkategorien, nur zwei Jahre.** Keine Einnahmen,
  keine Sparquote im Verlauf, keine Monatsmatrix, keine Dimension Person /
  Konto / Tag / Projekt, keine Top-Empfänger, keine Fixkostenquote.
- **Keine Drilldowns** von Tabellenzeile oder Balken zur Buchungsliste.
- **Diagramm-Details**: X-Achsen-Labels überlappen („LebensmittelFreizeit
  Versicherungen“), Y-Achsen-Labels brechen um („32000 / EUR“).

### 4.7 Dauerbuchungen, Sparziele, Geldfluss

- **Keine Summenzeile** bei den Dauerbuchungen (Fixkosten/Monat, Einnahmen/
  Monat, was bleibt). Die Zahl steckt nur im Geldfluss-Diagramm.
- **Kein Fälligkeitskalender** („was wird in den nächsten 30 Tagen
  abgebucht?“).
- **Sparziel „nicht erreichbar“** ohne Angabe, welche Monatsrate nötig wäre
  (Neues Velo: 2'300 offen bei Stichtag in fünf Monaten → 460/Monat).
- **Farbinkonsistenz**: Betrag in Zielfarbe, Balken in Blau (Herkunfts-Slot).
- **Geldfluss mobil**: Kartennamen brechen mitten im Wort, Labels überlappen —
  die Liste wäre dort die bessere Standardansicht.

### 4.8 Mehrpersonen-Haushalt

- **„Gesamtvermögen“ ist für jede Person anders** (Admin 145'651, Mitglied
  94'872), weil private Konten anderer fehlen — das Label sagt das nicht.
- **Aufteilung**: keine Projektsumme („Ferien Italien: 2'048, Sam 1'636
  bezahlt“), keine Ausgleichshistorie, Liste geteilter Ausgaben ohne
  Paginierung.
- **Rechte-Fehlermeldung**: Buchung auf ein nur lesend sichtbares Konto
  scheitert mit „Konto nicht gefunden“ (NOT_FOUND aus `requireAccountAccess`),
  obwohl das Konto auf der Kontenseite mit Badge „nur lesend“ steht.
- **Aktivitäten** (Audit-Log) nur am Ende der Einstellungen.

### 4.9 Fachmodule

- **Vorsorge nach Profil-Anlage**: drei Säulen-Karten mit 0.00, ein Diagramm
  mit fünfmal „0k EUR“, darunter drei Setup-Aufrufe — statt einer Checkliste
  mit Fortschritt.
- **Deckungs-Check** listet 13 Zeilen gleichrangig; vier davon „keine
  Deckungen erfasst“. Gruppierung nach Dringlichkeit und Zusammenfassen
  gleichartiger Hinweise fehlt.
- **Hinweis ohne Aktion**: „Restschuld per 01.01.2026 erfasst — bitte
  aktualisieren“ hat keinen Knopf zum Aktualisieren; „2 Hypotheken-Posten
  ohne Dauerbuchung“ in der Prognose verlinkt nicht.

### 4.10 Darstellungsfehler (reproduzierbar)

| Nr. | Beobachtung                                                                                                                       | Ursache / Ort                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| J1  | Kennzahl bricht mitten im Betrag um: „EUR 234'2 / 61.29“ (Prognosen, Desktop) bzw. Buchstabe für Buchstabe (Mobil)                | `body { overflow-wrap: anywhere }` in `src/index.css:166` greift auch auf Beträge |
| J2  | Y-Achsen-Labels zweizeilig: „14000 / EUR“ (Dashboard, Auswertung, Konten-Verlauf, Prognosen)                                      | `YAxis width={70}` zu schmal für Betrag plus Währungskürzel                       |
| J3  | X-Achsen-Labels überlappen (Auswertung: Kategorienamen; Konten-Verlauf: Datumsangaben)                                            | kein `interval`/`angle`/`tickFormatter` für lange Labels                          |
| J4  | `ReferenceArea`-Beschriftungen überlappen („Ablauf SARON-Tranche Ablauf Festhypothek“), Y-Labels links abgeschnitten (Hypotheken) | Labels ohne Versatz; linke Marge zu klein                                         |
| J5  | „67 %“ bricht in „67“ / „%“ um (Sparziele, drei Spalten)                                                                          | Prozent-Span ohne `whitespace-nowrap`                                             |
| J6  | Select-Label „Spalten: Hal…“ abgeschnitten (Prognose-Tabelle)                                                                     | Präfix „Spalten:“ plus Label in zu schmalem Trigger                               |
| J7  | Buchungsart-Auswahl uneinheitlich: Buchungsdialog dezentes Segment, Dauerbuchungs-Dialog rot gefüllter Button                     | `pages/Recurring.tsx` (`typeButton`) vs. `components/TransactionDialog.tsx`       |
| J8  | Mobil: Kontokarte im Geldfluss bricht „Haushaltskont / o“                                                                         | `overflow-wrap: anywhere` plus feste Kartenbreite                                 |

### 4.11 Technik hinter der Usability

- `useFinanceData()` lädt auf **jeder** Seite (auch im Layout) **alle**
  Transaktionen mit Splits, Anhängen, Tags und Änderungszählern
  (`listTransactions` ohne Eingabe). Bei mehreren Jahren Historie wächst
  jeder Seitenwechsel mit. Zeitraum-Filter und Paginierung (C1–C3) brauchen
  serverseitige Unterstützung, sonst bleibt der 200er-Schnitt.
- Es gibt keinen Musterdaten-Generator; `lib/devLogin.ts` legt bewusst nur
  Identitäten und ein Konto an. Für die Verifikation der Stories unten wurden
  die Daten per tRPC-Skript erzeugt — ein `npm run seed:demo` würde jede
  UI-Prüfung beschleunigen (K2).

## 5. User Stories

Format: **Als** Rolle **möchte ich** Ziel, **damit** Nutzen. Danach
Akzeptanzkriterien, **Status heute** (✅ vorhanden · 🟡 teilweise · ❌ Lücke),
**Prüfen** (Schritte mit `npm run dev:agent`, Identitäten Admin/Mitglied),
**Aufwand** (S < 1 Tag, M 1–3 Tage, L > 3 Tage) und **Priorität** (P1–P3).

Rollen: _Haushaltsmitglied_ (buchen, nachsehen), _Planer:in_ (Budgets, Ziele,
Prognosen), _Admin_ (Einrichtung, Personen), _Neuling_ (erste Sitzung).

### Epic A — Ankommen und Orientierung

#### US-A1 · Startkategorien beim Ersteinrichten

**Als** Neuling **möchte ich** beim Setup ein sinnvolles Kategorie-Set
übernehmen können, **damit** die erste Buchung, das erste Budget und die
Auswertung sofort Sinn ergeben.

- Der Setup-Wizard bietet einen Schritt „Kategorien“ mit einem vorgeschlagenen
  Set (Einnahmen: Lohn, Nebeneinkünfte, Rückerstattungen; Ausgaben: Wohnen mit
  Miete/Nebenkosten/Internet, Lebensmittel, Mobilität, Gesundheit,
  Versicherungen, Freizeit, Kleidung, Kinder, Ferien, Geschenke, Sonstiges).
- Jede Kategorie ist einzeln abwählbar; „Ohne Kategorien starten“ bleibt
  möglich.
- Der Schritt lässt sich später aus den Einstellungen nachholen („Vorschläge
  ergänzen“), ohne bestehende Kategorien zu duplizieren.
- Farben kommen aus `PENCIL_COLORS`, Unterkategorien hängen korrekt an ihrer
  Oberkategorie (`parentId`).

**Status heute:** ❌ `finance.listCategories` ist nach dem Setup leer; keine
Seed-Logik in `api/lib/migrate.ts` oder `authRouter.setup`.
**Prüfen:** Frische DB (`DATABASE_URL` auf leere Datei), Setup durchlaufen,
`#/transaktionen` → „Neue Buchung“ → Kategorie-Select öffnen.
**Aufwand:** S · **Priorität:** P1

#### US-A2 · Erste-Schritte-Checkliste

**Als** Neuling **möchte ich** auf dem Dashboard sehen, welche Grundlagen noch
fehlen, **damit** ich die App in der richtigen Reihenfolge einrichte.

- Solange nicht alle Punkte erfüllt sind, zeigt das Dashboard oben einen
  Notizzettel (`Note`) mit Fortschritt: Konto angelegt, Kategorien vorhanden,
  erste Buchung, Partner eingeladen (nur Admin), mindestens eine Dauerbuchung,
  erstes Budget.
- Jeder Punkt ist ein Link zur passenden Aktion (Dialog öffnet direkt).
- Erledigte Punkte bleiben abgehakt sichtbar; der Zettel lässt sich pro Person
  ausblenden (localStorage) und kommt bei neuen Personen wieder.
- Diagramme ohne Daten zeigen statt leerer Achsen einen Hinweis mit Aktion
  („Noch keine Buchungen — erste Ausgabe erfassen“).

**Status heute:** ❌ Leere Zustände existieren nur als Text; Cashflow-Chart
rendert leere Achsen.
**Prüfen:** Frische DB, als Admin anmelden, Dashboard betrachten; danach
Konto, Buchung, Dauerbuchung anlegen und das Abhaken beobachten.
**Aufwand:** S · **Priorität:** P1

#### US-A3 · Leere Zustände mit Erklärung und Aktion

**Als** Neuling **möchte ich** bei jeder leeren Seite verstehen, wozu sie
dient und was der erste Schritt ist, **damit** ich nicht rätsle.

- Jede Seite (Budgets, Sparziele, Aufteilung, Geldfluss, Auswertung, Bericht,
  Vorsorge/Hypotheken/Versicherungen) zeigt im leeren Zustand: ein Satz Zweck,
  ein Satz Voraussetzung, ein Primär-Button.
- Diagramme mit weniger als zwei Datenpunkten werden durch den Hinweis
  ersetzt, nicht neben ihm gezeigt.
- Für Auswertung und Prognosen wird der Mindest-Zeitraum genannt („ab dem
  zweiten Monat mit Buchungen“).

**Status heute:** 🟡 Texte vorhanden (z. B. „Noch keine Budgets angelegt“),
aber ohne Aktion; Vorsorge zeigt nach Profil-Anlage Nullwerte und ein
0k-Diagramm.
**Prüfen:** Frische DB, alle Seiten des „Mehr“-Menüs durchgehen; zusätzlich
Vorsorge-Profil anlegen und die Übersicht betrachten.
**Aufwand:** S · **Priorität:** P2

#### US-A4 · Globale Suche und Befehlspalette

**Als** Haushaltsmitglied **möchte ich** mit ⌘K/Strg+K ein Suchfeld öffnen,
das Seiten, Konten, Kategorien, Buchungen und Aktionen findet, **damit** ich
nicht durch fünf Menügruppen navigiere.

- Öffnen per Tastenkürzel und per Lupe in der Kopfzeile (mobil sichtbar).
- Treffergruppen: Seiten („Prognosen“), Aktionen („Neue Buchung“, „Schnell“),
  Konten (mit Saldo), Kategorien (öffnen gefilterte Transaktionen), Buchungen
  (Notiz, Betrag, Datum; öffnen den Bearbeiten-Dialog), Policen/Tranchen.
- Tastatur vollständig: Pfeile, Enter, Escape.
- Läuft offline (nur lokale Daten).

**Status heute:** ❌ `cmdk` nur in `SearchableSelect`.
**Prüfen:** Auf jeder Seite ⌘K drücken, „Coop“ tippen, Treffer öffnen.
**Aufwand:** M · **Priorität:** P2

#### US-A5 · Tastaturkürzel für die Kernschleife

**Als** Haushaltsmitglied am Desktop **möchte ich** mit „n“ eine neue
Buchung, mit „s“ die Schnellerfassung und mit „/“ die Suche öffnen, **damit**
das Buchen keine Maus braucht.

- Kürzel wirken nicht in Eingabefeldern; ein „?“ zeigt die Übersicht.
- Im Buchungsdialog springt Enter im Betragsfeld zur Notiz, ⌘Enter speichert.
- Kürzel stehen als Hinweis in den Button-Tooltips („Neue Buchung · n“).

**Status heute:** ❌ Keine globalen `keydown`-Handler außerhalb des
Geldfluss-Charts.
**Prüfen:** Dashboard öffnen, „n“ drücken → Dialog; im Betragsfeld „n“ tippen
→ Zeichen, kein Dialog.
**Aufwand:** S · **Priorität:** P2

#### US-A6 · Ansichten per URL teilbar

**Als** Haushaltsmitglied **möchte ich** eine gefilterte Transaktionsliste
oder einen Auswertungsmonat als Link an meinen Partner schicken, **damit**
wir über dieselbe Sicht sprechen.

- Filter, Zeitraum, Sortierung und gewählter Monat stehen in Query-Parametern
  des Hash-Routers (`#/transaktionen?monat=2026-08&kategorie=12`).
- Zurück/Vor im Browser wechselt zwischen Filterzuständen.
- Alle Drilldowns (D4, E5, F5) nutzen dieselben Parameter.

**Status heute:** ❌ Alle Filter in `useState`.
**Prüfen:** Filter setzen, Seite neu laden → Filter bleibt; URL kopieren, als
Mitglied öffnen → gleiche Sicht (soweit Rechte reichen).
**Aufwand:** S–M · **Priorität:** P1 (Voraussetzung für Drilldowns)

#### US-A7 · Einstellungen gegliedert

**Als** Admin **möchte ich** in den Einstellungen direkt zu „Kategorien“ oder
„Datensicherung“ springen, **damit** ich nicht scrolle.

- Seitliche oder obere Sprungleiste (Tabs): Profil & Sicherheit, Haushalt
  (Währung, Kategorien, Tags, Kontotypen & Banken), Benachrichtigungen,
  Daten (Backup, Datenverwaltung, Offline), Aktivitäten.
- Jeder Abschnitt hat eine Ankermarke (`#/einstellungen?tab=kategorien`).
- Aktivitäten werden zusätzlich als eigene Seite „Verlauf“ unter Verwaltung
  erreichbar (siehe H4).

**Status heute:** ❌ Eine fortlaufende Seite, zwölf Karten.
**Prüfen:** `#/einstellungen` öffnen; Weg bis „Kategorien“ zählen (heute:
scrollen an fünf Karten vorbei).
**Aufwand:** S · **Priorität:** P2

#### US-A8 · Fachbegriffe erklärt

**Als** Neuling **möchte ich** bei Begriffen wie Sparrate, Rollover, Belehnung,
Tragbarkeit, Ersatzrate und „offenes Ziel“ ein Info-Symbol antippen, **damit**
ich die Zahl einordnen kann.

- Einheitliche Komponente (Info-Icon + Popover, touch-tauglich) mit Satz,
  Formel und Beispiel.
- Mindestens: Sparrate, Rollover, Budget-Übertrag, Belehnung, Tragbarkeit,
  Pflicht-Amortisation, Ersatzrate, Rentenskala, offenes Ziel, Hauptverfall,
  Kündigungsfrist.

**Status heute:** ❌ Keine Tooltip- oder HoverCard-Verwendung.
**Prüfen:** Dashboard-KPI „Sparrate“ und Hypotheken-Karte „Tragbarkeit“ auf
Info-Möglichkeit prüfen.
**Aufwand:** S · **Priorität:** P3

### Epic B — Buchen ohne Reibung

#### US-B1 · Vorschläge aus der Historie

**Als** Haushaltsmitglied **möchte ich** beim Tippen der Notiz Vorschläge aus
früheren Buchungen erhalten, die Kategorie, Konto und typischen Betrag
vorbelegen, **damit** eine Routinebuchung drei Sekunden dauert.

- Nach zwei Zeichen erscheinen bis zu fünf Notizen aus der Historie
  (häufigste zuerst), mit Kategorie und letztem Betrag.
- Auswahl setzt Kategorie, Konto, Projekt (falls konstant) und — wenn das
  Betragsfeld leer ist — den letzten Betrag.
- Vorschläge respektieren die Buchungsart und Konto-Rechte.
- Gilt für Buchungsdialog und Schnellerfassung.

**Status heute:** ❌ Notizfeld ist ein einfaches `Input`.
**Prüfen:** Drei Buchungen „Coop“ mit Kategorie Supermarkt anlegen; neue
Buchung, „Co“ tippen → Vorschlag, Übernahme prüft Kategorie.
**Aufwand:** M · **Priorität:** P1

#### US-B2 · Speichern und weitere Buchung

**Als** Haushaltsmitglied **möchte ich** nach dem Speichern den Dialog offen
halten können, **damit** ich einen Stapel Belege in einem Zug erfasse.

- Zweiter Button „Speichern & weitere“ (⌘Enter mit Shift).
- Datum, Konto und Person bleiben erhalten, Betrag/Notiz/Kategorie/Belege
  werden geleert; Fokus liegt im Betragsfeld.
- Zähler im Dialogkopf („3 erfasst“).

**Status heute:** ❌ Dialog schließt nach jedem Speichern.
**Prüfen:** Dialog öffnen, drei Buchungen ohne Schließen erfassen.
**Aufwand:** S · **Priorität:** P1

#### US-B3 · Häufige Kategorien zuerst

**Als** Haushaltsmitglied **möchte ich** im Kategorie-Select meine fünf
meistgenutzten Kategorien oben sehen, **damit** ich nicht durch 30 Einträge
scrolle.

- Abschnitt „Häufig“ (letzte 90 Tage, pro Buchungsart) über der
  alphabetischen Baumliste; Suchfeld filtert weiterhin alles.
- In der Schnellerfassung erscheinen dieselben fünf als Chips unter dem
  Betrag; ein Tipp setzt die Kategorie.

**Status heute:** ❌ Alphabetische Liste; Schnellerfassung nimmt stumm die
zuletzt genutzte Kategorie.
**Prüfen:** Kategorie-Select im Buchungsdialog öffnen; Schnellerfassung
öffnen.
**Aufwand:** S · **Priorität:** P2

#### US-B4 · Massenbearbeitung

**Als** Haushaltsmitglied **möchte ich** mehrere Buchungen markieren und
gemeinsam Kategorie, Tag oder Projekt setzen bzw. löschen, **damit** ein
CAMT-Import in Minuten kategorisiert ist.

- Checkbox je Zeile plus „Alle sichtbaren“; Aktionsleiste erscheint bei
  Auswahl (Kategorie, Tags, Projekt, Person, Löschen).
- Server-Endpunkt verarbeitet die Auswahl in einer Transaktion und schreibt
  Änderungsverlauf und Audit-Log je Buchung.
- Nur Buchungen mit `edit`-Recht sind auswählbar; die Leiste nennt die Zahl.

**Status heute:** ❌ (Roadmap-Backlog A).
**Prüfen:** Nach CSV-Import zehn Zeilen markieren und kategorisieren.
**Aufwand:** M · **Priorität:** P2

#### US-B5 · Schnellerfassung ohne Vorzeichen-Trick

**Als** Haushaltsmitglied am Handy **möchte ich** in der Schnellerfassung
Ausgabe/Einnahme per Schalter wählen und die Kategorie antippen, **damit**
ich kein Minuszeichen suchen muss.

- Segment „Ausgabe | Einnahme“ über dem Betrag (Standard Ausgabe); „-“ im
  Betrag funktioniert weiterhin.
- Kategorie-Chips (B3) und gemerktes Konto bleiben; Betragsfeld hat
  `inputMode="decimal"` und Autofokus.
- Bestätigung als Toast mit „Rückgängig“ (löscht die eben erfasste Buchung
  innerhalb von zehn Sekunden).

**Status heute:** 🟡 Funktioniert, Konvention nur erklärt; kein Rückgängig.
**Prüfen:** Mobil (390 px) „Schnell“ öffnen, Einnahme erfassen.
**Aufwand:** S · **Priorität:** P2

#### US-B6 · Buchung duplizieren

**Als** Haushaltsmitglied **möchte ich** eine Buchung als Vorlage kopieren,
**damit** „wie letzte Woche“ zwei Klicks kostet.

- Aktion „Duplizieren“ im Zeilenmenü öffnet den Dialog vorbefüllt (Datum =
  heute, Belege leer).

**Status heute:** ❌
**Prüfen:** Transaktionsliste, Zeilenaktionen prüfen.
**Aufwand:** S · **Priorität:** P3

#### US-B7 · Aus Buchung eine Dauerbuchung machen

**Als** Planer:in **möchte ich** aus einer bestehenden Buchung mit einem
Klick eine Dauerbuchung anlegen, **damit** ich Miete oder Abo nicht doppelt
erfasse.

- Aktion „Wiederkehrend machen“ öffnet den Dauerbuchungs-Dialog vorbefüllt
  (Betrag, Konto, Kategorie, Notiz, Person; nächste Fälligkeit = Datum +
  Intervall).
- Rückverweis: die neue Dauerbuchung nennt die Ursprungsbuchung im Verlauf.

**Status heute:** ❌ (Umkehrrichtung existiert: Hypothek/Versicherung/Netto-
lohn → Dauerbuchung.)
**Prüfen:** Buchung „Miete“ suchen, Zeilenaktionen prüfen.
**Aufwand:** S · **Priorität:** P2

#### US-B8 · Bargeld im Griff

**Als** Haushaltsmitglied **möchte ich** eine Abhebung als Umbuchung Giro →
Bargeld in einem Schritt buchen und gewarnt werden, wenn die Kasse ins Minus
läuft, **damit** die Bar-Ausgaben stimmen.

- Schnellaktion „Abhebung“ (Umbuchung mit vorbelegtem Bargeldkonto) im
  Buchungsdialog und in der Schnellerfassung.
- Konten vom Typ Bargeld mit negativem Saldo zeigen einen Hinweis („Kasse
  negativ — vermutlich fehlt eine Abhebung“) mit Button „Abhebung nachtragen“;
  derselbe Hinweis erscheint im Handlungsbedarf (D2).
- Kontoabgleich („Ist-Saldo erfassen“) ist von der Karte aus direkt
  erreichbar.

**Status heute:** ❌ Kasse stand im Test bei −3'800 ohne Hinweis; Kontoabgleich
existiert nur im Bearbeiten-Dialog.
**Prüfen:** Bargeldkonto anlegen, Ausgaben darauf buchen, Kontenseite und
Dashboard prüfen.
**Aufwand:** S · **Priorität:** P2

### Epic C — Transaktionen finden und verstehen

#### US-C1 · Zeitraum-Filter

**Als** Haushaltsmitglied **möchte ich** die Transaktionen nach Monat,
Quartal, Jahr oder freier Spanne filtern und mit Pfeilen vor- und
zurückblättern, **damit** „August“ ein Klick ist.

- Zeitraum-Chip mit Presets (Dieser Monat, Letzter Monat, Dieses Jahr,
  Letzte 12 Monate, Alle) und freiem Von/Bis; Pfeile schieben den Zeitraum um
  seine Länge.
- Kopfzeile nennt Zeitraum, Anzahl, Einnahmen, Ausgaben und Saldo der
  Auswahl getrennt (nicht nur einen Saldo).
- Standard beim Öffnen: „Dieser Monat“ (per Einstellung änderbar).
- Zeitraum steht in der URL (A6).

**Status heute:** ❌ Kein Datumsfilter; „Saldo der Auswahl“ über alle Jahre.
**Prüfen:** `#/transaktionen` öffnen: Möglichkeit suchen, nur den Vormonat zu
sehen.
**Aufwand:** M (mit K1) · **Priorität:** P1

#### US-C2 · Gruppierung mit Zwischensummen

**Als** Haushaltsmitglied **möchte ich** die Liste nach Tag oder Monat
gruppiert sehen, **damit** ich den Rhythmus der Ausgaben erkenne.

- Umschalter „Gruppieren: Tag | Monat | keine“; Gruppenkopf mit Datum,
  Anzahl und Netto der Gruppe; Gruppen einklappbar.
- Mobil ist „Tag“ Standard; das Datum entfällt dann in der Zeile.

**Status heute:** ❌ Flache Tabelle.
**Prüfen:** Liste mit mehr als einem Monat Daten betrachten.
**Aufwand:** S · **Priorität:** P1

#### US-C3 · Nachladen statt Schnitt bei 200

**Als** Haushaltsmitglied **möchte ich** ältere Buchungen nachladen können,
**damit** kein Treffer stillschweigend fehlt.

- Anzeige in Seiten zu 50 mit „Mehr laden“ (oder Infinite Scroll); Zähler
  „50 von 1'240“.
- Bei aktivem Filter zählt der Server alle Treffer, nicht nur die geladenen.

**Status heute:** 🟡 Hinweis „ersten 200 Treffer“ vorhanden, aber kein Weg zu
Treffer 201.
**Prüfen:** Mehr als 200 Buchungen anlegen (Import), Liste bis zum Ende
scrollen.
**Aufwand:** S (Client) / M (mit K1) · **Priorität:** P1

#### US-C4 · Sortierung per Spaltenkopf

**Als** Haushaltsmitglied **möchte ich** nach Betrag, Datum, Kategorie oder
Konto sortieren, **damit** ich die größten Posten des Monats sofort sehe.

- Klick auf Spaltenkopf sortiert auf/ab (Muster: Kontentabelle,
  `sortableHead`).
- Sortierung steht in der URL.

**Status heute:** ❌ (Kontenseite hat es.)
**Prüfen:** Spaltenköpfe der Transaktionsliste anklicken.
**Aufwand:** S · **Priorität:** P2

#### US-C5 · Suche nach Betrag in meiner Schreibweise

**Als** Haushaltsmitglied **möchte ich** „12,50“ oder „12.50“ oder „1'234“
eingeben und die Buchung finden, **damit** die Suche der Locale folgt.

- Suchbegriff wird mit `parseEuro` normalisiert; Treffer bei exaktem Betrag
  und bei Präfix („12“ findet 12.xx).
- Optionaler Betragsbereich (von/bis) im Filter.

**Status heute:** 🟡 Sucht in `toFixed(2)` (nur Punkt).
**Prüfen:** Locale de-DE, Buchung 12,50 anlegen, „12,50“ suchen.
**Aufwand:** S · **Priorität:** P3

#### US-C6 · Ruhige Zeilen, Details auf Abruf

**Als** Haushaltsmitglied **möchte ich** in der Liste nur die Information
sehen und Aktionen bei Bedarf, **damit** die Tabelle lesbar bleibt.

- Desktop: Stift und Papierkorb erscheinen bei Hover/Fokus, seltene Aktionen
  (Stornieren, Tags, Belege, Duplizieren, Wiederkehrend machen) in einem
  „⋯“-Menü; Zeile ist per Tastatur erreichbar.
- Mobil: Antippen der Zeile öffnet ein Detail-Sheet (Betrag, Kategorie,
  Konto, Person, Splits, Tags, Projekt, Belege, Verlauf) mit den Aktionen.
- Badges (Geteilt, Storno, bearbeitet, Beleg-Zähler) bleiben in der Zeile.

**Status heute:** 🟡 Vier bis fünf Icon-Buttons pro Zeile; mobil kein Detail.
**Prüfen:** Desktop-Zeile ohne Hover betrachten; mobil eine Zeile antippen.
**Aufwand:** M · **Priorität:** P2

#### US-C7 · Laufender Saldo bei Kontofilter

**Als** Haushaltsmitglied **möchte ich** bei gewähltem Konto den Saldo nach
jeder Buchung sehen, **damit** ich die Liste mit dem Kontoauszug abgleichen
kann.

- Spalte „Saldo“ erscheint nur bei genau einem Konto im Filter; berechnet aus
  Anfangsbestand und allen Buchungen bis zur Zeile (unabhängig von weiteren
  Filtern, dann ausgegraut).

**Status heute:** ❌
**Prüfen:** Konto filtern, Spalten prüfen.
**Aufwand:** S · **Priorität:** P3

#### US-C8 · Kompakte Filter mobil

**Als** Haushaltsmitglied am Handy **möchte ich** oben nur Suche und einen
„Filter (2)“-Knopf sehen, **damit** die erste Buchung ohne Scrollen sichtbar
ist.

- Filter öffnen sich als Bottom-Sheet; aktive Filter als entfernbare Chips
  unter der Suche.
- Zeitraum-Pfeile bleiben direkt sichtbar.

**Status heute:** ❌ Sechs Felder gestapelt vor der Liste.
**Prüfen:** 390 px, `#/transaktionen`: Position der ersten Buchung.
**Aufwand:** S · **Priorität:** P1

### Epic D — Dashboard als Cockpit

#### US-D1 · Monat wechseln und vergleichen

**Als** Haushaltsmitglied **möchte ich** auf dem Dashboard den Monat wechseln
und bei jeder Kennzahl die Abweichung zum Vormonat sehen, **damit** ich
Ausreißer erkenne.

- Pfeile und Monats-Select in der Kopfzeile; alle Karten folgen dem Monat
  (KPI, Ring, letzte Buchungen des Monats).
- KPI zeigt Δ zum Vormonat und zum Vorjahresmonat („Ausgaben 7'205 · +12 %
  vs. Aug · −3 % vs. Sep 25“) mit Bedeutungsfarbe.
- Zukünftige Monate sind deaktiviert; der gewählte Monat steht in der URL.

**Status heute:** ❌ Fest auf `currentMonthKey()`.
**Prüfen:** Dashboard nach Möglichkeit suchen, den Vormonat zu sehen.
**Aufwand:** S · **Priorität:** P1

#### US-D2 · „Was ansteht“ — Handlungsbedarf an einem Ort

**Als** Haushaltsmitglied **möchte ich** auf dem Dashboard einen Zettel mit
allem sehen, was Aufmerksamkeit braucht, **damit** ich nicht sieben Seiten
abklappere.

- Ein Endpunkt `dashboard.attention` sammelt: Budgets ab 80 % und
  überschritten; Dauerbuchungen der nächsten 7 Tage (Summe); offene
  Ausgleichssalden; Bargeldkonten negativ; Sparziel-Stichtag in Gefahr
  (G4); Hypothek: Zinsbindung < 90 Tage, Restschuld-Stichtag > 12 Monate,
  Posten ohne Dauerbuchung; Versicherung: Kündigungsfrist < 30 Tage,
  Deckungslücken mit `severity: warn`; Vorsorge: Prognose-Warnungen (nur
  eigene); Offline: offene Konflikte.
- Jeder Eintrag: ein Satz, Dringlichkeit (Tinte/Warn/Negativ), Link zur
  Stelle mit passendem Filter, optional direkte Aktion („Verbuchen“,
  „Abhebung nachtragen“).
- Leerer Zustand: „Alles im grünen Bereich“ mit Datum der letzten Prüfung.
- Läuft offline; gleiche Quelle wie die Benachrichtigungen (`lib/notify.ts`),
  damit App und ntfy nie Verschiedenes behaupten.

**Status heute:** ❌ Alle Quellen vorhanden, aber verteilt (`MortgageWarning`,
`InsuranceGap`, `listBudgetStatus`, `memberBalances`, `sync.listConflicts`).
**Prüfen:** Musterhaushalt mit überzogenem Budget, ablaufender SARON-Tranche
und Kündigungsfrist in 20 Tagen: Dashboard öffnen.
**Aufwand:** M · **Priorität:** P1

#### US-D3 · Budgets kompakt auf dem Dashboard

**Als** Planer:in **möchte ich** die drei kritischsten Budgets als schmale
Balken auf dem Dashboard sehen, **damit** ich vor dem Einkauf weiß, wie viel
Luft ist.

- Karte „Budgets“ mit bis zu fünf Balken (sortiert nach Auslastung), Tempo-
  Marker (E1), Link „Alle Budgets“.
- Ohne Budgets: Hinweis mit Button „Erstes Budget“.

**Status heute:** ❌
**Prüfen:** Dashboard mit angelegten Budgets.
**Aufwand:** S · **Priorität:** P1

#### US-D4 · Drilldown vom Dashboard

**Als** Haushaltsmitglied **möchte ich** auf ein Ring-Segment, eine
Legenden-Zeile, einen Cashflow-Monat oder eine letzte Buchung klicken,
**damit** ich sofort die zugehörigen Buchungen sehe.

- Segment/Legende → `#/transaktionen?monat=…&kategorie=…` (Oberkategorie
  inklusive Unterkategorien).
- Cashflow-Punkt → Monat in der Liste; „Letzte Buchungen“ → Bearbeiten-Dialog
  (bei `edit`) bzw. Detail (C6); Link „Alle Buchungen“ unter der Karte.
- Hover/Fokus zeigt Klickbarkeit (Cursor, Unterstreichung).

**Status heute:** ❌ Nichts klickbar.
**Prüfen:** Dashboard, Ring-Legende „Wohnen“ anklicken.
**Aufwand:** S (mit A6) · **Priorität:** P1

#### US-D5 · Sparziele auf dem Dashboard

**Als** Planer:in **möchte ich** den Fortschritt meiner Sparziele auf dem
Dashboard sehen, **damit** das Ziel präsent bleibt.

- Karte mit bis zu drei Zielen (nächster Stichtag zuerst): Balken in
  Zielfarbe, Prozent, ETA oder „Rate nötig“ (G4).

**Status heute:** ❌
**Prüfen:** Dashboard mit angelegten Zielen.
**Aufwand:** S · **Priorität:** P2

#### US-D6 · Konten auf einen Blick

**Als** Haushaltsmitglied **möchte ich** die Salden meiner Konten auf dem
Dashboard sehen, **damit** ich nicht erst auf „Konten“ wechsle.

- Kompakte Liste (Name, Typ-Icon, Saldo), negative Salden hervorgehoben,
  private Konten mit Badge, Klick → Kontenseite mit geöffnetem Verlauf.

**Status heute:** ❌ Nur „8 Konten“ als Text.
**Prüfen:** Dashboard.
**Aufwand:** S · **Priorität:** P2

#### US-D7 · Dashboard pro Person anpassbar

**Als** Haushaltsmitglied **möchte ich** Karten ein- und ausblenden und
sortieren, **damit** mein Dashboard meine Fragen beantwortet (der eine will
Budgets, die andere Vorsorge).

- „Anpassen“-Modus mit Sichtbarkeit und Reihenfolge; Speicherung pro Benutzer
  serverseitig (damit sie auf allen Geräten gilt).
- Karten-Katalog: KPI, Was ansteht, Cashflow, Kategorien, Budgets, Sparziele,
  Konten, Letzte Buchungen, Offene Salden, Nettovermögen, Fälligkeiten.

**Status heute:** ❌
**Prüfen:** Dashboard.
**Aufwand:** M · **Priorität:** P3

#### US-D8 · Mobile Kennzahlen kompakt

**Als** Haushaltsmitglied am Handy **möchte ich** die vier Kennzahlen als
2×2-Kacheln sehen, **damit** darunter sofort Inhalt folgt.

- Unter 640 px: zwei Spalten, kleinere Schrift, Untertitel einzeilig; „Was
  ansteht“ (D2) direkt darunter.
- Gleiches Muster für die KPI-Zeilen der Module (Hypotheken, Versicherungen).

**Status heute:** 🟡 Eine Spalte, vier volle Karten (ganzer erster
Bildschirm).
**Prüfen:** 390 px, Dashboard und `#/versicherungen`.
**Aufwand:** S · **Priorität:** P2

### Epic E — Budgets, die führen

#### US-E1 · Budget-Tempo

**Als** Planer:in **möchte ich** bei jedem Budget sehen, ob ich im Zeitplan
liege, **damit** „63 %“ eine Bedeutung hat.

- Balken mit Zeitmarke (heute = 83 % des Monats) und Text „im Plan“ / „zu
  schnell (+120)“ / „überschritten“.
- Zeile „bis Monatsende noch X pro Tag“ bzw. „Hochrechnung: Y“ (Quelle
  `forecast.budgetForecast`) direkt auf der Karte.
- Jahresbudgets rechnen mit dem Jahresfortschritt.

**Status heute:** 🟡 Hochrechnung nur auf `#/prognosen`.
**Prüfen:** Budgets-Seite am 25. eines Monats betrachten.
**Aufwand:** S · **Priorität:** P1

#### US-E2 · Budget bearbeiten, Löschen bestätigen

**Als** Planer:in **möchte ich** ein Budget ändern können und vor dem Löschen
gefragt werden, **damit** ein Fehlklick nicht mein Limit löscht.

- Stift-Button öffnet denselben Dialog vorbefüllt (Limit, Zeitraum,
  Rollover); Kategorie fest.
- Papierkorb öffnet einen AlertDialog mit Kategorie und Limit (Muster:
  Transaktionen).

**Status heute:** ❌ `deleteBudget.mutate` ohne Bestätigung; kein Bearbeiten.
**Prüfen:** Budgets-Seite, Papierkorb anklicken.
**Aufwand:** S · **Priorität:** P1

#### US-E3 · Budget-Verlauf

**Als** Planer:in **möchte ich** je Budget die letzten sechs bis zwölf
Perioden sehen, **damit** ich erkenne, ob das Limit realistisch ist.

- Aufklappbarer Bereich je Karte: Mini-Balken je Periode (Ausgaben vs.
  Limit), Treffer-Quote („4 von 6 eingehalten“), Ø-Ausgaben.
- Vorschlag „Limit auf Ø anpassen“ mit einem Klick (E7).

**Status heute:** ❌
**Prüfen:** Budgets-Seite.
**Aufwand:** M · **Priorität:** P2

#### US-E4 · Monats- und Jahresbudgets getrennt

**Als** Planer:in **möchte ich** Monats- und Jahresbudgets getrennt
summiert und gruppiert sehen, **damit** die Kopfzeile stimmt.

- Kopfzeile: „Monat: 1'484 von 2'050 · Jahr: 1'828 von 7'200“.
- Zwei Abschnitte oder Umschalter; Sortierung nach Auslastung.

**Status heute:** ❌ Eine gemischte Summe.
**Prüfen:** Ein Monats- und ein Jahresbudget anlegen, Kopfzeile lesen.
**Aufwand:** S · **Priorität:** P1

#### US-E5 · Drilldown ins Budget

**Als** Planer:in **möchte ich** von der Budget-Karte zu den Buchungen und
zur Aufteilung auf Unterkategorien springen, **damit** ich weiß, wo das Geld
hinging.

- Klick auf Karte: Unterkategorien-Anteile als Balken, Liste der Buchungen
  der Periode (oder Link zur gefilterten Transaktionsliste).

**Status heute:** ❌
**Prüfen:** Budget „Lebensmittel“ mit Unterkategorien anklicken.
**Aufwand:** S (mit A6) · **Priorität:** P2

#### US-E6 · Unbudgetierte Ausgaben sichtbar

**Als** Planer:in **möchte ich** sehen, welcher Anteil meiner Ausgaben in
keinem Budget steckt, **damit** Budgets nicht ein falsches Gesamtbild geben.

- Karte „Ohne Budget: X (Y %)“ mit den größten unbudgetierten Kategorien und
  Button „Budget anlegen“.

**Status heute:** ❌
**Prüfen:** Budgets-Seite bei Ausgaben in nicht budgetierten Kategorien.
**Aufwand:** S · **Priorität:** P2

#### US-E7 · Budgetvorschlag aus der Historie

**Als** Planer:in **möchte ich** beim Anlegen eines Budgets den Ø der letzten
drei und sechs Monate sehen, **damit** ich ein erreichbares Limit setze.

- Nach Kategorie-Wahl: „Ø 3 Monate: 1'020 · Ø 6 Monate: 980 · Max: 1'340“
  mit Übernahme-Buttons.

**Status heute:** ❌
**Prüfen:** „Neues Budget“, Kategorie wählen.
**Aufwand:** S · **Priorität:** P2

### Epic F — Analysen, die Fragen beantworten

#### US-F1 · Jahresvergleich bis heute

**Als** Planer:in **möchte ich** das laufende Jahr mit demselben Zeitraum
des Vorjahres vergleichen, **damit** die Differenz nicht vom Kalender kommt.

- Umschalter „Bis heute | Ganzes Jahr“ (Standard: bis heute im laufenden
  Jahr); Kopfzeile nennt den Zeitraum („Jan–Sep 2026 vs. Jan–Sep 2025“).
- Monate ohne Daten im Vorjahr werden gekennzeichnet („Vorjahr ab Aug“).

**Status heute:** ❌ Präfix-Vergleich ganzer Jahre.
**Prüfen:** Im September `#/auswertung` öffnen; Gesamt-Differenz einordnen.
**Aufwand:** S · **Priorität:** P1

#### US-F2 · Monatsmatrix Kategorie × Monat

**Als** Planer:in **möchte ich** Kategorien als Zeilen und Monate als Spalten
sehen, **damit** ich Saisonalität und Ausreißer erkenne.

- Tabelle mit Heat-Färbung (Papier: Schraffur-Dichte), sticky erste Spalte,
  Zeilen aufklappbar auf Unterkategorien, Spalten-Summe und Ø je Zeile.
- Zeitraum 12 oder 24 Monate; Umschalter Einnahmen/Ausgaben/Netto.
- Zelle klickbar → Buchungen (F5).

**Status heute:** ❌
**Prüfen:** `#/auswertung`.
**Aufwand:** M · **Priorität:** P1

#### US-F3 · Einnahmen, Ausgaben und Sparquote im Verlauf

**Als** Planer:in **möchte ich** über 12/24 Monate sehen, wie sich Einnahmen,
Ausgaben und Sparquote entwickeln, **damit** ich den Trend kenne.

- Kombiniertes Diagramm (Balken Einnahmen/Ausgaben, Linie Sparquote in %),
  Ø-Linie, Monat antippbar.
- Kennzahlen: Ø-Sparquote, bester und schwächster Monat.

**Status heute:** ❌ Dashboard zeigt sechs Monate ohne Quote.
**Prüfen:** `#/auswertung`.
**Aufwand:** S · **Priorität:** P2

#### US-F4 · Fixkosten- vs. variable Kosten

**Als** Planer:in **möchte ich** wissen, welcher Anteil meiner Ausgaben fix
ist, **damit** ich weiß, wo Sparen überhaupt wirkt.

- Karte „Fixkostenquote“: Summe aktiver Dauerbuchungen (monatlich
  normalisiert) im Verhältnis zu Ø-Einnahmen und Ø-Ausgaben; Liste der
  größten Fixposten.
- Variable Kategorien mit größter Schwankung („Freizeit: 180–700“).

**Status heute:** ❌ (Report hat Fixkosten-Abschnitt, Geldfluss die Summen.)
**Prüfen:** `#/auswertung`.
**Aufwand:** S · **Priorität:** P2

#### US-F5 · Von jeder Zahl zur Buchung

**Als** Planer:in **möchte ich** jede Zahl in der Auswertung anklicken,
**damit** ich die Buchungen dahinter sehe.

- Tabellenzellen, Balken, Matrixzellen → Transaktionsliste mit Zeitraum und
  Kategorie (A6).

**Status heute:** ❌
**Prüfen:** `#/auswertung`, Zeile „Wohnen“ anklicken.
**Aufwand:** S · **Priorität:** P1

#### US-F6 · Auswertung nach Person, Konto, Tag, Projekt

**Als** Haushaltsmitglied **möchte ich** die Ausgaben auch nach Person,
Konto, Tag oder Projekt schneiden, **damit** Fragen wie „was hat der Umbau
gekostet?“ eine Antwort haben.

- Dimension-Select neben dem Zeitraum; Kategorien bleiben Standard.
- Projekte zeigen Summe, Anteil je Person und Zeitraum (siehe H2).

**Status heute:** ❌
**Prüfen:** `#/auswertung`.
**Aufwand:** M · **Priorität:** P2

#### US-F7 · Top-Empfänger

**Als** Haushaltsmitglied **möchte ich** die häufigsten und teuersten
Notizen/Empfänger des Zeitraums sehen, **damit** Gewohnheiten sichtbar
werden.

- Liste „Top 10 nach Betrag“ und „Top 10 nach Anzahl“ (Notiz normalisiert:
  Groß-/Kleinschreibung, Leerzeichen).

**Status heute:** ❌
**Prüfen:** `#/auswertung`.
**Aufwand:** S · **Priorität:** P3

#### US-F8 · Freier Zeitraum in der Auswertung

**Als** Planer:in **möchte ich** Quartal, Halbjahr oder rollierende 12 Monate
wählen, **damit** ich nicht an Kalenderjahre gebunden bin.

- Zeitraum-Komponente aus C1 wiederverwenden; Vergleichszeitraum
  automatisch (gleiche Länge davor) oder frei.

**Status heute:** ❌ Nur Jahr vor/zurück.
**Prüfen:** `#/auswertung`.
**Aufwand:** S · **Priorität:** P2

#### US-F9 · Lesbare Diagrammbeschriftungen

Siehe Epic J (J2, J3, J4). Akzeptanz: kein Label überlappt, keine Achse
umbricht, in 390 px und 1440 px.

### Epic G — Dauerbuchungen, Sparziele, Geldfluss

#### US-G1 · Fixkosten-Summenzeile

**Als** Planer:in **möchte ich** auf der Seite Wiederkehrend sehen, was pro
Monat rein- und rausgeht und was gespart wird, **damit** die Struktur auf
einen Blick klar ist.

- Kopfzeile: „Einnahmen 10'970 · Ausgaben 4'998 · Sparen/Umbuchungen 3'988 ·
  frei 1'984 pro Monat“ (aktive Dauerbuchungen, normalisiert wie im
  Geldfluss); folgt den Filtern.
- Umschalter Monat/Jahr.

**Status heute:** ❌ Nur „16 von 16 Dauerbuchungen“.
**Prüfen:** `#/wiederkehrend`.
**Aufwand:** S · **Priorität:** P1

#### US-G2 · Fälligkeitskalender

**Als** Haushaltsmitglied **möchte ich** sehen, welche Dauerbuchungen in den
nächsten 30 Tagen fällig sind und wie viel das ist, **damit** der
Kontostand nicht überrascht.

- Ansicht „Nächste 30 Tage“: Liste nach Datum mit Tagessummen; Hinweis, wenn
  der prognostizierte Saldo eines Kontos unter null fällt (Quelle
  `forecast.accountBalance`).
- Verlinkt aus D2.

**Status heute:** ❌
**Prüfen:** `#/wiederkehrend`.
**Aufwand:** S · **Priorität:** P2

#### US-G3 · Kategorie und Konto auf der Karte

**Als** Planer:in **möchte ich** auf der Dauerbuchungs-Karte Kategorie und
Ziel sehen, **damit** ich nicht in den Dialog muss.

- Kategorie-Badge (Farbe), Konto und Zielkonto wie heute, Intervall,
  Fälligkeit; Tabelle mit denselben Spalten sortierbar.

**Status heute:** 🟡 Kategorie fehlt auf der Karte.
**Prüfen:** `#/wiederkehrend`, Kartenansicht.
**Aufwand:** S · **Priorität:** P3

#### US-G4 · Nötige Monatsrate je Sparziel

**Als** Planer:in **möchte ich** bei einem Ziel mit Stichtag sehen, welche
Monatsrate nötig wäre, und sie mit einem Klick als Dauerbuchung anlegen,
**damit** „nicht erreichbar“ eine Lösung hat.

- Zeile „Nötig: 460/Monat (heute 0)“ bei Zielen mit Stichtag; grün, wenn die
  aktuelle Rate reicht.
- Button „Dauerbuchung anlegen“ öffnet den Dialog vorbefüllt (Umbuchung auf
  das erste verknüpfte Konto, Betrag = Differenz).
- Gleiche Zeile in der Sparziel-Prognose und auf dem Dashboard (D5).

**Status heute:** ❌ Nur „Mit aktuellen Dauerbuchungen nicht erreichbar“.
**Prüfen:** Ziel mit Stichtag in fünf Monaten ohne Dauerbuchung.
**Aufwand:** S · **Priorität:** P1

#### US-G5 · Zielfarbe konsequent

**Als** Planer:in **möchte ich** dass Balken und Betrag eines Ziels dieselbe
Farbe haben, **damit** ich Ziele auf Dashboard, Prognose und Seite
wiedererkenne.

- Bei genau einer Quelle trägt der Balken die Zielfarbe; bei mehreren Quellen
  bleiben Segmentfarben, der Rahmen zeigt die Zielfarbe.

**Status heute:** 🟡 Betrag in Zielfarbe, Balken in `pencilSlot(1)`.
**Prüfen:** `#/sparziele`.
**Aufwand:** S · **Priorität:** P3

#### US-G6 · Ziel erreicht: feiern und archivieren

**Als** Planer:in **möchte ich** ein erreichtes Ziel abschließen können,
**damit** die Liste nur offene Ziele zeigt und der Erfolg dokumentiert ist.

- Status „erreicht“ mit Datum; Aktion „Archivieren“ (ausgeblendet, unter
  „Archiv“ sichtbar); Konten-Verknüpfungen werden gelöst, damit das Geld für
  neue Ziele frei ist (Hinweis vorher).
- Toast/Zettel beim Erreichen; Benachrichtigung existiert bereits.

**Status heute:** ❌ Nur Text „Erreicht! 🎉“.
**Prüfen:** Ziel mit erreichtem Betrag.
**Aufwand:** S · **Priorität:** P3

#### US-G7 · Geldfluss mobil als Liste

**Als** Haushaltsmitglied am Handy **möchte ich** den Geldfluss standardmäßig
als Liste sehen, **damit** ich nichts zusammenkneifen muss.

- Unter 640 px ist „Liste“ Standard (merken pro Gerät); Diagramm bleibt
  wählbar mit Hinweis „quer halten“.
- Kartenname bricht nie mitten im Wort (J8).

**Status heute:** 🟡 Diagramm Standard; Umbrüche.
**Prüfen:** 390 px, `#/geldfluss`.
**Aufwand:** S · **Priorität:** P2

### Epic H — Haushalt gemeinsam führen

#### US-H1 · Ehrliches Vermögens-Label

**Als** Haushaltsmitglied **möchte ich** verstehen, dass „Gesamtvermögen“
nur meine sichtbaren Konten umfasst, **damit** Partner nicht über zwei
verschiedene Zahlen streiten.

- Label „Sichtbares Vermögen“ mit Untertitel „8 Konten · 1 privates Konto
  ohne Einsicht“ (Anzahl aus `listAccounts`-Metadaten, ohne Namen oder
  Beträge preiszugeben).
- Admins sehen fremde Privatkonten lesend: Karte kennzeichnet „inkl. 1 nur
  lesend“.

**Status heute:** ❌ Gleiches Label, verschiedene Zahlen (145'651 vs.
94'872).
**Prüfen:** Dashboard als Admin und als Mitglied vergleichen.
**Aufwand:** S · **Priorität:** P2

#### US-H2 · Projektzusammenfassung in der Aufteilung

**Als** Haushaltsmitglied **möchte ich** je Projekt Gesamtkosten, Anteil und
Bezahltes je Person sehen, **damit** „was hat Italien gekostet?“ beantwortet
ist.

- Projekt-Chip aktiv → Karte „Projekt: Total, Zeitraum, je Person bezahlt/
  geschuldet, Kategorien-Verteilung“; Status „abgeschlossen“ setzbar.

**Status heute:** ❌ Nur Filterung der Liste.
**Prüfen:** `#/aufteilung`, Projekt wählen.
**Aufwand:** S · **Priorität:** P2

#### US-H3 · Ausgleichshistorie

**Als** Haushaltsmitglied **möchte ich** sehen, wann zuletzt ausgeglichen
wurde, **damit** klar ist, ab wann die Salden zählen.

- Verbuchte Ausgleiche als eigene Liste („Alex → Sam 1'639.10 am 25.09.“);
  Salden-Karte nennt „seit letztem Ausgleich am …“.

**Status heute:** ❌
**Prüfen:** Ausgleich verbuchen, Seite prüfen.
**Aufwand:** S · **Priorität:** P3

#### US-H4 · „Was ist passiert?“ als eigene Seite

**Als** Haushaltsmitglied **möchte ich** die Aktivitäten des Haushalts als
eigene Seite und als Dashboard-Karte sehen, **damit** ich weiß, was mein
Partner gebucht oder geändert hat, ohne in die Einstellungen zu gehen.

- Seite „Verlauf“ (Nav-Gruppe Verwaltung) mit Filter Person/Bereich/Zeitraum;
  Dashboard-Karte „Zuletzt im Haushalt“ (fünf Einträge anderer Personen).

**Status heute:** 🟡 Audit-Log in den Einstellungen.
**Prüfen:** Als Mitglied buchen, als Admin nachsehen.
**Aufwand:** S · **Priorität:** P2

#### US-H5 · Verständliche Rechte-Fehlermeldung

**Als** Haushaltsmitglied **möchte ich** bei einer Buchung auf ein nur lesend
sichtbares Konto erfahren, dass mir das Bearbeitungsrecht fehlt, **damit**
ich nicht „Konto nicht gefunden“ lese.

- Server: bei `access === "view"` FORBIDDEN mit „Für dieses Konto hast du nur
  Leserecht“; NOT_FOUND bleibt für unsichtbare Konten (kein Leak).
- Client: Konten ohne `edit` sind in Buchungs-Selects nicht wählbar oder als
  „nur lesend“ markiert.

**Status heute:** 🟡 Schnellerfassung und CSV-Import bieten nur `edit`-Konten
an, der Buchungsdialog alle sichtbaren; der Server antwortet NOT_FOUND.
**Prüfen:** Als Admin Buchung auf fremdes Privatkonto versuchen (API).
**Aufwand:** S · **Priorität:** P3

#### US-H6 · Meine Sicht / Haushaltssicht

**Als** Haushaltsmitglied **möchte ich** zwischen „nur meine Buchungen“ und
„alle“ umschalten, **damit** ich meine eigenen Ausgaben getrennt sehe.

- Globaler Umschalter in der Kopfzeile (pro Gerät gemerkt), wirkt auf
  Dashboard, Transaktionen, Auswertung; Filter „Person“ bleibt zusätzlich.

**Status heute:** ❌ Nur Personenfilter in der Liste.
**Prüfen:** Dashboard als Mitglied.
**Aufwand:** M · **Priorität:** P3

#### US-H7 · Einladung bequem teilen

**Als** Admin **möchte ich** den Einladungslink per Teilen-Dialog oder
QR-Code weitergeben, **damit** die Einrichtung am Küchentisch klappt.

- Buttons „Teilen“ (`navigator.share`, falls verfügbar) und „QR anzeigen“
  (`qrcode` ist vorhanden).

**Status heute:** ❌ Nur „Kopieren“.
**Prüfen:** `#/personen`, Person hinzufügen.
**Aufwand:** S · **Priorität:** P3

### Epic I — Fachmodule

#### US-I1 · Modul-Einrichtung als Checkliste

**Als** Planer:in **möchte ich** in Vorsorge, Hypotheken und Versicherungen
sehen, welche Angaben noch fehlen und was sie freischalten, **damit** ich
nicht vor Nullwerten stehe.

- Nach dem Profil zeigt die Vorsorge statt Nullkarten eine Checkliste:
  Lohn (→ Netto), AHV-Angaben + Beitragsjahre (→ Rente), Pensionskasse (→
  Säule 2), 3a (→ Säule 3a), je mit Button; das Diagramm erscheint erst mit
  Daten.
- Hypotheken: Restschuld-Stichtag, Verkehrswert-Stichtag, Einkommen für
  Tragbarkeit, Dauerbuchungen je Tranche.
- Versicherungen: Deckungen je Police, Dokumente, Belastungskonto.

**Status heute:** ❌ Vorsorge zeigt 0.00 und 0k-Diagramm.
**Prüfen:** Vorsorge-Profil anlegen, Übersicht betrachten.
**Aufwand:** S · **Priorität:** P2

#### US-I2 · Hinweise gruppiert und zusammengefasst

**Als** Haushaltsmitglied **möchte ich** den Deckungs-Check nach Dringlichkeit
gruppiert und gleichartige Hinweise zusammengefasst sehen, **damit** die
wichtigen drei nicht in dreizehn untergehen.

- Gruppen „Jetzt handeln“ (`warn`), „Prüfen“ (`info`), „Datenqualität“;
  Zähler im Kopf; gleichartige Hinweise („4 Policen ohne Deckungen“)
  gebündelt mit Aufklappen.
- Ausgeblendete bleiben wie heute mit Begründung abrufbar.

**Status heute:** 🟡 Nach Schwere sortiert, aber flach.
**Prüfen:** `#/versicherungen` mit mehreren Policen ohne Deckungen.
**Aufwand:** S · **Priorität:** P2

#### US-I3 · Hinweis mit Aktion

**Als** Planer:in **möchte ich** aus einem Hinweis heraus direkt handeln
können, **damit** „bitte aktualisieren“ ein Klick ist.

- Hypothek: „Restschuld aktualisieren“ öffnet den Tranchen-Dialog beim Feld;
  „Zinsbindung läuft ab“ bietet „Neue Tranche anlegen / Konditionen
  erfassen“.
- Prognose: „2 Hypotheken-Posten ohne Dauerbuchung“ verlinkt zur Tranche mit
  Übernahme-Button.
- Versicherung: „Kündigen bis …“ bietet „Erinnerung 14 Tage vorher“ und
  „Als gekündigt markieren“.

**Status heute:** ❌ Hinweise sind reiner Text.
**Prüfen:** `#/hypotheken` mit veralteter Restschuld; `#/prognosen`.
**Aufwand:** S · **Priorität:** P2

#### US-I4 · Prämien- und Zinskalender

**Als** Planer:in **möchte ich** die nächsten Belastungen aus Policen und
Tranchen im Fälligkeitskalender (G2) sehen, **damit** Quartalsprämien nicht
überraschen.

- Policen/Tranchen ohne übernommene Dauerbuchung erscheinen als
  „nicht verbucht“ mit Übernahme-Button.

**Status heute:** ❌
**Prüfen:** `#/wiederkehrend` nach G2.
**Aufwand:** S · **Priorität:** P3

### Epic J — Darstellung

#### US-J1 · Beträge brechen nie um

**Als** Haushaltsmitglied **möchte ich** dass Kennzahlen und Beträge immer in
einer Zeile stehen, **damit** ich „234'261.29“ nicht als „234'2 / 61.29“
lese.

- `overflow-wrap: anywhere` gilt nicht für Beträge, Kennzahlen, Daten und
  IBANs (eigene Utility-Klasse mit `white-space: nowrap` / `overflow-wrap:
normal` an `formatCents`-Ausgaben, `font-mono`-Zellen und KPI-Werten).
- Zu breite Kennzahlen skalieren die Schrift (`text-xl` → `text-lg` ab
  Zeichenzahl) statt zu brechen.
- Geprüft in 390 px: Prognose-KPI, Hypotheken-KPI, Kontokarten.

**Status heute:** ❌ Reproduziert auf `#/prognosen` (Desktop und Mobil).
**Aufwand:** S · **Priorität:** P1

#### US-J2 · Achsenbeschriftungen einzeilig

- `YAxis`: Breite dynamisch oder Tick-Formatter kompakt („14k“ statt
  „14000 EUR“, Währung einmal im Achsentitel).
- Betrifft Dashboard, Auswertung, Konten-Verlauf, Prognosen, Hypotheken.

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P1

#### US-J3 · X-Achsen ohne Überlappung

- Kategorienamen: `interval={0}`, `angle=-30` oder Kürzung mit Tooltip;
  Konten-Verlauf: höchstens sechs Ticks, Format Monat/Jahr.

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P2

#### US-J4 · Band-Beschriftungen im Schuldenverlauf

- `ReferenceArea`-Labels versetzt (abwechselnd oben/unten) oder als Legende
  unter dem Chart; linke Marge für „800k EUR“.

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P3

#### US-J5 · Prozentwerte nicht umbrechen

- `whitespace-nowrap` auf Prozent-Spans (Sparziele, Budgets); Layout der
  Kartenzeile mit `min-w-0` prüfen.

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P2

#### US-J6 · Select-Labels lesbar

- Präfix „Spalten:“ als Label vor dem Select statt im Trigger; Trigger
  `w-auto`/breiter.

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P3

#### US-J7 · Einheitliche Buchungsart-Auswahl

- Dauerbuchungs-Dialog nutzt dasselbe Segment wie der Buchungsdialog (Ton
  statt Füllung).

**Status heute:** ❌ · **Aufwand:** S · **Priorität:** P3

#### US-J8 · Datumsfelder mit Kalender

- Eigener Date-Picker (`react-day-picker` ist vorhanden) mit Locale-Format,
  Schnellwahl „Heute/Gestern“; native Eingabe bleibt Fallback.

**Status heute:** 🟡 Native `type="date"` (Format je nach Browser).
**Aufwand:** M · **Priorität:** P3

### Epic K — Technik hinter der Usability

#### US-K1 · Transaktionen serverseitig gefiltert und seitenweise

**Als** Entwickler:in **möchte ich** `listTransactions` mit Zeitraum, Filtern,
Sortierung und Cursor aufrufen können, **damit** C1–C4 auch bei fünf Jahren
Historie schnell bleiben.

- Neuer Endpunkt (oder Eingabe) mit `from/to`, `accountId`, `categoryIds`,
  `userId`, `tagId`, `type`, `search`, `sort`, `cursor`, `limit`; Antwort
  mit `total`, Summen (Einnahmen/Ausgaben) der Gesamttreffer und Seite.
- `useFinanceData()` lädt für Dashboard/Layout nur noch Aggregate bzw. den
  aktuellen Monat; Vollliste nur, wo sie gebraucht wird.
- Läuft unverändert im Service Worker (SQL statt JS-Filter).
- Invalidierung in `useInvalidateFinance` angepasst.

**Status heute:** ❌ Alles im Client.
**Prüfen:** Netzwerk-Tab: Seitenwechsel lädt nicht alle Buchungen.
**Aufwand:** M–L · **Priorität:** P1 (Grundlage für Epic C)

#### US-K2 · Musterdaten für Verifikation

**Als** Entwickler:in **möchte ich** mit `npm run seed:demo` einen
realistischen Haushalt erzeugen, **damit** jede Story in Minuten prüfbar
ist.

- Skript nutzt die tRPC-API über den Dev-Login (keine direkten Inserts),
  ist idempotent (Kennzeichnung der Demo-Daten), respektiert Rechte (private
  Konten über die jeweilige Identität) und deckt alle Module ab.
- Nur mit `DEV_LOGIN=1`, nie in Produktion.

**Status heute:** ❌
**Aufwand:** S · **Priorität:** P2

## 6. Vorschlag für Umsetzungswellen

| Welle | Ziel                                     | Stories                                                        |
| ----- | ---------------------------------------- | -------------------------------------------------------------- |
| 1     | Sofort spürbar, kleine Änderungen        | J1, J2, J5, E2, E4, A1, A2, G1, G4, B2, D1, A6                 |
| 2     | Kernschleife Transaktionen und Dashboard | K1, C1, C2, C3, C8, D2, D3, D4, E1, B1, F1                     |
| 3     | Verstehen und planen                     | F2, F3, F5, E3, E5, E6, E7, A4, A5, A7, C4, C6, G2, H2, H4, D8 |
| 4     | Module und Feinschliff                   | I1, I2, I3, B4, B5, B7, B8, G7, H1, F4, F6, F8, D5, D6, J3–J8  |
| 5     | Später / bei Nachfrage                   | D7, H3, H5, H6, H7, I4, B3, B6, C5, C7, F7, G3, G5, G6, A8, K2 |

Welle 1 ist ohne Schemaänderung machbar; Welle 2 braucht K1 (neuer Endpunkt,
keine Migration). Ab Welle 3 lohnt ein Blick auf `useFinanceData`, damit
nicht jede Seite alles lädt.

## 7. Verifikations-Checkliste (Kurzform)

Für eine schnelle Abnahme nach jeder Welle — mit `npm run dev:agent`,
Musterdaten und beiden Identitäten:

| Frage                                                              | Erwartung nach Umsetzung                          | Stories    |
| ------------------------------------------------------------------ | ------------------------------------------------- | ---------- |
| Frische Installation: Wie lange bis zur ersten sinnvollen Buchung? | < 2 Minuten, ohne eine Kategorie zu tippen        | A1, A2     |
| „Was habe ich im August für Lebensmittel ausgegeben?“              | Zwei Klicks vom Dashboard, Link teilbar           | D4, C1, A6 |
| „Liege ich mit dem Freizeit-Budget im Plan?“                       | Ein Blick: Tempo-Marker und Hochrechnung          | E1, D3     |
| „Was muss ich diese Woche erledigen?“                              | Ein Zettel auf dem Dashboard, jede Zeile klickbar | D2         |
| „Ist dieses Jahr teurer als letztes?“                              | Vergleich bis heute, Differenz erklärbar          | F1, F2     |
| „Wie viel geht monatlich fix weg?“                                 | Summenzeile bei Wiederkehrend                     | G1         |
| „Schaffe ich das Velo bis Februar?“                                | Nötige Rate steht am Ziel, Dauerbuchung ein Klick | G4         |
| Mobil: erste Buchung ohne Scrollen sichtbar?                       | Ja, Filter hinter einem Knopf                     | C8, D8     |
| Kennzahl mit sieben Stellen in 390 px?                             | Einzeilig, ggf. kleinere Schrift                  | J1         |
| Partner-Sicht: gleiche Zahl unter gleichem Label?                  | Label erklärt sichtbare vs. private Konten        | H1         |

## 8. Entscheidungen bei der Umsetzung

Jede Entscheidung mit den geprüften Alternativen und der Begründung. Die
Nummern (E-n) werden in Code-Kommentaren nicht zitiert; die Kommentare dort
erklären dasselbe knapp am Ort.

### Welle 2

**E-1 · Buchungsliste nicht mehr global laden (K1).** Bisher lud
`useFinanceData()` auf jeder Seite — über das Layout sogar auf allen — die
komplette Buchungsliste; gefiltert, summiert und gekappt (200 Zeilen) wurde
im Browser.

- _Alternative A:_ Liste weiter laden, im Browser seitenweise anzeigen. Behebt
  den 200er-Schnitt, nicht aber die wachsende Datenmenge pro Seitenwechsel.
- _Alternative B:_ Nur für die Transaktionsliste einen Such-Endpunkt. Bringt
  nichts, solange Layout und Dashboard die volle Liste weiter anfordern.
- _Gewählt:_ `useFinanceData()` enthält keine Buchungen mehr. Jede Seite holt
  genau ihren Ausschnitt oder ihr Aggregat: `finance.searchTransactions`
  (Liste), `dashboard.summary` (Monatszahlen), `listAccounts` (Salden und
  neu `txCount`), `finance.categoryUsage` (Schnellerfassung),
  `listTransactions({ sharedOnly })` (Aufteilung). Zusätzlicher Gewinn: Die
  Rechnungen liegen jetzt serverseitig und sind mit Vitest getestet — für das
  Frontend gibt es keine Tests. Offline ändert sich nichts, der Service
  Worker führt denselben Router aus.
- _Preis:_ Gruppensummen in der Liste zählen nur geladene Zeilen; an einer
  Seitengrenze kann ein Tag geteilt sein, bis „Weitere laden“ ihn ergänzt.

**E-2 · Seitenbildung per Versatz statt Keyset.** Sortiert wird nach Datum,
Betrag, Kategorie, Konto oder Person; ein Keyset-Cursor müsste für jede
Sortierung eigene Schlüssel führen. Die Datenbank liegt ohnehin im Speicher
(sql.js), ein Versatz kostet nichts. Stabil wird die Reihenfolge durch den
Gleichstand-Brecher Datum, dann ID.

**E-3 · Standard-Zeitraum der Transaktionen ist der laufende Monat.** So
stimmen Kopfzeile und Summen mit dem Dashboard überein. Findet eine Suche im
Monat nichts, bietet die leere Liste „In allen Zeiträumen suchen“ an. Der
laufende Monat braucht keinen URL-Parameter; alle anderen Zeiträume stehen
in der Adresse (`monat`, `jahr`, `von`/`bis`, `zeit=alle`).

**E-4 · „Was ansteht“ serverseitig gesammelt, Sätze im Frontend.**
`dashboard.attention` ruft die Modul-Router per `createCaller` auf — dasselbe
Prinzip wie der Bericht: eine Quelle der Wahrheit für Hinweise, keine zweite
Rechnung. Die Sätze baut `src/lib/attention.ts`, die Modultexte dafür liegen
jetzt geteilt in `src/lib/mortgageText.ts` und `src/lib/insuranceText.ts`.
Bewusst **nicht** aufgenommen: Einrichtungs-Hinweise der Hypothek (fehlender
Verkehrswert oder fehlendes Einkommen), Vorsorge-Warnungen (reine
Einrichtungs-Hinweise, sie würden täglich nerven; dafür ist I1 da) und
Versicherungs-Hinweise mit Schwere „info“. Ausgleichszahlungen unter 1.00
werden nicht gemeldet, die Vorschau der Dauerbuchungen reicht 7 Tage.

**E-5 · Notiz aus den Details in den Hauptbereich.** Die Notiz ist der Anker
für die Vorschläge aus der Historie (B1) und das am häufigsten genutzte
beschreibende Feld. Im eingeklappten Detailbereich hätte niemand die
Vorschläge gesehen.

**E-6 · Stornos zählen nicht als Nutzung.** Beim Testen fiel auf, dass die
Gegenbuchung eines Stornos die „zuletzt verwendete Kategorie“ der
Schnellerfassung verfälscht. `categoryUsage` und `noteSuggestions`
ignorieren deshalb Buchungen mit `stornoOfId`.

**E-7 · Jahresvergleich im laufenden Jahr „bis heute“.** Ganze Jahre bleiben
per Umschalter erreichbar; für vergangene Jahre gibt es nur den Vergleich
ganzer Jahre. Künftige Jahre sind gesperrt.

**E-8 · Toleranz beim Budget-Tempo.** „Zu schnell“ gilt erst ab 5
Prozentpunkten über dem Zeitplan — sonst meldet schon der Wocheneinkauf am
Monatsanfang Alarm.

**E-9 · Aktivitäten-Log nach Sichtbarkeit filtern (Befund beim Umsetzen).**
Bis Version 1.31 lieferte `listAuditLog` allen Mitgliedern alle Einträge —
inklusive fremder Bruttolöhne aus der privaten Vorsorge und der Notizen von
Buchungen auf fremden Privatkonten. Weil H4 das Log prominent macht, filtert
der Server jetzt je Eintrag (`api/lib/auditVisibility.ts`). Einträge zu
gelöschten Buchungen und Konten lassen sich keinem Konto mehr zuordnen; sie
sehen nur Urheber und Admins. Das blendet für andere Mitglieder auch den
Erfassungs-Eintrag einer inzwischen gelöschten Buchung auf dem
Gemeinschaftskonto aus — lieber zu wenig zeigen als zu viel. Die
Ehepartner-Verknüpfung der Vorsorge bleibt sichtbar, weil sie die Rente des
Partners betrifft und keine Zahlen enthält.

**Review von Welle 2 — gefunden und behoben:**

- Escape in der Vorschlagsliste schloss den ganzen Buchungsdialog (Radix
  fängt Escape vor dem Eingabefeld ab). Jetzt schließt Escape nur die Liste.
- Beim **Bearbeiten** übernahm ein Vorschlag auch Konto, Kategorie und
  Projekt — ein Enter im Notizfeld konnte eine Buchung still verschieben.
  Jetzt übernimmt der Vorschlag beim Bearbeiten nur die Notiz; Zielkonten
  werden nur vorgeschlagen, wenn sie sichtbar sind.
- Die verzögerte Suche fraß ein gerade getipptes Leerzeichen und konnte mit
  veralteten Parametern gleichzeitige Filteränderungen zurücksetzen.
- „Was ansteht“ meldete bei einem Fehler „Alles im grünen Bereich“. Jetzt
  zeigt die Karte den Fehler, und am Server ist jedes Modul einzeln
  abgesichert (`section_failed`).
- Schnellerfassung: Die Kategorie eines Ausgaben-Vorschlags blieb stehen,
  wenn danach das Vorzeichen auf Einnahme wechselte.
- Sparziele mit Quellen auf fremden Privatkonten lösten eine falsche
  „nötige Rate“ aus; Dauerbuchungen hinter ihrem Enddatum erschienen als
  fällig.
- Das Dashboard verschwand beim Monatswechsel kurz ganz (vorherige Daten
  bleiben jetzt stehen); der „laufende Monat“ richtet sich nach dem Gerät,
  nicht nach der Server-Uhr (UTC).
- „Erste Schritte“ fragte den haushaltsweiten Zustand ab und verriet damit
  Buchungen auf fremden Privatkonten; `isReversed` rechnet jetzt nur mit
  sichtbaren Buchungen (online wie offline gleich).
- Kleinere Punkte: Fehlerzustand der Transaktionsliste, ungültige
  URL-Werte, Dubletten beim Nachladen, ein zeitabhängiger Test.

### Welle 3

**E-10 · Detail-Blatt statt „⋯“-Menü (C6).** Die Story sah am Desktop ein
Menü für seltene Aktionen vor, mobil ein Detail-Sheet.

- _Alternative A:_ Menü am Desktop, Sheet mobil. Zwei Wege zu denselben
  Aktionen, und das Menü zeigt keine Details (Splits, Projekt, Verlauf).
- _Gewählt:_ Ein Detail-Blatt für beide — am Desktop von rechts, mobil von
  unten. Die ganze Zeile ist der Auslöser (auch per Enter/Leertaste), in der
  Zeile bleiben nur die zwei häufigsten Aktionen: Bearbeiten (bei Hover) und
  Belege (mit Zähler immer sichtbar). Links mit `fokus=<id>` (Dashboard,
  Befehlspalette) öffnen das Blatt direkt; nach dem Schließen bleibt nur die
  Markierung. Das Blatt ist abgeleitet statt per Effekt gesetzt: Wird die
  Buchung gelöscht, schließt es von selbst.

**E-11 · Befehlspalette öffnet Buchungen im Detail-Blatt, nicht im
Bearbeiten-Dialog (A4).** Die Story nannte den Bearbeiten-Dialog. Ein
Enter in der Palette soll aber nichts verändern können, und das Blatt
bietet „Bearbeiten“ einen Klick weiter an. Die Palette sucht Buchungen am
Server (`searchTransactions`, ab zwei Zeichen) und zeigt höchstens sechs
Treffer plus „Alle Treffer anzeigen“ — die Liste mit der Suche in der URL.

**E-12 · Tastenkürzel nur außerhalb von Eingabefeldern und Dialogen.**
`n`, `s`, `/` und `?` greifen nicht, solange ein Feld, eine Auswahlliste
oder ein Menü den Fokus hat oder ein Dialog offen ist; sonst öffnet ein „n“
in der Notiz einen zweiten Dialog, und auf einem Select-Auslöser springt
dieselbe Taste zu einem Eintrag. ⌘/Strg+K wirkt auch in Eingabefeldern
(Konvention vieler Apps), aber nicht über einem anderen Dialog — dort
ersetzte die Palette eine halb ausgefüllte Buchung.

**E-13 · Auswertung in Tabs statt einer langen Seite (F2, F3).** Drei
Fragen, drei Ansichten: „Wie entwickeln wir uns?“ (Verlauf), „Wofür geben
wir wann aus?“ (Matrix), „Teurer als letztes Jahr?“ (Jahresvergleich). Die
Ansicht steht in der URL (`?ansicht=`). Die Sparquote ist ein eigenes
Diagramm unter den Balken — eine zweite y-Achse hätte zwei Maßstäbe
vermischt. Die Matrix zeigt ganze Währungseinheiten (Cent-Beträge stehen im
Tooltip), tönt zeilenweise (der teuerste Monat einer Kategorie ist am
dunkelsten) und beginnt auf schmalen Bildschirmen bei den jüngsten Monaten.

**E-14 · Budgetvorschläge aus abgeschlossenen Monaten (E7).** Der laufende
Monat zählt nicht mit, sonst schlägt der Dialog am Monatsanfang ein viel zu
kleines Budget vor. Angeboten werden Ø 3 Monate, Ø 6 Monate und der
höchste Monat; ein Klick übernimmt den Wert, gespeichert wird erst mit
„Speichern“. Für Jahresbudgets werden die Werte mit zwölf hochgerechnet.

**E-15 · Sortieren schaltet die Gruppierung ab (C4).** Tages- oder
Monatsköpfe zwischen nach Betrag sortierten Zeilen ergäben keinen Sinn. Die
Gruppierungs-Auswahl bleibt stehen, ist aber gesperrt und erklärt per
Tooltip warum; zurück bei „Datum“ gilt wieder die gespeicherte Gruppierung.
„Filter zurücksetzen“ behält Zeitraum und Sortierung.

**E-16 · „Zuletzt im Haushalt“ ohne Anmeldungen und Einstellungen (H4).**
Die Dashboard-Karte zeigt nur fachliche Bereiche (Buchungen, Konten,
Budgets, Ziele, Module …). „Anna hat sich angemeldet“ ist Rauschen; wer das
sehen will, findet es unter „Verlauf“. Der Server filtert eigene und
System-Einträge (`othersOnly`), damit die fünf Plätze nicht von eigenen
Einträgen belegt werden. Der Zeitfilter der Verlauf-Seite übergibt
Epoch-Millisekunden, damit „heute“ in der Zeitzone des Geräts gilt.

**E-17 · Eine KpiCard für alle Kennzahl-Zeilen (D8).** Dashboard,
Hypotheken und Versicherungen hatten je eine eigene Kopie derselben Karte.
Die gemeinsame `KpiCard` setzt das mobile 2×2-Raster einmal um; ab `sm`
sieht alles aus wie vorher.

**Review von Welle 3 — gefunden und behoben:**

- **Datenschutz:** Die neue Dashboard-Karte „Zuletzt im Haushalt“ zeigte
  Dauerbuchungen und Sparziel-Quellen auf fremden Privatkonten („Geheimes
  Abo“, „Konto „Privat Sam““) — das Log behandelte beide als
  haushaltsweit. Dauerbuchungen werden jetzt mit ihrer ID geloggt und nach
  ihren Konten gefiltert; Sparziel-Quellen nur gezeigt, wenn das genannte
  Konto sichtbar ist (sonst Urheber und Admin). Ältere Anlage-Einträge ohne
  ID sehen nur Urheber und Admins.
- Der globale Dialog „Neue Buchung“ (Taste `n`) blieb die ganze Sitzung
  gemountet und behielt das Datum von gestern bzw. eines rückdatierten
  Stapels. Jedes Öffnen setzt ihn jetzt neu auf; der Fokus steht im
  Betragsfeld.
- Das Detail-Blatt konnte eine früher angeklickte Buchung wieder öffnen,
  nachdem man über die Suche zu einer anderen gesprungen war. Die Wahl ist
  jetzt an die Suchparameter gebunden, ein `fokus`-Link hat Vorrang und
  öffnet auch Buchungen außerhalb der geladenen Seiten.
- Kürzel feuerten auf fokussierten Select-Auslösern (Taste „n“ wählte
  „Nach Monat gruppiert“ *und* öffnete den Dialog); ⌘K ersetzte einen
  offenen Buchungsdialog.
- Barrierefreiheit: Die Zeile war als `role="button"` ausgezeichnet und
  verlor damit Tabellen-Semantik und Inhalt für Screenreader; jetzt ist die
  Beschreibung ein echter Knopf. Nach dem Schließen von Blatt, Palette und
  Dialogen kehrt der Fokus zurück, statt auf `<body>` zu landen.
- Mobil schnitt die Aktionen-Spalte den Betrag ab; sie entfällt dort.
- Kleinere Punkte: Warnung „fällt ins Minus“ auch für schon negative
  Konten, Einzahl-Formen („1 Termine“), leerer Reiter „Benachrichtigungen“
  für Mitglieder, Tags im Blatt ohne Bearbeitungsrecht klickbar, „Ohne
  Budget“ nur sichtbar, wenn schon Budgets existierten, Jahresvergleichs-
  Säulen ohne Drilldown.

### Welle 4

**E-18 · Stornos in allen Summen neutral (Befund beim Umsetzen).** Ein
Storno ist eine Gegenbuchung mit umgekehrter Art. Für Salden stimmt das —
in Summen stand die stornierte Ausgabe aber weiter in Ausgaben, Budget und
Auswertung, und die Gegenbuchung erschien als „Einnahme“ in einer
Ausgabenkategorie. Wer eine Fehlbuchung storniert, erwartet ein korrigiertes
Budget.

- _Alternative A:_ Gegenbuchung am Storno-Datum negativ gegen die Ausgaben
  rechnen. Der Monat der Fehlbuchung bliebe falsch, der Storno-Monat bekäme
  negative Kategoriewerte.
- _Gewählt:_ Original und Gegenbuchung zählen in Summen **beide nicht**
  (`contracts/flows.ts`) — das entspricht einer Verrechnung am Datum des
  Originals. Salden, Listen und die Kostenaufteilung rechnen unverändert mit
  beiden Buchungen. Die Summen der Transaktionsliste bestimmen die Paare aus
  allen sichtbaren Buchungen, damit ein Storno im Folgemonat den Vormonat
  korrigiert.

**E-19 · Massenbearbeitung als eigener Endpunkt, alles oder nichts (B4).**

- _Alternative:_ Im Browser `updateTransaction` je Buchung aufrufen. Keine
  Atomarität, 500 Anfragen, 500 Budget-Prüfungen.
- _Gewählt:_ `bulkUpdateTransactions` prüft zuerst alles (Existenz,
  Schreibrecht auf jedem Konto, Ziele) und schreibt dann in einer
  Transaktion — ein fremdes Privatkonto in der Auswahl ändert nichts. Jede
  Buchung bekommt trotzdem ihren eigenen Verlaufs- und Audit-Eintrag. (Die
  Beleg-Dateien entfernt das Löschen wie beim Einzellöschen vorab — erst
  nach allen Prüfungen, aber außerhalb der Datenbank-Transaktion.)
  Kategorien, die nicht zur Art passen (Ausgaben-Kategorie auf einer
  Einnahme, Umbuchungen), werden übersprungen und gemeldet statt die ganze
  Auswahl abzulehnen — typisch enthält eine Import-Auswahl eine Umbuchung.
  Die Auswahl gibt es nur am Desktop; mobil fehlt der Platz für eine
  Checkbox-Spalte, und Massenarbeit nach einem Import findet dort kaum statt.

**E-20 · „Wiederkehrend machen“ über die bestehende Vorbefüllung (B7).** Das
Detail-Blatt öffnet den Dauerbuchungs-Dialog über dieselben URL-Parameter
wie „Sparrate einrichten“. Die erste Fälligkeit ist der erste Termin **nach
heute** im Takt der Buchung (`nextOccurrenceAfter`) — aus einer Buchung vom
März würde sonst eine Fälligkeit im April, die der Cron sofort fünfmal
nachbuchte. Der Takt bleibt am Tag der Buchung und weicht nur am Monatsende
aus (31.08. → 30.09.); wechselt man im Formular das Intervall, rechnet es
die Fälligkeit aus dem Buchungsdatum neu, solange man sie nicht selbst
geändert hat (Jahresprämie vom 15.03. → nächster 15.03.). `advanceDate` wanderte dafür nach
`contracts/planning.ts`, damit Frontend und Cron dieselben Termine rechnen.
Den Ursprung nennt nur das Aktivitäten-Log; ein Schemafeld wäre für diese
Information zu viel.

**E-21 · „Sichtbares Vermögen“ ohne Anzahl der verborgenen Konten (H1).**
Die Story schlug „1 privates Konto ohne Einsicht“ vor. Schon die Anzahl
verrät etwas über die privaten Finanzen des Partners. Gezeigt wird deshalb
nur, **dass** die Summe nicht alles enthält („ohne private Konten
anderer“); Admins sehen „davon N nur lesend“ für die fremden Privatkonten,
die sie ohnehin lesen dürfen.

**E-22 · Aufschlüsselung mit ehrlichem Vergleich (F6, F8).** Reicht der
Zeitraum in die Zukunft (laufender Monat, „dieses Jahr“), wird er für die
Rechnung auf heute gekürzt — sonst verglich man einen halben Monat mit einem
ganzen. Vergleich wahlweise mit dem gleich langen Zeitraum davor oder
denselben Tagen im Vorjahr (für Jahresvergleiche natürlicher). „Person“
heißt „bezahlt von“ (`userId`); wer eine Ausgabe *getragen* hat, zeigt die
Aufteilung. Eine Buchung mit mehreren Tags zählt bei jedem Tag — der Hinweis
steht direkt über der Tabelle.

**E-23 · Schnellerfassung: Schalter statt Vorzeichen, Rückgängig statt
Bestätigung (B5, B8).** Das „-“ funktioniert weiter (Gewohnheit), der
Schalter macht die Einnahme aber ohne Minuszeichen erreichbar, das auf
Handy-Tastaturen versteckt liegt. Statt einer Rückfrage vor dem Buchen gibt
es zehn Sekunden „Rückgängig“ — schneller für den Normalfall, sicher für den
Tippfehler. „Abhebung“ erscheint nur, wenn es ein Bargeldkonto gibt; im
großen Buchungsdialog bleibt die Abhebung eine normale Umbuchung.

**E-24 · Natives Datumsfeld plus „Heute“/„Gestern“ (J8).** Ein eigener
Kalender (`react-day-picker`) wäre auf dem Handy schlechter als der
System-Kalender, bräuchte eigene Barrierefreiheit und eine Übersetzung. Das
native Feld zeigt das Datum im Format des Geräts; die zwei Knöpfe decken die
Tage ab, an denen fast alle Belege entstehen.

**E-25 · Checklisten und Hinweise mit Aktion statt Nullwerten (I1–I3).**
Jedes Modul zeigt oben, was fehlt und was es freischaltet, mit dem passenden
Dialog am Punkt; die Karte verschwindet, wenn alles erledigt ist. Der
Deckungs-Check gruppiert nach Dringlichkeit und bündelt gleichartige
Hinweise („2 Policen ohne erfasste Deckungen“). „Als gekündigt markieren“
aus der Story wurde bewusst nicht als Ein-Klick-Aktion gebaut: Ohne
Vertragsende gilt eine gekündigte Police als weiter deckend, der Check fände
die entstehende Lücke nie. Deshalb öffnet „Kündigung erfassen“ die Police,
wo Status und Enddatum zusammen gesetzt werden.

**E-26 · Geldfluss mobil als Liste nur ohne gespeicherte Wahl (G7).** Wer das
Diagramm einmal gewählt hat, bekommt es wieder — die Breite entscheidet nur
den Standard.

**Review von Welle 4 — gefunden und behoben:**

- **Massenbearbeitung:** Nach „Kategorie setzen“ im Filter „Ohne Kategorie“
  verschwanden die Zeilen, blieben aber ausgewählt — die nächste Aktion
  (auch „Löschen“) hätte unsichtbare Buchungen getroffen. Die Leiste zählt
  jetzt nur Buchungen, die in der Liste stehen.
- **Abhebung:** War das Schnellkonto selbst die Kasse, fiel „Abhebung
  nachtragen“ still auf eine weitere Ausgabe auf der Kasse zurück. Die
  Abhebung kommt jetzt von einem Konto, das keine Kasse ist, mit sichtbarer
  Wahl von/auf; fehlt eines davon, sagt die App es, statt still anders zu
  buchen.
- **Existenz-Orakel:** Die Massen-Endpunkte antworteten auf eine fremde
  Privatbuchung anders als auf eine nicht existierende; eine unsichtbare
  Ursprungsbuchung bei „Wiederkehrend“ warf einen Fehler. Beides verhält
  sich jetzt wie „gibt es nicht“.
- **Verwaiste Gegenbuchung:** Wurde ein storniertes Original gelöscht, fiel
  die Gegenbuchung aus allen Summen, steckte aber weiter im Saldo. Paare
  zählen jetzt nur, wenn beide Buchungen existieren.
- Die Vorbefüllung „Wiederkehrend“ hing nach „Abbrechen“ an der nächsten
  neuen Dauerbuchung (samt falschem Rückverweis im Log); Monatsende und
  Intervallwechsel siehe E-20.
- Die Sparziel-Karte meldete „Rate nötig“ auch für Ziele mit Quellen auf
  fremden Privatkonten (und kurz während des Ladens).
- Kleinere Punkte: Hypotheken-Checkliste blieb für Mitglieder offen, wenn die
  Zins-Dauerbuchung auf einem fremden Privatkonto lag; Vorjahresvergleich
  über mehr als ein Jahr überlappte sich selbst, Schalttag; Fixkosten-Ø über
  sechs Monate auch bei jungen Haushalten; „Ohne Tag“ verlinkte auf alles;
  inaktive Personen in der Massenbearbeitung; „Kategorie entfernen“ bei
  Umbuchungen als „übersprungen“ gemeldet; Konten im Minus fielen auf der
  Dashboard-Karte zuerst hinter „+ N weitere“; Segment-Schalter ohne
  Pfeiltasten; „Nachtragen“ landete in der Tabellenansicht der Konten, die
  weder Kassen-Zettel noch „Kasse zählen“ zeigt.
