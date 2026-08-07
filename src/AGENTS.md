# src/AGENTS.md — Frontend (React)

Detail-Doku zum Frontend. Übergeordnetes: `../AGENTS.md`.

## Struktur

- `App.tsx` — Routing (deutsche Pfade: /transaktionen, /konten, ...).
- `pages/` — Eine Komponente pro Seite (Dashboard, Transactions, ...).
- `components/` — `Layout.tsx`, `TransactionDialog.tsx`, `AccountDialog.tsx`
  (Anlegen/Bearbeiten/Löschen von Konten inkl. Sichtbarkeits-Freigaben und
  Gefahrenzone), `GoalDialog.tsx` (Muster AccountDialog, Löschen nur in der
  Gefahrenzone des Edit-Dialogs mit AlertDialog-Bestätigung),
  `CsvImportDialog.tsx`, `CamtImportDialog.tsx`,
  `TransactionAttachmentsDialog.tsx` (Belege/Fotos einer Buchung: ansehen,
  hochladen, löschen), `TransactionHistoryDialog.tsx` (Änderungsverlauf),
  `QuickAddDialog.tsx`, `SearchableSelect.tsx`,
  `PensionFundDialog.tsx`/`PensionPillar3Dialog.tsx` (Vorsorge-Dialoge),
  `PensionFundStatement.tsx` (Versicherungsausweis-Dialog einer Kasse:
  Kennzahlen, Abstufungs-Tabelle + Stufen-Balken, Projektions-Chart mit
  Phasen-Bändern, Risikoleistungen; Kopf zeigt „Angaben per <Stichtag>",
  wenn die Kasse einen valueDate-Stichtag hat, sonst „Stand: heute"),
  `PensionAttachments.tsx` (Anhänge von Vorsorge-Datensätzen),
  `MortgagePropertyDialog.tsx`/`MortgageTrancheDialog.tsx`/
  `MortgageAmortizationDialog.tsx`/`MortgageTransferDialog.tsx`
  (Hypotheken-Dialoge, Muster PensionFundDialog),
  `InsurancePolicyDialog.tsx`/`InsuranceCoverageDialog.tsx`/
  `InsuranceTransferDialog.tsx`/`InsuranceAttachments.tsx`
  (Versicherungs-Modul, Muster Hypotheken bzw. PensionAttachments),
  `ui/` (shadcn/ui, nicht von Hand umschreiben — via shadcn generiert).
- `providers/` — `trpc.tsx` (tRPC + QueryClient, importiert den Typ
  `AppRouter` aus `api/router.ts`), `auth.tsx`.
- `lib/` — `finance.ts` (Berechnungen, Cent-Helfer, Locale), `data.ts`,
  `utils.ts` (cn), `moneyflow.ts`, `recurring.ts`, `insurance.ts`
  (`buildComparison` — Zeilen der Policen-Vergleichstabelle).

## Navigation (Layout.tsx)

Die Menüstruktur steht zentral in `navGroups` (thematisch gruppiert:
Alltag = Dashboard/Transaktionen/Wiederkehrend/Aufteilung, Konten =
Konten/Geldfluss, Planung = Budgets/Sparziele/Vorsorge/Hypotheken/
Versicherungen, Analyse =
Prognosen/Auswertung, Verwaltung = Personen/Einstellungen) und speist
beide Navigationen: die Desktop-Seitenleiste (mit Gruppen-Labels, im
eingeklappten Zustand nur Icons + Trennlinien) und die mobile Ansicht —
dort zeigt die untere Leiste vier Schnellzugriffe (`mobilePrimary`:
Dashboard, Transaktionen, Konten, Budgets) plus „Mehr", das ein
Bottom-Sheet (`ui/sheet`) mit allen Bereichen in derselben Gruppierung
öffnet. Neue Seiten: Route in `App.tsx` + Eintrag in `navGroups` — beide
Navigationen bekommen sie dann automatisch.

## Zentrale Helfer (lib/finance.ts)

- `formatCents` / `parseEuro` für Geldbeträge (Cent-Integer, siehe Root-
  AGENTS.md), `currencySymbol` — beide nutzen die App-Währung als Default;
  das Layout lädt sie via `finance.getAppSettings` und setzt sie mit
  `setAppCurrency`. Für die **Vorbefüllung von Eingabefeldern** gibt es
  `formatAmountInput` (locale-konformes Dezimalzeichen, ohne Tausender-
  gruppierung) — niemals `.toFixed(2).replace('.', ',')` o. ä. hardcoden.
  Prozente: `parsePercent`/`formatBp` (Basispunkte), Dateigrößen:
  `formatBytes` — alle locale-konform.
- `getUserLocale()` liefert die Browser-Region (`navigator.language`),
  zentral für alle Zahlen- und Datumsformate. Datums-Anzeige ausschließlich
  über `formatDate` / `formatMonth` / `formatMonthShort` /
  `formatMonthYearShort` (Chart-Achsen) — niemals Monatsnamen per String-
  Slicing oder Zeichenketten wie `TT.MM.JJJJ` selbst zusammenbauen.
- `expensesByRootCategory` rollt Ausgaben auf Oberkategorien auf
  (Dashboard); `listCategories` bleibt flach, der Baum wird im Frontend
  gebaut.
- `memberBalances` berechnet die Aufteilungs-Salden — Einnahmen MIT Splits
  zählen umgekehrt wie Ausgaben (damit sich Stornos exakt aufheben).

## Auswahlfelder

Datengetriebene Selects (Konten mit Bank im Label, Kategorien, Personen,
Banken, Kontotypen, Tags, Projekte, Sparziel-Konto-Verknüpfung) nutzen
`components/SearchableSelect.tsx` (Popover + cmdk-Command: Suchfeld
„Suchen…", leere Trefferliste „Nichts gefunden.", Check-Mark auf der
gewählten Option, Trigger im SelectTrigger-Styling; API `{value,
onValueChange, options: {value, label}[], placeholder?, disabled?,
className?}`). Kleine Enum-Selects (Buchungsart, Intervall, Status,
Zeitraum/Modus, Rolle) bleiben native Selects — eine Suche bei 2–4 Optionen
wäre UX-Rauschen. Alle SelectTrigger bekommen Truncation (`min-w-0
[&>span]:truncate`, in Dialog-Grids zusätzlich `w-full`) und ein
`title`-Attribut mit dem Label der gewählten Option (SearchableSelect bringt
beides eingebaut mit).

## Mobile Breite: kein seitliches Scrollen der Seite

Die Seite selbst darf nie horizontal scrollen — seitwärts scrollt nur der
jeweilige Container (Tabellen via `ui/table` und Karten mit
`overflow-x-auto`), damit sich die mobile Navigation wie in einer nativen
App anfühlt. Dafür sorgen drei Ebenen:

- `Layout.tsx`: `<main>` hat `min-w-0 overflow-x-clip` als harte Grenze.
- `index.css`: `body { overflow-wrap: anywhere }` — lange Wörter
  (Kontonamen, IBANs, E-Mails) brechen um, statt ihren Container zu dehnen.
  Elemente mit `whitespace-nowrap` (Tabellenzellen, Badges, Buttons) bleiben
  bewusst unberührt.
- `ui/card.tsx`: `Card` hat `min-w-0`, damit Karten ihre Grid-/Flex-Spalte
  nie sprengen.

Beim Bauen neuer Listen/Karten gilt: Flex-Zeilen mit Name + Betrag bekommen
`gap-*`, der Namensteil `min-w-0` (plus `truncate` bei einzeiligen Zeilen,
`title` mit dem vollen Namen), der Betrag/Aktionsteil `shrink-0`.
Badges mit Benutzertexten zusätzlich `max-w-full whitespace-normal`.

## Dialog-Layouts (responsive)

Die Bearbeiten-Dialoge (AccountDialog, TransactionDialog, GoalDialog,
Dauerbuchung in `pages/Recurring.tsx`, CategoryEditDialog in
`pages/Settings.tsx`) nutzen `max-h-[90vh] overflow-y-auto`, auf Desktop
`sm:max-w-2xl` (kleine Dialoge wie GoalDialog/CategoryEditDialog
`sm:max-w-lg`). Zusammengehörige Felder stehen zweispaltig per `grid gap-4
sm:grid-cols-2` (mobil einspaltig gestapelt); lange Bereiche (Splits, Tags,
Freigaben, Kontoabgleich, Gefahrenzone) bleiben vollbreit.

## UI-State in localStorage

Darstellungsart der Konten-Seite (Karten/Tabelle) unter dem Key
`ff-accounts-view`, der Dauerbuchungen-Seite unter `ff-recurring-view`;
eingeklappte Seitenleiste unter `ff-sidebar-collapsed`; gewählte
Berichts-Abschnitte unter `ff-report-sections`.

## Seiten-Besonderheiten

- **Schnellerfassung**: `components/QuickAddDialog.tsx` (Button „Schnell" im
  Layout-Header) bucht mit nur Betrag + Notiz; positiv = Ausgabe, negativ
  (mit „-") = Einnahme. Das Buchungskonto ist pro Benutzer konfigurierbar
  (`users.quickAccountId` via `auth.setQuickAccount`, erfordert `edit`-
  Recht; null/Default = erstes Konto mit `access === "edit"`) und wird im
  Dialog per SearchableSelect angezeigt/gewählt (Wahl wird direkt
  gespeichert). Weitere Defaults: zuletzt verwendete Kategorie der
  jeweiligen Art, heutiges Datum, aktueller User.
- **Transaktionen**: Tag-Auswahl + Inline-Anlage im Details-Bereich des
  TransactionDialog, Badges + Tag-Filter + Tag-Popover zum nachträglichen
  Taggen in der Liste (Tag-Namen sind Teil des Such-Haystacks). Edit-Modus
  im TransactionDialog (Prop `transaction`, Art-Wahl deaktiviert mit
  title-Hinweis, Änderungskommentar-Feld, Hinweis bei Dauerbuchungs-
  Instanzen, Belege nur im Create-Modus), Stift-Button nur bei `edit`
  (Remount-Key aus changeCount/tags), „bearbeitet"-Badge bei changeCount > 0
  öffnet den Änderungsverlauf-Dialog. Löschen UND Stornieren laufen über
  AlertDialoge, die den konkreten Saldo-Effekt erklären.
- **Konten**: Filter nach Bank/Kontotyp, Suche (Name/Bank/IBAN), Karten-/
  Tabellenansicht (sortierbar, Total in der Fußzeile), aufklappbarer Bereich
  „Saldo-Verlauf" pro Konto-Karte (Zeitraum-Wahl + recharts-AreaChart, Query
  nur bei geöffnetem Zustand) inkl. gestrichelter Prognose-Fortsetzung über
  12 Monate (`forecast.accountBalance`, Toggle „Prognose", Default an; der
  letzte Ist-Wert wird zusätzlich als Prognose-Startpunkt gesetzt, sonst
  klafft eine Lücke zwischen den Linien), Besitzer-Namen klein auf der Karte,
  Besitzer-Checkboxen in der Sichtbarkeits-Sektion des AccountDialog (nur
  für Besitzer), Sektion „Kontoabgleich" im Edit-Modus.
- **Dauerbuchungen** (`pages/Recurring.tsx`): gemeinsame Formular-Komponente
  für Anlegen + Bearbeiten (Art-Wahl im Edit deaktiviert), Stift-Button nur
  bei `edit` aufs Konto, Filter-Zeile (Typ/Konto/Person/Status) mit Zähler,
  Karten-/Tabellenansicht. Löschen ausschließlich über die Gefahrenzone im
  Bearbeiten-Dialog (AlertDialog-Bestätigung). Abgelaufene Dauerbuchungen
  (endDate < heute): Badge „Archiviert" statt Aktiv/Pausiert, abgeschwächt,
  ans Ende sortiert (aktive nach nextDate zuerst), eigener
  Status-Filterwert; Logik in `lib/recurring.ts` (`isRecurringArchived`,
  `sortRecurring`).
- **Sparziele** (`pages/Goals.tsx`): gestapelter Herkunfts-Balken (auch bei
  offenen Zielen, damit die Aufteilung farblich erkennbar ist), Herkunfts-
  Zeilen „Konto — Modus → Betrag" + „Manuell (Bestand)", Hinweis „Enthält
  verborgene Quellen", Prognose-Zeile, Quellen-Verwaltung per Dialog (zeigt
  nach der Konto-Wahl den freien Betrag „Verfügbar: X" via
  `finance.goalSourceAvailability`). Offene Ziele: „offenes Ziel"-Badge
  statt Prozent/Prognose.
