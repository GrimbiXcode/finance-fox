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
  `Note.tsx` (Notizzettel für Hinweise/Erinnerungen), `BrandMark.tsx`
  (Fuchs als Stempel), `ui/` (shadcn/ui, via shadcn generiert — nicht von
  Hand umschreiben; die wenigen bewussten Papier-Anpassungen tragen einen
  Kommentar `// Papier:` und sind unter „Papier-Design“ aufgezählt).
- `providers/` — `trpc.tsx` (tRPC + QueryClient, importiert den Typ
  `AppRouter` aus `api/router.ts`), `auth.tsx`, `actions.tsx` (globale
  Dialoge, Kürzel), `scope.tsx` („Meine Sicht“, siehe unten).
- `lib/` — `finance.ts` (Berechnungen, Cent-Helfer, Locale), `data.ts`,
  `utils.ts` (cn), `moneyflow.ts`, `recurring.ts`, `insurance.ts`
  (`buildComparison` — Zeilen der Policen-Vergleichstabelle),
  `download.ts` (`saveBlobAsFile`/`filenameFromResponse` — **jeder**
  Dateidownload läuft darüber, siehe „Downloads"), `serviceWorker.ts`
  (Registrierung und Nachrichtenbrücke zum Offline-Teil), `syncLabels.ts`
  und `syncTime.ts` (Beschriftungen der Abgleich-Seite).
- `sw/` und `offline/` — der Offline-Teil; eigenes tsconfig-Projekt
  (`tsconfig.sw.json`, WebWorker- statt DOM-lib). Siehe „Offline-Betrieb".

## Navigation (Layout.tsx)

Die Menüstruktur steht zentral in `navGroups` (`lib/navigation.ts`,
thematisch gruppiert:
Alltag = Dashboard/Transaktionen/Wiederkehrend/Aufteilung, Konten =
Konten/Geldfluss, Planung = Budgets/Sparziele/Vorsorge/Hypotheken/
Versicherungen, Analyse =
Prognosen/Auswertung, Verwaltung = Personen/Verlauf/Einstellungen) und speist
drei Stellen: die Befehlspalette (Einträge mit `keywords` für Synonyme) und
beide Navigationen: die Desktop-Seitenleiste (mit Gruppen-Labels, im
eingeklappten Zustand nur Icons + Trennlinien) und die mobile Ansicht —
dort zeigt die untere Leiste vier Schnellzugriffe (`mobilePrimary`:
Dashboard, Transaktionen, Konten, Budgets) plus „Mehr", das ein
Bottom-Sheet (`ui/sheet`) mit allen Bereichen in derselben Gruppierung
öffnet. Neue Seiten: Route in `App.tsx` + Eintrag in `navGroups` — beide
Navigationen und die Befehlspalette bekommen sie dann automatisch.

**Globale Aktionen** (`providers/actions.tsx`, `ActionsProvider` in
`App.tsx`): hält, welcher globale Dialog offen ist (`'transaction' |
'quick' | 'palette' | 'shortcuts'`), und die Tastenkürzel — ⌘/Strg+K
(Befehlspalette, auch in Eingabefeldern), `n` (neue Buchung), `s`
(Schnellerfassung), `/` (Suche), `?` (Kürzel-Übersicht). Die Buchstaben
wirken nur außerhalb von Eingabefeldern und wenn kein Dialog offen ist.
Die Buchstaben greifen auch nicht auf Auswahllisten und Menüs
(`role="combobox"|"listbox"|"menu"`), ⌘K nicht über einem anderen Dialog.
`useActions().show('quick')` öffnet einen Dialog von überall; das Layout
rendert Befehlspalette (`components/CommandPalette.tsx`), Kürzel-Hilfe
(`ShortcutsDialog.tsx`) und den kontrollierten `TransactionDialog`
(Props `open`/`onOpenChange`; ohne `trigger` rendert er dann keinen Knopf;
`key={seq}` setzt das Formular bei jedem Öffnen neu auf). Nach dem
Schließen führt `restoreFocus` den Fokus aufs Element davor zurück.

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
  zählen umgekehrt wie Ausgaben (damit sich Stornos exakt aufheben). Die
  Funktion liegt in `contracts/settlement.ts` (auch der Server rechnet damit)
  und wird hier nur weitergereicht.
- **Keine Buchungsliste in `useFinanceData`**: Seiten holen genau ihren
  Ausschnitt — `finance.searchTransactions` (Liste, Infinite-Query),
  `dashboard.summary`, `listAccounts` (`balance`, `txCount`),
  `finance.categoryUsage`, `listTransactions({ sharedOnly: true })`.
  Invalidierung zentral in `useInvalidateFinance`.

## Auswahlfelder

Datengetriebene Selects (Konten mit Bank im Label, Kategorien, Personen,
Banken, Kontotypen, Tags, Projekte, Sparziel-Konto-Verknüpfung) nutzen
`components/SearchableSelect.tsx` (Popover + cmdk-Command: Suchfeld
„Suchen…", leere Trefferliste „Nichts gefunden.", Check-Mark auf der
gewählten Option, Trigger im SelectTrigger-Styling; API `{value,
onValueChange, options: {value, label}[], placeholder?, disabled?,
className?}`). Kleine Enum-Selects (Buchungsart, Intervall, Status,
Zeitraum/Modus, Rolle) bleiben native Selects — eine Suche bei 2–4 Optionen
wäre UX-Rauschen. Optional `pinned` (+ `pinnedLabel`, Default „Häufig“):
eine Gruppe über der vollen Liste — der Buchungsdialog setzt dort die fünf
meistgenutzten Kategorien der gewählten Art (`finance.categoryUsage`, B3);
die Werte der Gruppe tragen intern ein Suffix, damit cmdk sie von der
Hauptliste unterscheidet. Alle SelectTrigger bekommen Truncation (`min-w-0
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

## Downloads

Alle Dateidownloads (Bericht als PDF/Excel, Datenbank-Backup, CSV-Export)
laufen über `lib/download.ts` — nie von Hand einen Anker bauen. Der Helfer
hängt den Anker ins Dokument und gibt die Objekt-URL erst verzögert frei;
ein `URL.revokeObjectURL` direkt nach dem Klick lässt den Download in
Chromium-Browsern (Chrome, Arc, Edge) bei vollständig geladener Datei
hängen, ohne dass er je abschliesst. Den Dateinamen liefert
`filenameFromResponse(res, fallback)` aus dem `Content-Disposition`-Header
der Antwort.

## UI-State in localStorage

Darstellungsart der Konten-Seite (Karten/Tabelle) unter dem Key
`ff-accounts-view`, der Dauerbuchungen-Seite unter `ff-recurring-view`,
des Geldflusses unter `ff-moneyflow-view` (ohne gespeicherte Wahl unter
640 px die Liste);
eingeklappte Seitenleiste unter `ff-sidebar-collapsed`; gewählte
Berichts-Abschnitte unter `ff-report-sections`; ausgeblendete „Erste
Schritte“ unter `ff-getting-started-hidden`; Gruppierung der
Transaktionsliste (Tag/Monat/keine) unter `ff-tx-group`; „Meine Sicht“
bzw. „Haushalt“ unter `ff-scope` (pro Gerät, siehe „Meine Sicht“).

## UI-State in der URL

Filter, die man teilen oder verlinken will, stehen als Query-Parameter im
Hash-Router (`useSearchParams`), nicht in `useState`:

- **Transaktionen**: Zeitraum als `monat` (`YYYY-MM`), `jahr`, `von`/`bis`
  oder `zeit=alle` — ohne Angabe gilt der **laufende Monat**
  (`contracts/period.ts`); dazu `typ`, `konto`, `kategorie` (eine
  Oberkategorie schließt ihre Unterkategorien ein, `-1` = ohne), `person`,
  `tag`, `projekt` (`0` = ohne Projekt), `q` (Suche, verzögert
  geschrieben), `sortierung` (`datum|betrag|kategorie|konto|person`) mit
  `richtung` (`auf|ab`, nur wenn abweichend von der ersten Richtung der
  Spalte) und `fokus` (Buchungs-ID: markieren, hinscrollen, Detail-Blatt
  öffnen). Andere Seiten verlinken damit direkt auf eine gefilterte Liste
  (Dashboard-Kennzahlen, Kategorien-Legende, Cashflow, letzte Buchungen,
  Budget-Verlauf, Monatsmatrix, Jahresvergleich, Befehlspalette,
  Projekt-Karte).
- **Dashboard**: `monat` (fehlt = aktueller Monat).
- **Auswertung**: `ansicht` (`kategorien|aufschluesselung|jahr`, fehlt =
  Verlauf); in der Aufschlüsselung zusätzlich der Zeitraum wie bei den
  Transaktionen, `nach` (`person|konto|tag|projekt|notiz`, fehlt = Kategorie),
  `art=einnahmen`, `vergleich=vorjahr`. Ein Reiterwechsel verwirft sie.
- **Konten**: `verlauf=<id>` öffnet den Saldo-Verlauf eines Kontos.
- **Einstellungen**: `tab` (`haushalt|benachrichtigungen|daten`, fehlt =
  Profil & Sicherheit).
- **Wiederkehrend**: `neu=1` öffnet den Anlegen-Dialog, vorbefüllt aus
  `typ`, `von`, `nach`, `kategorie`, `betrag` (Cent), `notiz`, `person`,
  `start` (nächste Fälligkeit) und `quelle` (Ursprungsbuchung fürs
  Aktivitäten-Log); die Parameter werden danach entfernt. So schlägt z. B. die Sparziel-Karte eine
  Sparrate vor.

## Beträge und Achsen

- Kennzahlen tragen `tabular-nums`; zusammen mit `font-mono` setzt
  `index.css` dort `overflow-wrap: normal` — Beträge brechen nie mitten im
  Wert um, obwohl `body` sonst `overflow-wrap: anywhere` hat.
- Geld-Achsen in recharts: `tickFormatter={axisMoney}` und
  `width={AXIS_MONEY_WIDTH}` aus `lib/chartTheme.ts` („14k“, „1,2 Mio.“) —
  nicht „14000 EUR“, das in der Achse umbricht.
- Reine Planungsrechnungen (Monatsverschiebung, nötige Sparrate,
  Budget-Tempo, Prozentveränderung) liegen in `contracts/planning.ts` und
  sind in `api/planning.test.ts` getestet; Startkategorien in
  `contracts/defaultCategories.ts` (Endpunkt `finance.addDefaultCategories`,
  Auswahl `components/DefaultCategoriesPicker.tsx` im Wizard, in den
  Einstellungen und in `components/GettingStarted.tsx`).

## Seiten-Besonderheiten

- **Schnellerfassung**: `components/QuickAddDialog.tsx` (Button „Schnell" im
  Layout-Header, Taste `s`) bucht mit nur Betrag + Notiz. Die Art wählt ein
  Schalter „Ausgabe | Einnahme“ (plus „Abhebung“ = Umbuchung aufs
  Bargeldkonto, sobald eins existiert); ein „-“ vor dem Betrag gilt weiter
  als Einnahme. Chips der häufigsten Kategorien (`categoryUsage.frequent`),
  Toast mit „Rückgängig“ (zehn Sekunden, löscht die Buchung über
  `utils.client`, weil der Dialog dann schon zu ist). Vorwahl von außen:
  `useActions().show('quick', { quickMode: 'withdrawal', cashAccountId })`
  (Kontenseite: „Abhebung nachtragen“). Das Buchungskonto ist pro Benutzer konfigurierbar
  (`users.quickAccountId` via `auth.setQuickAccount`, erfordert `edit`-
  Recht; null/Default = erstes Konto mit `access === "edit"`) und wird im
  Dialog per SearchableSelect angezeigt/gewählt (Wahl wird direkt
  gespeichert). Weitere Defaults: zuletzt verwendete Kategorie der
  jeweiligen Art, heutiges Datum, aktueller User.
- **Transaktionen**: ruhige Zeilen — am Desktop in der Zeile nur Stift
  (bei Hover/Fokus, nur bei `edit`, Remount-Key aus changeCount/tags) und
  Beleg-Knopf (mit Zähler immer sichtbar); mobil entfällt die
  Aktionen-Spalte ganz, damit der Betrag Platz hat. Ein Klick in die Zeile
  oder auf die Beschreibung (ein echter `<button>`, die Zeile bleibt eine
  Tabellenzeile) öffnet `components/TransactionDetailSheet.tsx` (mobil von
  unten, sonst von rechts): alle Felder, Tags zum An-/Abwählen (nur mit
  `edit`), Bearbeiten, Belege, Verlauf, „Wiederkehrend“ (öffnet den
  vorbefüllten Dauerbuchungs-Dialog, erste Fälligkeit nach heute),
  Stornieren und Löschen — die beiden letzten über AlertDialoge, die den
  Saldo-Effekt erklären. Nach dem Schließen kehrt der Fokus auf die Zeile
  zurück. Liegt eine `fokus`-Buchung nicht in den geladenen Seiten, holt
  das Blatt sie einzeln (`searchTransactions({ id })`). Die Aktionen-Zelle
  stoppt Klicks, weil Klicks aus Dialog-Portalen im React-Baum bis zur
  Zeile blubbern. **Massenbearbeitung** (Desktop): Checkbox je Zeile mit
  `edit`-Recht und „alle geladenen“ im Kopf; die Auswahl gilt nur für die
  aktuelle Suche (abgeleitet über einen Schlüssel aus den Suchparametern).
  `components/BulkActionBar.tsx` setzt Kategorie, Projekt, Person, Tags
  oder löscht (`finance.bulkUpdateTransactions`/`bulkDeleteTransactions`).
  Spaltenköpfe sortieren (`SortHead`, `aria-sort`); gruppiert wird nur bei
  Sortierung nach Datum. Tag-Auswahl + Inline-Anlage im Details-Bereich des
  TransactionDialog, Tag-Namen sind Teil der Suche. Edit-Modus im
  TransactionDialog (Prop `transaction`, Art-Wahl deaktiviert mit
  title-Hinweis, Änderungskommentar-Feld, Hinweis bei Dauerbuchungs-
  Instanzen, Belege nur im Create-Modus). Enter im Betragsfeld springt zur
  Beschreibung. **Duplizieren** (B6) im Detail-Blatt: `TransactionDialog`
  mit `template` statt `transaction` — vorbefüllt, Datum heute, ohne Belege;
  jedes Öffnen beginnt wieder bei der Vorlage. **Laufender Saldo** (C7): Ist
  genau ein Konto gefiltert und nach Datum sortiert, zeigt die Liste
  (Desktop) die Spalte „Saldo“ aus `balanceAfter`; weitere Filter lassen
  sie stehen, aber ausgegraut (der Saldo zählt alle Buchungen des Kontos).
- **Kennzahl-Karten**: `components/KpiCard.tsx` (Dashboard, Hypotheken,
  Versicherungen) — mobil im 2×2-Raster (`grid-cols-2`) mit kleinerer
  Schrift und ohne Symbol. `info` steht neben dem Titel (ein `InfoTip`).
- **Fachbegriffe** (A8): `components/InfoTip.tsx` — Info-Symbol mit Popover
  (kein Tooltip: den gibt es auf dem Handy nicht), Texte zentral in
  `lib/glossary.ts` (Begriff, Satz, Formel, Beispiel; Beispielbeträge ohne
  Währung und mit Leerzeichen als Tausendertrenner, weil sie nicht der
  Browser-Region folgen). Gesetzt bei Sparrate (Dashboard), Sparquote
  (Verlauf), Rollover (Budget-Dialog), Fixkosten, Belehnung, Tragbarkeit,
  Pflicht-Amortisation, Ersatzrate, Rentenskala, offenes Ziel,
  Hauptverfall und Kündigungsfrist. Ein neuer Begriff gehört in das
  Glossar, nicht als Text an die Stelle.
- **Leere Zustände** (A3): Zweck in einem Satz, Voraussetzung, ein
  Primär-Knopf (Konten, Budgets, Dauerbuchungen, Sparziele, Geldfluss,
  Aufteilung — dort ein Zettel, solange nur eine aktive Person im Haushalt
  ist). Diagramme mit weniger als zwei Datenpunkten weichen dem Hinweis
  (Verlauf der Auswertung: erst ab dem zweiten Monat mit Buchungen); die
  Prognose nennt, aus wie vielen abgeschlossenen Monaten ihr Ø stammt
  (`variableMonths`).
- **Dashboard-Anordnung** (D7): Die Seite baut eine Tabelle
  `cards: Record<DashboardCardId, { span, node } | null>` und rendert sie in
  der Reihenfolge von `user.dashboardLayout` (`contracts/dashboard.ts`) —
  in einem dichten Raster (`grid-flow-row-dense lg:grid-cols-5`, Breiten
  `full`/`wide`/`narrow`), damit ausgeblendete Karten keine Löcher lassen.
  `null` = Karte hat gerade nichts zu zeigen (z. B. nur im laufenden Monat).
  `components/DashboardCustomizeDialog.tsx` („Anpassen“): Checkbox je Karte,
  Pfeil-Knöpfe statt Ziehen (Tastatur und Handy), „Standard
  wiederherstellen“; gespeichert am Server (`auth.setDashboardLayout`).
  Neue Karte: Eintrag in `DASHBOARD_CARDS` plus Zeile in `cards`.
- **Meine Sicht** (H6): `providers/scope.tsx` hält `mine | household`
  (localStorage `ff-scope`), der Umschalter sitzt in der Kopfzeile (nur mit
  mehr als einer aktiven Person). `useScope().userId` geht an
  `dashboard.summary`, `analysis.monthlyTrend`/`categoryMatrix`/`breakdown`
  (Aufschlüsselung „nach Person“ ausgenommen) und an die Transaktionsliste,
  solange dort kein Personenfilter gesetzt ist (Chip „Meine Sicht“ mit ×).
  „Meine“ heißt: ich habe bezahlt (`userId` der Buchung). Vermögen,
  Salden, Budgets und der Jahresvergleich bleiben haushaltsweit.
- **Dashboard**: „Sichtbares Vermögen“ statt „Gesamtvermögen“, sobald
  Privatkonten anderer fehlen (`finance.accountVisibility`, auch in der
  Seitenleiste); Karten „Konten“ (Link `/konten?verlauf=<id>` öffnet den
  Saldo-Verlauf) und „Sparziele“ (bis zu drei Ziele, nächster Stichtag
  zuerst, Prognose oder nötige Rate) im laufenden Monat.
- **Konten**: Karte mit „Saldo abgleichen“ bzw. „Kasse zählen“
  (`components/ReconcileForm.tsx`, auch im AccountDialog), Bargeldkonto im
  Minus zeigt einen Zettel mit „Abhebung nachtragen“.
- **Zeitraum-Wahl**: `components/PeriodPicker.tsx` (Transaktionen und
  Auswertung → Aufschlüsselung), Anzeigetext `periodLabel` in
  `lib/period.ts`.
- **Gemeinsame Formularteile**: `components/TypeSegment.tsx` (Buchungsart im
  Buchungs- und Dauerbuchungs-Dialog), `components/DateField.tsx` (natives
  Datumsfeld plus „Heute“/„Gestern“).
- **Einrichtungs-Checklisten**: `components/SetupChecklist.tsx` in Vorsorge
  (Lohn, AHV + Beitragsjahre, Pensionskasse, 3a — das Kapital-Diagramm
  erscheint erst mit Kapital), Hypotheken (Verkehrswert, Einkommen,
  Tranchen, aktuelle Restschuld, Zins als Dauerbuchung) und Versicherungen
  (Deckungen, Belastungskonto, Prämie als Dauerbuchung); jede offene Angabe
  mit ihrem Dialog. Verschwindet, wenn alles erledigt ist.
- **Hinweise mit Aktion**: Hypotheken-Hinweise öffnen die betroffene
  Tranche bzw. Liegenschaft; der Deckungs-Check gruppiert in „Jetzt
  handeln“, „Prüfen“, „Datenqualität“ (`gapGroup`, `gapBundleText` in
  `lib/insuranceText.ts`), bündelt gleichartige Hinweise aufklappbar und
  bietet „Police erfassen“ (Sparte vorgewählt) bzw. „Bearbeiten“.
- **Budgets**: „Verlauf & Details“ klappt `components/BudgetDetail.tsx` auf
  (letzte sechs Perioden als Mini-Balken mit Limit-Strich, eingehalten/
  Durchschnitt, Aufschlüsselung auf Unterkategorien, Links in die
  Buchungen; Query erst beim Aufklappen). Karte „Ohne Budget“
  (`analysis.budgetCoverage`) mit Direkt-Anlage; der Budget-Dialog schlägt
  Ø 3 / Ø 6 Monate / höchsten Monat vor (`analysis.categoryStats`). Das
  Budget-Grid hat `items-start`, damit ein aufgeklappter Verlauf die
  Nachbarkarten nicht streckt.
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
  statt Prozent/Prognose. Zielfarbe (G5): eine Quelle → Balken in der
  Zielfarbe; mehrere → Segmentfarben mit einem Ring in der Zielfarbe.
  Erreichte Ziele (G6) tragen einen Zettel „Geschafft!“ mit „Abschließen“
  (AlertDialog erklärt, dass die Quellen gelöst werden;
  `finance.setGoalArchived`); abgeschlossene Ziele stehen aufklappbar unter
  „Archiv“ mit „Zurückholen“ und fehlen auf Dashboard und in der Prognose.
- **Splitting** (`pages/Splitting.tsx`): bei gewähltem Projekt oben
  `components/ProjectSummaryCard.tsx` (Gesamtkosten, Zeitraum, je Person
  bezahlt/getragen, Kategorien). Filtert Salden,
  Ausgleichsvorschläge und die Liste geteilter Ausgaben pro Projekt (Chips:
  Alle / Haushalt / je Projekt); verbuchte Ausgleiche übernehmen das gewählte
  Projekt. Sektion „Projekte & Vorlagen": Projekt-Anlage mit Farbpalette,
  Löschen von Projekten und Aufteilungsvorlagen. Vorlagen-Select im
  Split-Bereich des TransactionDialog (gespeicherte Vorlagen + Schnellwahl
  60/40, 70/30), „Als Vorlage speichern" aus den aktuellen Anteilen.
  **Verbuchte Ausgleiche** (H3) als eigene Karte (`isSettlementShape` aus
  `contracts/settlement.ts`, ohne stornierte), „letzter Ausgleich am …“ in
  den Salden; in „Geteilte Ausgaben“ erscheinen sie nicht noch einmal.
  **Projekte abschließen** (H2): Knopf in der `ProjectSummaryCard`
  (`finance.setProjectClosed`); abgeschlossene Projekte stehen in den Chips
  hinten mit Häkchen, fehlen in Buchungsdialog und Massenbearbeitung (außer
  die Buchung gehört schon dazu) und tragen im Transaktionsfilter
  „(abgeschlossen)“. Die Projektkosten zählen Ausgleiche nicht mit; je
  Person steht, was nach Ausgleichen noch offen ist.
- **Auswertung** (`pages/YearReview.tsx` unter `/auswertung`): Tabs
  Verlauf (`components/TrendCharts.tsx`: Einnahmen/Ausgaben als Balken,
  darunter die Sparquote als eigene Linie — bewusst keine zweite y-Achse),
  Kategorien × Monate (`components/CategoryMatrix.tsx`: Zellen mit
  zeilenweise normierter Tönung in `--pencil-1`, sticky erste Spalte,
  aufklappbare Unterkategorien, startet mobil bei den jüngsten Monaten)
  Aufschlüsselung (`components/BreakdownView.tsx`: Dimension, Art, freier
  Zeitraum, Vergleich „Zeitraum davor“ oder „Vorjahr“; Zeitraum und Filter
  in der URL; Dimension „Empfänger / Notiz“ (F7) mit Umschalter „nach
  Betrag / nach Anzahl“, Zeilen verlinken per `q=` auf die Buchungen) und Jahresvergleich (Zeilen und Säulen verlinken auf die
  Buchungen). Unter dem Verlauf die Fixkosten-Karte
  (`components/FixedCostsCard.tsx`). Jeder Wert führt per Klick zur
  gefilterten Transaktionsliste.
- **Dauerbuchungen**: `components/UpcomingCard.tsx` zeigt die Termine der
  nächsten 7/30/90 Tage (`analysis.upcoming`) samt Warnung, wenn ein Konto
  dabei ins Minus fiele. Darunter (I4) „Noch nicht als Dauerbuchung“:
  aktive Policen mit Prämie ohne verknüpfte Dauerbuchung und die Zahl
  fehlender Hypotheken-Posten. Gibt es schon eine passende Dauerbuchung
  (`premiumMatches`: gleicher Betrag und Intervall, noch frei), heißt der
  Knopf „Verknüpfen“ statt „Übernehmen“; `InsuranceTransferDialog` bietet
  die Kandidaten dann oben an (`insurance.linkPremiumToRecurring`), damit
  keine Belastung doppelt entsteht. Karten zeigen die Kategorie (G3).
- **Verlauf** (`pages/Activity.tsx` unter `/verlauf`, Nav „Verwaltung“):
  das Aktivitäten-Log mit Filter Person, Zeitraum (`since` in Epoch-ms,
  lokal gerechnet) und Bereich, nach Tagen gruppiert. Beschriftungen in
  `lib/auditLabels.ts`. Das Dashboard zeigt die fünf neuesten Einträge
  anderer Personen („Zuletzt im Haushalt“, `othersOnly`), nur in Haushalten
  mit mehr als einer Person.
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
- **Einstellungen** (`pages/Settings.tsx`): vier Tabs (`?tab=`) — Profil &
  Sicherheit (Profil, Passwort, Zwei-Faktor-Authentifizierung mit QR-Code
  via `qrcode`-Paket als Data-URL), Haushalt (Währung, Kategorien-Baum mit
  Stift-Button pro Kategorie — `CategoryEditDialog`: Name, Farbpalette,
  Oberkategorie-Select deaktiviert bei eigenen Unterkategorien —, Tags,
  Kontotypen & Banken), Benachrichtigungen (Admin) und Daten & Offline
  (Datensicherung, Datenverwaltung, OfflineCard). Das Aktivitäten-Log ist
  eine eigene Seite (`/verlauf`).
- **Login**: zweistufig bei aktiviertem TOTP (InputOTP).
- **Personen** (`pages/Users.tsx`): der Einladungslink erscheint in
  `components/InviteLinkShare.tsx` (H7) — Kopieren, „Teilen“ über
  `navigator.share` (nur wo es das gibt) und ein lokal erzeugter QR-Code.
  Die Kopfzeile nennt nur aktive Personen; deaktivierte bleiben in Listen
  und Filtern für ihre alten Buchungen.
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
  (`MortgageWarning`) und werden erst in `warningText()` (`lib/mortgageText.ts`,
  auch vom Dashboard genutzt) zu deutschen Sätzen
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
    Discriminated Union) und werden erst in `gapText()` (`lib/insuranceText.ts`)
    zu deutschen Sätzen
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
dar (rein frontendseitig aus `listAccounts`/`listRecurring`). Zwei
Ansichten, Umschalter oben rechts (`ff-moneyflow-view` in localStorage):
**Diagramm** (`components/MoneyFlowChart.tsx`) und **Liste**
(`components/MoneyFlowList.tsx`, ein Eintrag pro verbundenem Konto mit
Monatssummen der Zu-/Abflüsse, aufklappbar zu den einzelnen Strömen).
Farben/Icons beider Ansichten liegen in `lib/moneyflowStyle.ts`.

Die reinen Funktionen in `lib/moneyflow.ts` arbeiten zweistufig:

- `buildMoneyFlow(accounts, recurring)` baut den Graphen: Kanten aus
  Dauerbuchungen (Beträge auf Monat normalisiert: wöchentlich × 52/12,
  jährlich ÷ 12, gerundet; pausierte als `paused`, Notiz als `note`),
  Konten ohne jede Kante als `unconnected` (pausierte zählen als
  Verbindung; die Seite zeigt sie in der Card „Ohne Geldflüsse" mit
  `MoneyFlowAccountCard`), Summen `incomeTotal`/`expenseTotal` (nur aktive
  Flüsse) und `dense` (ab `DENSE_EDGES` = 24 Kanten). `nodeFlows` liefert
  Zu-/Abflüsse eines Knotens für Detail-Panel und Liste.
- `layoutMoneyFlow(flow, { widthPx, nodeWidthPx })` legt das Diagramm in
  **Pixeln** aus — das Chart misst seine Container-Breite per
  ResizeObserver und layoutet neu. Spaltenzahl nach Kontenzahl
  (`columnCount`: 1 bis 6, 2 ab 7, 3 ab 15, 4 ab 28), aber nur so viele, wie in die
  Breite passen (`fitColumns`); wechselt das Layout dadurch auf kompakte
  Karten (`NODE_W_COMPACT_PX`), wenn das eine Spalte mehr bringt. Passt
  nicht einmal eine Spalte, wird die Fläche breiter als der Container und
  scrollt horizontal (`overflow-x-auto`).
  - **Spaltenzuweisung** (`assignColumns`) als Schichtung entlang der
    Umbuchungen: längster Umbuchungspfad von einer Quelle = früheste
    Spalte, längster Pfad zu einer Senke = späteste; im Spielraum werden
    die Spalten ausgeglichen gefüllt (fest gebundene Konten zuerst,
    zugewiesene Vorgänger heben die früheste Spalte an). Reihenfolge in
    der Spalte: Hauptfluss (Einnahmen-Empfänger oben, Ausgaben-Zahler
    unten), dann Barycenter-Sweeps über die relativen Höhen der
    Umbuchungs-Partner. Bei einer Spalte greift `orderAccounts`
    (Hauptfluss + ein Barycenter-Pass).
  - **Ports**: Kanten docken auf dem Kartenrand an (Seite zum Partner),
    pro Kartenseite nach Partner-Höhe sortiert und mit Mindestabstand
    verteilt (`spreadPositions`); die Pseudo-Knoten Einnahmen/Ausgaben
    sind Balken, die von der obersten bis zur untersten Partner-Karte
    reichen, ihre Ports liegen auf Höhe des Partners (Kanten annähernd
    waagrecht). Auf schmalen Flächen (Handy) werden die Balken schlank
    (`BAR_W_SLIM_PX`, nur Icon; das Chart zeigt die Summen dann in einer
    Zeile darüber) und das Chart ragt per `-mx-4` etwas in den Kartenrand.
  - **Kantenführung** (`edgeGeometry`): kubische S-Kurven zwischen
    Spalten (Kontrollpunkte auf halbem Weg). Innerhalb der einzigen Spalte
    laufen Umbuchungen orthogonal über senkrechte **Schienen**
    (`assignLanes`, Feld `via`: eine Schiene pro Quellkonto auf der Seite
    mit weniger geraden Kanten, Linienstärke gedeckelt); Bögen (`curve`)
    bleiben nur für seltene Reste in Mehrspalten-Layouts. Linienstärke
    linear zum Monatsbetrag (`WIDTH_MIN`–`WIDTH_MAX`), pausierte Kanten
    gestrichelt (Strichlänge mit der Stärke skaliert).
  - **Labels** (Betrag/Monat): Position auf der Kurve `labelT` (parallele
    Kanten gleicher Quelle Richtung Ziel, gleichen Ziels Richtung Quelle
    gestaffelt; ab 5 Geschwistern `labelCompact`), danach
    `assignLabelPositions` als Repulsion-Pass über achsenparallele
    Rechtecke (Karten zählen vierfach, Verschiebung senkrecht zur Tangente
    und horizontal, wachsender Offset, Fallback = geringste Überlappung).
    Im dichten Modus zählen nur Labels mit gemeinsamem Endknoten als
    Kollision, weil nie mehr gleichzeitig sichtbar ist.

Interaktion im Chart: Hover hebt die Ströme eines Knotens hervor; ein
Tipp/Klick (auch Enter/Leertaste, Karten sind `role="button"`) fixiert das
als **Fokus** — Touch kennt kein Hover. Fokus-Zustand hält die Seite
(`focusNode`), er ist derselbe wie der aufgeklappte Eintrag der Liste; Klick
auf die freie Fläche, Escape oder das X im Detail-Panel heben ihn auf. Bei
Fokus erscheint unter dem Diagramm `MoneyFlowNodeDetails` mit allen Zu- und
Abflüssen des Knotens. Bei dichten Graphen (`flow.dense`) werden die
Betrags-Badges nur für den hervorgehobenen Knoten eingeblendet; der Schalter
„Alle Beträge anzeigen" im Card-Header hebt das auf.
## Papier-Design (Tokens, Schriften)

Die Oberfläche folgt dem Papier-Entwurf in `docs/design/paper-like/`
(README mit Leitidee, Tokens und den ausstehenden Phasen). Was davon im
Code steht:

- **Tokens** in `index.css` (`:root`/`.dark`, shadcn-HSL-Format): Unterlage
  (`--background`) und Blatt (`--card`), drei Tintenstufen, Hairline
  (`--border`) und kräftige Linie (`--input`, `--rule-strong`), dazu
  `--positive`/`--negative`/`--warning` (Bedeutungsfarben), `--stamp`
  (Marke, Fokus), `--note` (Notizzettel) und `--pencil-1…8` (Buntstifte für
  Kategorien). In `tailwind.config.js` als `text-positive`, `bg-stamp`,
  `bg-pencil-3` usw. registriert – neue Farben dort ergänzen, nicht als
  Tailwind-Palette (`emerald-600`) hartkodieren. Regel: `positive`/`negative`
  für Beträge und Zustände, `warning` für Fristen und Budgets ab 80 %,
  `stamp` für Marke, Fokus, Link-Aktionen und die aktive Navigation
  (Register-Reiter in `Layout.tsx`), `muted-foreground` für dekorative
  Icons; primäre Knöpfe ohne eigene Farbe (Tinte). Für recharts und SVG
  gibt es `lib/chartColors.ts` (`CHART.positive`, `CHART.pencil(n)` … als
  `hsl(var(--…))`-Strings) – keine Hex-Werte in Chart-Props.
- **Schriften** in `fonts.css` (vor `index.css` importiert): Newsreader
  (`font-serif`, Titel und Kennzahlen), IBM Plex Sans (`font-sans`,
  Bedienung), IBM Plex Mono (`font-mono`, Beträge/Daten/IBAN). Gebündelt aus
  den fontsource-Paketen, bewusst nur latin + latin-ext als woff2 – der
  Service Worker nimmt sie in den Precache. Keine Schriften von Google laden.
- `h1`, `h2` sowie `CardTitle`/`DialogTitle`/`SheetTitle`/`AlertDialogTitle`
  sind über `data-slot`-Selektoren in `index.css` serif; Utility-Klassen
  gewinnen (`font-sans text-sm` für Feldbezeichner in KPI-Karten).
- Ecken: `--radius` 0.25rem; `rounded-xl`/`lg` = 4 px (Blätter, Dialoge),
  `md` = 3 px (Knöpfe, Felder), `sm` = 2 px. Schatten: `shadow-sm` =
  aufliegendes Blatt, `shadow-md`/`lg` = abgehobenes Blatt (Popover, Dialog).
- Körnung: `body { background-image: var(--grain) }`; die Unterlage
  (`Layout.tsx`: Wurzel-`div` und Seitenleiste ohne eigenen Hintergrund)
  zeigt sie, Blätter (`bg-card`) decken sie ab.
- **Komponenten-Regeln** (Papier-Anpassungen in `ui/`): `Badge` hat zwei
  Rollen – `variant="stamp"` für Zustände (Versalien, Umriss, Farbe über
  `tone="good|warn|bad|ink|brand"`) und `variant="label"` für Zuordnungen
  (Tag, Projekt, Kategorie, Sparte, Zähler; mit Farbpunkt oder
  `borderLeft`-Farbkante). `default`/`secondary`/`outline` nicht mehr für
  neue Badges verwenden. `Button variant="stamp"` (grün gefüllt) nur für die
  eine Aktion, die etwas verbucht; `destructive` ist ein Umriss, die
  Bestätigung in der Gefahrenzone bekommt die Füllung per className.
  **Gespeicherte Farben** (Kategorien, Tags, Projekte, Personen, Sparziele)
  nie roh in `style`/`fill` setzen, sondern durch `pencil()` aus
  `lib/pencil.ts` – ein Buntstift wird zum Token (Dunkelmodus-Stufe), jede
  andere Farbe wird zur Tinte hin abgetönt. Auswahl-Paletten nur aus
  `PENCIL_COLORS` (`contracts/types.ts`); Reihen ohne gespeicherte Farbe
  über `pencilSlot(n)`. Keine Migration alter Hex-Werte nötig.
  **Diagramme (recharts)**: Konstanten aus `lib/chartTheme.ts`
  (`GRID_PROPS`, `AXIS_PROPS`, `CURSOR_LINE`/`CURSOR_BAR`, `dotFor`,
  `HATCH_OPACITY`, `hatch('positive'|'negative'|'pencil-1'|'pencil-7'|
  'muted')`, `moneyLabel`), Schraffuren per `{chartDefs()}` als erstes Kind
  des Charts (Funktionsaufruf, keine Komponente – recharts verwirft eigene
  Komponenten als Kinder), Tooltip immer `content={<PaperTooltip … />}`
  aus `components/ChartParts.tsx`, Legende ab zwei Serien, Flächen
  `fill={hatch(…)}` statt Verlauf, `ReferenceArea`-Bänder in `paper-deep`.
  Achsen-Schrift und Legenden-Farbe stehen als `.recharts-…`-Regeln in
  `index.css` außerhalb von `@layer` (Layer-Regeln mit Selektoren, die in
  keiner Quelldatei vorkommen, entfernt Tailwind).
  Tabellen: Kopf in Versalien, `TableFooter` mit Doppelstrich, Datum-Zellen
  `font-mono text-xs tabular-nums text-muted-foreground`, Betrags-Zellen
  `font-mono font-medium tabular-nums`. Kennzahlen `font-serif … font-
  semibold`. `Progress` ist ein Meter: Füllung Tinte, ab 80 % `bg-warning`,
  überzogen `bg-destructive`. Hinweise mit Handlungsbedarf als `<Note>`
  (Zettel), Formularfehler bleiben eine Rotstift-Zeile unter dem Feld.

## Dark Mode

Umschalter im Layout-Header, via next-themes (`ThemeProvider` in `main.tsx`,
`attribute="class"`, System-Default); die `.dark`-Variablen stehen in
`index.css`.

## Offline-Betrieb (PWA)

Die App läuft **lokal zuerst**: Ein Service Worker beantwortet `/api/trpc`
aus einer SQLite-Replik im Browser — mit demselben tRPC-Router, der sonst auf
dem Heimserver läuft. Für die 19 Seiten ändert sich dadurch nichts; sie
sprechen wie bisher `trpc.*` und merken vom Umschalten nichts. Die
Server-Seite steht in `api/AGENTS.md` unter „Abgleich".

- `src/sw/index.ts` — der Worker: Precache der App-Shell (HashRouter, also
  genau ein echter Pfad), Update-Fluss, Abfangen von `/api/*`, Anstoß des
  Abgleichs. Gebaut mit esbuild nach `dist/public/sw.js`
  (`scripts/build-sw.mjs`), **nicht** von Vite — Precache-Liste und
  Build-Kennung kommen per `define` herein und gehören damit untrennbar zu
  genau dieser Worker-Version.
- `src/offline/` — alles, was nur im Worker läuft: `db/connection.ts`
  (sql.js über IndexedDB, Zwilling von `api/queries/connection.ts` mit
  Compile-Time-Check auf gleiche Signatur), `shims/` (Browser-Ersatz für die
  drei Node-gebundenen Module), `localApi.ts` (lokaler Router + Anhang-Routen),
  `sync/` (Abgleich, Konflikte, Anhang-Dateien), `state.ts` (Identität,
  Geräte-Anmeldung, Abgleichstand in IndexedDB).
  **Die Replik öffnet `ensureDatabase()` (`sync/engine.ts`) — und zwar auch
  aus `localApi.ts` heraus, nicht nur im Abgleich:** Der Browser beendet einen
  untätigen Worker jederzeit, und nach dem nächsten Start ist die erste
  Anfrage `auth.me`, lange bevor die Seite einen Abgleich anstößt. Ohne
  diesen Schritt antwortet der Worker mit „Datenbank nicht initialisiert",
  und die App bleibt beim Ladebildschirm hängen.
- `src/providers/trpc.tsx` — `splitLink`: Prozeduren aus
  `ONLINE_ONLY_PROCEDURES` (`contracts/offline.ts`) gehen an
  `/api/trpc/live`, alles andere an `/api/trpc`.
- `src/providers/offline.tsx` — Identität an den Worker melden (er kann das
  HttpOnly-Cookie nicht lesen), Abgleich anstoßen (Start, Fokus, Intervall)
  und nach einem Abgleich die Queries neu laden.
- **Update-Fluss** (`src/lib/serviceWorker.ts`): Ein frisch installierter
  Worker gilt nur dann als neue Version, wenn seine Build-Kennung
  (`ff:version?` → `__FF_BUILD_ID__`) von der des laufenden Workers abweicht.
  Der Browser allein ist kein verlässlicher Zeuge: Safari/iOS vergleicht beim
  Update-Check neben den Bytes von `sw.js` auch die TLS-Zertifikatskette und
  installiert den Worker nach jedem Zertifikatswechsel neu — mit Caddys
  interner CA (Profil `tls`) alle paar Stunden. Gleicher Build: still
  übernehmen lassen, kein Hinweis, kein Neuladen. Neue Version: Toast „Neue
  Version verfügbar" mit „Jetzt laden"; nach der Übernahme lädt die Seite neu
  (`controllerchange`), damit sie zu den frisch gecachten Dateien passt.
- `src/components/SyncStatus.tsx` (Kopfzeile) und `src/pages/Sync.tsx`
  (`/abgleich`): Status, Konflikte feldweise entscheiden, Merge-Protokoll.
  Die deutschen Beschriftungen für Tabellen, Spalten und Werte stehen in
  `src/lib/syncLabels.ts` — ohne sie stünden dort Datenbanknamen.
- `src/components/OfflineCard.tsx` in den Einstellungen: erklärt einen
  unsicheren Kontext (der häufigste Grund, warum Offline nicht geht — Browser
  erlauben Service Worker nur über HTTPS oder localhost), Speicher-Budget für
  Belege, Notbremse „Offline-Daten zurücksetzen".

**Beim Entwickeln**: Der Worker wird nur im Produktions-Build registriert
(`import.meta.env.PROD`) — im Dev-Server kollidierte sein Precache mit dem
Hot-Reload. Offline prüfen heißt deshalb `npm run build && npm start` und
`http://localhost:3000` (localhost ist ein secure context).

- **Manifest**: `public/manifest.webmanifest` plus Icons in `public/icons/`
  (Quell-SVG `icon.svg`, PNGs daraus gerendert – ImageMagicks interner
  SVG-Renderer verschluckt Rahmen und Strichfarben, deshalb über WebKit:
  `qlmanage -t -s 1024 -o <dir> public/icons/icon.svg`, dann mit `magick`
  auf 512/192/180 skalieren; `favicon.svg` ist die reduzierte Stufe für
  den Browser-Tab), eingebunden in `index.html`. Entwurf und Motiv-Quellen
  liegen in `docs/design/logo/`.
