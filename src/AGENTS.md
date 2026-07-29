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
  `PensionAttachments.tsx` (Anhänge von Vorsorge-Datensätzen),
  `ui/` (shadcn/ui, nicht von Hand umschreiben — via shadcn generiert).
- `providers/` — `trpc.tsx` (tRPC + QueryClient, importiert den Typ
  `AppRouter` aus `api/router.ts`), `auth.tsx`.
- `lib/` — `finance.ts` (Berechnungen, Cent-Helfer, Locale), `data.ts`,
  `utils.ts` (cn), `moneyflow.ts`, `recurring.ts`.

## Zentrale Helfer (lib/finance.ts)

- `formatCents` / `parseEuro` für Geldbeträge (Cent-Integer, siehe Root-
  AGENTS.md), `currencySymbol` — beide nutzen die App-Währung als Default;
  das Layout lädt sie via `finance.getAppSettings` und setzt sie mit
  `setAppCurrency`.
- `getUserLocale()` liefert die Browser-Region (`navigator.language`),
  zentral für alle Zahlen- und Datumsformate.
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
eingeklappte Seitenleiste unter `ff-sidebar-collapsed`.

## Seiten-Besonderheiten

- **Schnellerfassung**: `components/QuickAddDialog.tsx` (Button „Schnell" im
  Layout-Header) bucht eine Ausgabe mit nur Betrag + Notiz; Defaults: erstes
  Konto mit `access === "edit"`, zuletzt verwendete Ausgaben-Kategorie,
  heutiges Datum, aktueller User.
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
  nur bei geöffnetem Zustand), Besitzer-Namen klein auf der Karte,
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
- **Prognosen** (`pages/Forecasts.tsx`): „Szenario"-Card (Slider +
  Kategorie-Select, Badge bei aktivem Szenario), ohne ETA-Anzeige bei
  offenen Sparzielen.
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
  Warnungen), Lohn & Abzüge (Lohn-Timeline als Tabelle mit
  `type="month"`-Dialog, Abzüge mit Aktiv-Switch, „Als Dauerbuchung
  übernehmen"-Dialog), AHV (Anzeige-Card + Bearbeiten-Dialog + Anhänge),
  Pensionskasse und Säule 3a (Karten-Grids mit Dialogen
  `PensionFundDialog`/`PensionPillar3Dialog`, Löschen in der Gefahrenzone;
  3a mit optionaler Konto-Verknüpfung via SearchableSelect, Sync-Saldo-
  Badge und Sparziel-Warnhinweis), Verlauf (Änderungshistorie, Cent-Felder
  über `MONEY_FIELDS` mit `formatCents`, `(Bp)`-Felder als Prozent).
  Anhänge über `PensionAttachments.tsx` (Liste via `pension.listAttachments`,
  Upload per Fetch auf `/api/pension-attachments` mit `X-Filename`-Header).
  Invalidierung zentral `useInvalidatePension()` in `lib/data.ts`;
  Prozent-Eingaben via `parsePercent`/`formatBp` in `lib/finance.ts`
  (Basispunkte).

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