- **Splitting** (`pages/Splitting.tsx`): filtert Salden,
  Ausgleichsvorschläge und die Liste geteilter Ausgaben pro Projekt (Chips:
  Alle / Haushalt / je Projekt); verbuchte Ausgleiche übernehmen das gewählte
  Projekt. Sektion „Projekte & Vorlagen": Projekt-Anlage mit Farbpalette,
  Löschen von Projekten und Aufteilungsvorlagen. Vorlagen-Select im
  Split-Bereich des TransactionDialog (gespeicherte Vorlagen + Schnellwahl
  60/40, 70/30), „Als Vorlage speichern" aus den aktuellen Anteilen.
- **Jahresvergleich**: `pages/YearReview.tsx` unter `/auswertung` (Nav
  „Auswertung").
- **Bericht** (`pages/Report.tsx` unter `/bericht`, Nav „Bericht" nach
  „Auswertung", Icon `FileDown`): stellt den Export zusammen — eine Checkbox
  je Eintrag aus `REPORT_SECTIONS` (`contracts/report.ts`, geteilt mit der
  Backend-Validierung), Horizont-Select für die Nettovermögens-Prognose,
  zwei Download-Buttons. Die Auswahl liegt in `localStorage`
  (`ff-report-sections`). Abschnitte ohne Daten bekommen ein „keine
  Daten"-Badge aus den vorhandenen Summary-Queries (`mortgage.summary`,
  `insurance.summary`, `pension.getProfile`, …) — das ist **nur ein
  Vorab-Hinweis**, gesammelt wird serverseitig neu. Der Download läuft wie
  `downloadBackup` in `pages/Settings.tsx` über `fetch` + Blob (die Routen
  liefern Binärdaten, sind also bewusst kein tRPC-Endpunkt) und schickt
  `getUserLocale()` mit, weil das PDF serverseitig formatiert wird.
- **Prognosen** (`pages/Forecasts.tsx`): „Szenario"-Card (Slider +
  Kategorie-Select, Badge bei aktivem Szenario), ohne ETA-Anzeige bei
  offenen Sparzielen. Darunter die Card „Prognose-Tabelle"
  (`components/ForecastTable.tsx`): eigene Toolbar mit Horizont-Select
  (1/2/3/5/10 Jahre) und Aggregations-Select aus
  `FORECAST_GRANULARITY_LABELS` plus Switch „Ø variable Buchungen
  einbeziehen" — die Auswahl oben rechts gehört weiter zum Diagramm und
  reicht nur bis 36 Monate. Die Tabelle hat eine **sticky erste Spalte**
  (`sticky left-0 z-10 bg-card`) und scrollt im eigenen `overflow-x-auto`
  von `ui/table` — bei Monatsspalten über 10 Jahre sind das 120 Spalten, die
  Seite selbst darf nie seitlich scrollen. Zeilengruppen: Konten, Gesamt,
  Nettovermögen, Bewegung je Periode, Sparziele; die Periode, in der ein
  Sparziel seinen Zielbetrag erreicht, ist grün mit Häkchen markiert, offene
  Ziele zeigen Badge „offenes Ziel" ohne Prozent. Das Szenario der Card
  darüber wird als Prop durchgereicht.
- **Einstellungen** (`pages/Settings.tsx`): Sektionen u. a. Kontotypen &
  Banken, Tags (Card), Kategorien-Baum mit Stift-Button pro Kategorie
  (`CategoryEditDialog`: Name, Farbpalette, Oberkategorie-Select deaktiviert
  bei eigenen Unterkategorien), Zwei-Faktor-Authentifizierung (QR-Code via
  `qrcode`-Paket als Data-URL), Card „Aktivitäten" (Audit-Log: deutsches
  Action-Mapping, Entity-Filter, „Mehr laden").
- **Login**: zweistufig bei aktiviertem TOTP (InputOTP).
- **Vorsorge** (`pages/Pension.tsx` unter `/vorsorge`, Nav „Vorsorge" nach
  „Sparziele"): privates 3-Säulen-Modul pro Benutzer. Ohne Profil nur eine
  Setup-Card („Vorsorge einrichten": Geburtsdatum, Rentenalter). Danach
  gestapelte Cards: Übersicht & Prognose (drei Säulen-Karten, gestapeltes
  AreaChart der Kapitalentwicklung, Einkommen im Alter + Ersatzrate,
  Warnungen; Stift-Button öffnet `ProfileDialog` zum nachträglichen Ändern
  von Geburtsdatum/Pensionierungsalter; Was-wäre-wenn-Feld für ein
  hypothetisches Rentenalter — eigene `forecast`-Query mit
  `retirementAge`-Override, zeigt hypothetische Renten/Ersatzrate im
  Vergleich), Lohn & Abzüge (Lohn-Timeline als Tabelle mit
  `type="month"`-Dialog — Netto-Spalte clientseitig aus Brutto minus
  globalen + eintragsbezogenen Abzügen, Badge „eigene Abzüge", Zeilen-Editor
  für eintragsbezogene Abzüge im Lohn-Dialog —, globale Abzüge in eigener
  Karte mit Aktiv-Switch, „Als Dauerbuchung
  übernehmen"-Dialog), AHV (Anzeige-Card + Bearbeiten-Dialog + Anhänge),
  Pensionskasse und Säule 3a (Karten-Grids mit Dialogen
  `PensionFundDialog`/`PensionPillar3Dialog`, Löschen in der Gefahrenzone;
  3a mit optionaler Konto-Verknüpfung via SearchableSelect, Sync-Saldo-
  Badge und Sparziel-Warnhinweis), Verlauf (Änderungshistorie, Cent-Felder
  über `MONEY_FIELDS` mit `formatCents`, `(Bp)`-Felder als Prozent).
  Die **AHV-Card** zeigt die berechnete Monatsrente, die Rentenskala n/44
  und einen Lücken-Badge; `AhvYearsDialog.tsx` erfasst die Beitragsjahre als
  Jahres-Tabelle (mit „Zeitraum füllen", weil 44 Jahre einzeln anzulegen
  Quälerei wäre), `AhvStatement.tsx` zeigt die Rentenberechnung Schritt für
  Schritt plus den Variantenvergleich Vorbezug/Aufschub. Ohne erfasste Jahre
  wird **keine** Rente angezeigt — die Engine lieferte sonst die Mindestrente
  nach Skala 1/44, eine Zahl ohne Bedeutung. Die strukturierten Warnungen
  werden in `lib/ahv.ts` (`ahvWarningText`) zu Sätzen, Muster `warningText`.
  Die Ehepartner-Verknüpfung zeigt den Zwischenzustand („Warten auf
  Bestätigung") ausdrücklich an, statt stillschweigend nichts zu tun.
  Anhänge über `PensionAttachments.tsx` (Liste via `pension.listAttachments`,
  Upload per Fetch auf `/api/pension-attachments` mit `X-Filename`-Header).
  Invalidierung zentral `useInvalidatePension()` in `lib/data.ts`;
  Prozent-Eingaben via `parsePercent`/`formatBp` in `lib/finance.ts`
  (Basispunkte).
- **Hypotheken** (`pages/Mortgages.tsx` unter `/hypotheken`, Nav
  „Hypotheken" nach „Vorsorge"): haushaltsweites Modul für Wohneigentum.
  Ohne Liegenschaft nur eine Setup-Card. Danach: Kopfzeile der gewählten
  Liegenschaft (bei mehreren ein SearchableSelect), Übersicht (KPI-Karten
  Restschuld/Ø-Zins/Monatsbelastung/Belehnung, Nettovermögen-Karte,
  Tragbarkeits-Karte, Hinweise, AreaChart Restschuld + Eigenkapital mit
  `ReferenceArea`-Marken je Zinsbindungs-Ablauf), Tranchen- und
  Amortisations-Grids mit Dialogen, Verlauf. Der Repeat-Button auf einer
  Karte öffnet `MortgageTransferDialog` („Als Dauerbuchung übernehmen") —
  er verschwindet, sobald der Rückverweis auf eine existierende
  Dauerbuchung zeigt. **Hinweise kommen als strukturierte Daten vom Server**
  (`MortgageWarning`) und werden erst in `warningText()` zu deutschen Sätzen
  — nur so lassen sich Beträge/Prozente/Daten locale-konform formatieren.
  Invalidierung zentral `useInvalidateMortgage()` in `lib/data.ts`.
- **Versicherungen** (`pages/Insurances.tsx` unter `/versicherungen`, Nav
  „Versicherungen" nach „Hypotheken", Icon `Umbrella` — `ShieldCheck` ist im
  Layout schon fürs Admin-Badge belegt): haushaltsweites Modul, aber anders
  als bei den Hypotheken eine **Liste gleichrangiger Objekte** — kein
  Auswahl-SearchableSelect im Kopf. Ohne Police nur eine Setup-Card. Danach:
  KPI-Zeile (Policen/Prämie pro Monat/pro Jahr/nächste Kündigungsfrist —
  Angebote sind aus den Prämien ausgeschlossen), **Deckungs-Check-Card**
  (bewusst weit oben, das ist der Kernnutzen), Filter-Card (Suche, Sparte,
  Status, Person, Versicherer — clientseitig über einen Haystack inkl.
  Deckungs-Bezeichnungen), Policen-Grid, Verlauf.
  - **Lücken kommen als strukturierte Daten vom Server** (`InsuranceGap`,
    Discriminated Union) und werden erst in `gapText()` zu deutschen Sätzen
    — gleiche Begründung wie bei `MortgageWarning`. Ausblendbare Hinweise
    tragen `dismissible: true`; ausgeblendete stehen aufklappbar unter
    „N ausgeblendet" — **mit Begründung, Autor und Datum** aus dem
    `dismissal`-Feld — und lassen sich zurückholen. Aus- und Einblenden
    erscheinen im Verlauf als Entity „Deckungs-Check".
  - **Deckungen stehen aufklappbar direkt in der Karte** (`ui/collapsible`),
    nicht im Dialog — der Anwendungsfall ist „beim Arzttermin antippen und
    sofort sehen, was gedeckt ist". `sumInsured === null` heißt
    **unbegrenzt**, nicht „unbekannt".
  - **Vergleichsansicht**: Checkbox je Karte, höchstens vier Policen, ab
    zwei erscheint die Tabelle inline **über** dem Grid (kein Dialog — man
    will die Auswahl währenddessen anpassen). Die Merkmalsspalte ist
    `sticky left-0 bg-card z-10`; gescrollt wird der `overflow-x-auto`-
    Container von `ui/table`, **nie die Seite**. Der beste Wert je Zeile
    (niedrigste Jahresprämie, höchste Deckungssumme) steht in
    `font-semibold text-emerald-600`. Die Zeilen baut die reine Funktion
    `buildComparison` in `lib/insurance.ts`.
  - Invalidierung zentral `useInvalidateInsurance()` in `lib/data.ts`.
- **Charts mit Bändern (recharts)**: `ReferenceArea` braucht eine
  **numerische X-Achse** (`<XAxis type="number" domain={[min, max]}>`,
  Werte als Zahl statt String) plus `ifOverflow="hidden"` — mit einer
  Kategorien-Achse liefert die Band-Skala keine Koordinaten und recharts
  verwirft das Band lautlos (leere `<g class="recharts-reference-area">`).
  So gelöst im Übersichts-Chart der Vorsorge und im Ausweis-Chart
  (`PensionFundStatement.tsx`).

## Geldfluss-Visualisierung

Seite `pages/MoneyFlow.tsx` unter `/geldfluss` (Nav „Geldfluss" nach
„Konten") stellt Konten als Knoten und Dauerbuchungen als gerichtete Kanten
dar (rein frontendseitig aus `listAccounts`/`listRecurring`). Die reine
Funktion `buildMoneyFlow` in `lib/moneyflow.ts` baut den Graphen im
Sankey-Stil: Spalten-Layout (`layoutColumns` — links Einnahmen-Block, Mitte
Konten in 1 Spalte bis 6, 2 Spalten ab 7, 3 Spalten ab 15, rechts
Ausgaben-Block; Y-Positionen gleichmäßig, Container-Höhe wächst mit der
Kontenzahl und wird als `heightPx` geliefert, die Seite scrollt). Sortierung
zur Kreuzungsminimierung: Hauptfluss (Einnahmen-Empfänger oben,
Ausgaben-Zahler unten) plus ein sequenzieller Barycenter-Pass, der
Transfer-Partner benachbart zieht. Beträge auf Monat normalisiert
(wöchentlich × 52/12, jährlich ÷ 12, gerundet); Linienstärke kontinuierlich
proportional zum Betrag (`width`, 2–18 px linear auf das Maximum), pausierte
Dauerbuchungen gestrichelt. Die Pseudo-Knoten Einnahmen/Ausgaben sind Blöcke
im Konto-Karten-Format mit den Monatssummen (`incomeTotal`/`expenseTotal`).

Darstellung in `components/MoneyFlowChart.tsx`: SVG-S-Kurven (kubische
Bezier, Kontrollpunkte auf halbem Weg; Kanten innerhalb einer Spalte weichen
als Bogen zur Seite aus) mit Arrowhead-Markern und Label-Badges auf der
Kurve (Position `labelT`: parallele Kanten gleicher Quelle bzw. gleichen
Ziels werden entlang der Kurve gestaffelt — Quell-Gruppen Richtung Ziel,
Ziel-Gruppen Richtung Quelle, dicke Kanten zentraler; ab 5 Geschwistern
kompaktes Badge via `labelCompact`), darüber absolut positionierte
HTML-Knoten (Positionen in Prozent); Hover auf einen Knoten hebt seine
Kanten hervor. Konten ohne jede Kante (pausierte Dauerbuchungen zählen als
Verbindung) fliegen aus dem Diagramm: `buildMoneyFlow` liefert sie als
`unconnected`, Layout/Höhenformel rechnen nur mit den verbundenen Konten,
und die Seite zeigt sie in einer abgesetzten Card „Ohne Geldflüsse"
unterhalb der Grafik (flex-wrap, gleiches Karten-Design via
`MoneyFlowAccountCard`). Die endgültige Label-Position (`labelX`/`labelY`)
ermittelt `assignLabelPositions` nach `assignLabelT` als Repulsion-Pass über
einem Kollisionsmodell aus achsenparallelen Rechtecken in geschätzten
Pixeln (`nodeRectPx`/`labelRectPx`, angenommene Container-Breite 1000 px):
Start auf der Kurve bei `labelT`, bei Kollision mit einer Karten- oder
bereits platzierten Label-Box iterative Verschiebung senkrecht zur
Kurventangente (plus rein horizontal — Kurvenenden haben waagrechte
Tangenten) in den freien Raum, beide Seiten (zuerst weg vom näheren
Endknoten), wachsender Offset, `t` lokal ±0,05, Clamping im Container;
Karten-Überlappung zählt vierfach, Fallback ist die Position mit der
geringsten Überlappung. `edgeGeometry` (Pfad, Punkt, Tangente) liegt in
`lib/moneyflow.ts` und wird vom Chart importiert.

## Dark Mode & PWA

- **Dark Mode**: Umschalter im Layout-Header, via next-themes
  (`ThemeProvider` in `main.tsx`, `attribute="class"`, System-Default); die
  `.dark`-Variablen stehen in `index.css`.
- **PWA**: Grundgerüst ohne Service Worker —
  `public/manifest.webmanifest` plus Icons in `public/icons/` (Quell-SVG
  `icon.svg`, PNGs daraus gerendert), eingebunden in `index.html`.
