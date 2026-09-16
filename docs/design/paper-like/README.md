# Design-Vorschlag: Finance Fox auf Papier

Ein Vorschlag, wie Finance Fox in einem **Papier-Design** aussehen und
funktionieren könnte – als Haushaltsbuch, nicht als Dashboard-Software.
Das Layout, die Navigation und alle Funktionen bleiben, wie sie sind; es
ändern sich Fläche, Farbe, Schrift und die Sprache der Details.

| Datei | Inhalt |
|---|---|
| `mockup.html` | Klickbare Vorschau mit Beispieldaten: Dashboard, Transaktionen, Bausteine; hell/dunkel; Desktop/Handy. Ohne Build-Schritt im Browser öffnen. |
| `tokens.css` | Die Farb-Tokens im shadcn-Format (HSL) als Drop-in für `src/index.css`, hell und dunkel. |
| `README.md` | Dieses Dokument: Leitidee, Tokens, Komponenten, Umsetzung in Phasen, offene Fragen. |

Die Vorschau lädt Newsreader und IBM Plex von Google Fonts. Ohne Internet
zeigt sie Systemschriften; in der App selbst würden die Schriften gebündelt
(siehe „Schrift“).

## Leitidee: das Haushaltsbuch

Finance Fox verwaltet den Haushalt einer Familie, selbst gehostet, ohne
Cloud. Das Papier-Design nimmt das wörtlich: Die Seite ist eine Unterlage,
jede Karte ein Blatt, Beträge stehen als Kolonne in Mono-Ziffern, Summen
bekommen den Doppelstrich des Kassenbuchs, Zustände sind Stempel, Tags sind
Etiketten, Erinnerungen kleben als Notizzettel. Das ist kein Skeuomorphismus
mit Ledertextur, sondern ein Vokabular, das jeder aus dem Papier-Haushalt
kennt und das in einer Finanz-App etwas bedeutet.

Fünf Regeln halten den Entwurf zusammen:

1. **Zwei Papierstufen.** Die Unterlage (Seite, Seitenleiste, Kopfzeile)
   ist etwas dunkler als das Blatt (Karte, Dialog, Popover). Blätter liegen
   sichtbar auf: warm getönter Schatten, Hairline-Rand, 4 px Ecken. Nie ein
   Blatt auf einem Blatt – innerhalb einer Karte trennen Linien, keine
   weiteren Kästen.
2. **Farbe nur mit Bedeutung.** Die Bedienung ist Tinte auf Papier: Knöpfe,
   Navigation, Fokus – alles in Tintenschwarz. Farbe trägt Bedeutung: Grün
   für Einnahmen und Positives, Rotstift für Ausgaben und Fehler, Ocker für
   Warnungen, eine Buntstift-Palette für Kategorien, Tags und Projekte. Die
   Marke bleibt grün – als Stempel (Logo, Fokus-Ring, der eine
   „Verbuchen“-Knopf), nicht als Anstrich der ganzen Oberfläche.
3. **Typografie trägt die Hierarchie.** Eine Serife (Newsreader) für
   Seitentitel, Kartentitel und Kennzahlen; eine ruhige Sans (IBM Plex
   Sans) für alles Bedienbare; eine Mono (IBM Plex Mono) für Beträge, Daten,
   IBANs und Achsen – tabellarische Ziffern, rechtsbündig, wie im
   Kassenbuch.
4. **Linien statt Kästen.** Hairlines trennen Zeilen, der Tabellenkopf hat
   eine kräftigere Linie, Summen schließen mit einem Doppelstrich ab.
   Rahmen gibt es nur um Blätter und Eingabefelder.
5. **Papier-Vokabular sparsam.** Stempel für Zustände (geteilt,
   bearbeitet, Pausiert, Archiviert), Etiketten für Zuordnungen (Tags,
   Projekte), gelbe Notizzettel für Erinnerungen mit Datum (Zinsbindung,
   Kündigungsfrist), die Büroklammer für Belege. Jedes Element hat genau
   eine Rolle; nichts davon ist Dekoration.

## Papier & Tinte (Tokens)

### Hell

| Rolle | Hex | shadcn-Variable |
|---|---|---|
| Unterlage (Seite, Seitenleiste) | `#ECE7DB` | `--background`, `--sidebar-background` |
| Blatt (Karte, Dialog, Popover) | `#FBF9F3` | `--card`, `--popover`, `--primary-foreground` |
| Blatt, vertieft (Hover, Chips, Tabellenkopf) | `#F4F0E6` | `--muted`, `--secondary`, `--accent` |
| Papier, tief (Meter-Spur, Skeleton) | `#E6E0D2` | `--paper-deep` (neu) |
| Tinte | `#211D18` | `--foreground`, `--primary` |
| Tinte, sekundär | `#4F483E` | `--sidebar-foreground` |
| Tinte, gedämpft | `#6F6759` | `--muted-foreground` |
| Linie (Hairline) | `#D9D1C2` | `--border` |
| Linie, kräftig (Felder, Tabellenkopf, Doppelstrich) | `#B9AF9C` | `--input`, `--rule-strong` (neu) |
| Einnahme, positiv | `#2A6B48` | `--positive` (neu) |
| Ausgabe, Rotstift | `#B3382E` | `--negative` (neu), `--destructive` |
| Warnung | `#8C5F10` | `--warning` (neu) |
| Stempel (Marke, Fokus-Ring) | `#2F6B4F` | `--stamp` (neu), `--ring` |
| Notizzettel | `#F7E9AE` auf `#4A3D10` | `--note`, `--note-foreground` (neu) |

### Dunkel („Nachtpapier“)

Kein invertiertes Hell, sondern dunkles Papier unter der Schreibtischlampe:
warmes Anthrazit statt Schwarz, Creme statt Weiß, dieselben Rollen.

| Rolle | Hex |
|---|---|
| Unterlage | `#1E1B17` |
| Blatt | `#292520` |
| Blatt, vertieft | `#322D27` |
| Papier, tief | `#3A342D` |
| Tinte / sekundär / gedämpft | `#EDE6D8` / `#C9C0AE` / `#A2998A` |
| Linie / kräftig | `#3E382F` / `#5A5245` |
| Einnahme / Ausgabe / Warnung | `#7FBF95` / `#E48B80` / `#D9A24A` |
| Stempel | `#7FBF95` |
| Destruktiver Knopf (Füllung) | `#9E3B32` (Text `--negative` bleibt heller) |
| Notizzettel | `#4A4024` auf `#F1E4B0` |

### Kontraste (WCAG, gemessen)

Alle Textfarben erreichen auf allen Papierstufen mindestens AA für Fließtext
(4,5:1); die Warnfarbe auf der Unterlage liegt knapp darunter und wird nur
auf Blättern als Text verwendet.

| Text auf Blatt (hell) | Kontrast | Text auf Blatt (dunkel) | Kontrast |
|---|---|---|---|
| Tinte | 15,9 : 1 | Tinte | 12,3 : 1 |
| Tinte, gedämpft | 5,3 : 1 | Tinte, gedämpft | 5,4 : 1 |
| Einnahme | 6,1 : 1 | Einnahme | 7,1 : 1 |
| Ausgabe | 5,7 : 1 | Ausgabe | 6,0 : 1 |
| Warnung | 4,5 : 1 | Warnung | 6,7 : 1 |
| Stempel | 6,0 : 1 | Stempel | 7,1 : 1 |

### Buntstifte (Kategorien, Tags, Projekte, Diagramme)

Die heutige Tailwind-Palette (`TAG_COLORS` in `contracts/types.ts`, dieselbe
Palette in den Einstellungen für Kategorien und Projekte, `PIE_COLORS` im
Dashboard) ist Neon auf Weiß. Auf Papier braucht es Buntstifte: gesättigt
genug, um nicht grau zu wirken, aber gedeckt. Die Reihenfolge ist fest und
mit dem Farbsehschwäche-Prüfer des dataviz-Skills validiert (schlechtestes
Nachbarpaar ΔE 9,6 unter Protanopie hell, 9,6 dunkel; Normalsicht ≥ 17).

| Slot | Hell | Dunkel | Ton |
|---|---|---|---|
| 1 | `#2F6FC4` | `#3F7CD0` | Blau |
| 2 | `#D9692C` | `#CF6A30` | Orange |
| 3 | `#1E9B73` | `#279C78` | Grün |
| 4 | `#D99A12` | `#B8861C` | Ocker |
| 5 | `#D5688F` | `#CC6E95` | Rosa |
| 6 | `#2E8B2E` | `#3F9A3A` | Laubgrün |
| 7 | `#6A4FB8` | `#8069CC` | Violett |
| 8 | `#C9403C` | `#CF4F4A` | Rot |

Ocker (Slot 4) liegt hell unter 3:1 gegenüber dem Blatt – deshalb stehen
Kategorien immer mit Namen daneben (Legende, Liste), nie nur als Farbfläche.

### Schatten, Ecken, Körnung

- **Blatt**: `0 1px 0 rgb(33 29 24 / .04), 0 1px 3px rgb(33 29 24 / .08),
  0 10px 24px -14px rgb(33 29 24 / .22)` – warm getönt, wie ein aufliegendes
  Blatt. Dialoge und Popover bekommen die kräftigere Stufe `--shadow-lift`.
- **Ecken**: `--radius: 0.25rem` (heute 0.625rem). Geschnittenes Papier, keine
  Kieselsteine. Rund bleiben nur Avatare, Schalter und Farbpunkte.
- **Körnung**: ein SVG-Rauschen (`feTurbulence`) als festes `body::before`
  mit 5,5 % Deckkraft (dunkel 7 %), `mix-blend-mode: multiply` bzw. `screen`.
  Sie liegt über der ganzen Seite, ist auf Blättern kaum sichtbar und stört
  Text nicht. Abschaltbar über eine Einstellung; bei `prefers-reduced-
  transparency` aus.

## Schrift

| Rolle | Schrift | Fallback |
|---|---|---|
| Titel, Kartentitel, Kennzahlen, Haushaltszeile (kursiv) | **Newsreader** 500/600, Lining-Ziffern | Iowan Old Style, Palatino, Georgia |
| Bedienung, Fließtext, Bezeichner | **IBM Plex Sans** 400/500/600 | system-ui |
| Beträge, Daten, IBAN, Achsen, Tabellenzahlen | **IBM Plex Mono** 400/500, `tabular-nums` | ui-monospace, Menlo |

Größen: Seitentitel 28 px, Kartentitel 17 px, Kennzahl 26 px, Fließtext
14 px, Tabelle 13,5 px, Bezeichner 11 px Versalien mit 8 % Spationierung.
Große Kennzahlen behalten proportionale Ziffern; tabellarische Ziffern nur
dort, wo Zahlen untereinander stehen.

**Selbst gehostet, offline-tauglich.** Die App verspricht, dass nichts das
Netz verlässt, und läuft als PWA offline. Schriften kommen deshalb nicht
von Google, sondern aus dem Bundle:

```bash
npm i @fontsource-variable/newsreader @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono
```

```ts
// src/main.tsx
import '@fontsource-variable/newsreader';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
```

Vite legt die Woff2-Dateien nach `dist/public/assets`; `scripts/build-sw.mjs`
nimmt alles unter `dist/public` in den Precache, die Schriften sind also
offline da. Kosten: rund 250 KB Woff2 einmalig. Wer das nicht will, nutzt
nur die Fallback-Stapel – der Entwurf funktioniert auch mit Palatino und
Systemschrift, verliert aber an Charakter.

## Komponenten

Die shadcn-Komponenten in `src/components/ui/` bleiben die Basis; das meiste
kommt über die Tokens. Wo eine Komponente ein Papier-Verhalten braucht,
steht es hier.

| Komponente | Heute | Auf Papier |
|---|---|---|
| `Card` | weiß, `rounded-xl`, `shadow-sm` | Blatt: `--card`, 4 px, `--shadow-sheet`, Hairline-Rand. Titel in Serife 17 px. |
| `Button` default | schwarz, `rounded-md` | Tinte gefüllt, 3 px Ecken, genau **einer** pro Ansicht („Neue Buchung“). |
| `Button` outline | weiß mit Rand | Umriss in `--rule-strong` auf Blatt, leichter 1-px-Unterschatten. |
| `Button` ghost | – | wie heute, Hover = Blatt vertieft. |
| neu: `Button` variant `stamp` | – | grün gefüllt, für die eine Aktion, die etwas verbucht („Ausgleich verbuchen“, „Als Dauerbuchung übernehmen“). |
| `Button` destructive | rot gefüllt | Umriss in Rotstift, Füllung erst beim Hover; in der Gefahrenzone gefüllt. |
| `Badge` | Pille, gefüllt | Zwei Rollen statt Varianten: **Stempel** (Zustand: Versalien 9,5 px, Spationierung 10 %, 1-px-Umriss in Zustandsfarbe, 2 px Ecken) und **Etikett** (Zuordnung: Blatt vertieft, Hairline, Farbpunkt; Projekte mit 3-px-Farbkante links). Der schiefe Stempel (−4°) nur für „Archiviert“. |
| `Table` | Zeilen mit `border-b` | Kassenbuch: Kopf in Versalien 10,5 px über kräftiger Linie, Zeilen mit Hairline, Datum in Mono gedämpft, Betrag in Mono rechts, Fußzeile mit **Doppelstrich** (`border-top: 3px double`). Sticky erste Spalte weiterhin `bg-card`. |
| `Input`, `Select`, `SearchableSelect` | Rand `--input` | Umriss in `--rule-strong` auf Blatt, 3 px Ecken, 34 px Höhe; Fokus-Ring in Stempelgrün. Beträge und Daten im Feld in Mono. |
| `Dialog`, `AlertDialog` | zentriert, Overlay schwarz 50 % | Ein Blatt, das auf die Unterlage gelegt wird: `--shadow-lift`, Overlay = Unterlage mit 60 % Deckkraft (warm, nicht schwarz). Titel in Serife. |
| `Sheet` (mobil „Mehr“) | – | wie Dialog, von unten. |
| `Tabs`, Umschalter Karten/Tabelle | Pille | Register-Reiter: aktiver Reiter = Blatt mit Hairline, sonst Unterlage. |
| `Progress` (Budgets, Sparziele) | – | Meter: Spur `--paper-deep` mit Hairline, Füllung Tinte; ab 90 % Ocker, überzogen Rotstift. Herkunfts-Balken der Sparziele in Buntstiften mit 2-px-Papierfugen. |
| `Alert`, Hinweise (`MortgageWarning`, `InsuranceGap`) | Alert-Box | **Notizzettel** für Erinnerungen mit Datum (gelb, leicht gedreht, eigener Schatten). Fehler bleiben eine Zeile in Rotstift unter dem Feld. Ausgeblendete Lücken werden zu einem gestapelten Zettel „N ausgeblendet“. |
| `Tooltip`, `Popover`, `Command` | – | kleines Blatt mit `--shadow-lift`. |
| `Skeleton` | grau pulsierend | Bleistift-Schraffur in `--paper-deep`, ohne Puls. |
| `Sonner` Toast | – | Notizzettel unten rechts, weiß statt gelb. |
| Avatare | Benutzerfarbe, weißer Rand | Benutzerfarbe bleibt (kommt aus der DB), Rand in Blattfarbe plus Hairline-Ring. |
| Belege (`TransactionAttachmentsDialog`) | Paperclip-Icon | Büroklammer wird grün (Stempelfarbe), sobald Belege vorhanden sind; Vorschau als aufgelegtes Foto mit weißem Rand. |

### Navigation (`Layout.tsx`)

- **Seitenleiste** auf der Unterlage, 232 px. Gruppen-Label in Versalien.
  Der aktive Eintrag ist ein **Register-Reiter**: Blattfarbe, Hairline,
  1-px-Schatten, Icon in Stempelgrün. Kein farbiger Anstrich mehr.
- **Logo** als Stempel: der Fuchs in Stempelgrün in einem 2-px-Rahmen auf
  Blatt, statt weiß auf grünem Kachel-Quadrat. `manifest.webmanifest`,
  `index.html` (`theme-color`) und `public/icons/icon.svg` ziehen nach.
- **Kopfzeile**: die Haushaltszeile „Gemeinsamer Haushalt · Alex & Sam“ in
  Serife kursiv, wie ein Briefkopf. Rechts „Schnell“ als Umriss-Knopf,
  Abgleich-Status, Hell/Dunkel, Avatare.
- **Unten links** die Kennzahl Gesamtvermögen in Serife und der Hinweis
  „Daten bleiben auf deinem Server“ in Stempelgrün.
- **Mobil**: untere Leiste auf der Unterlage, aktiver Eintrag in
  Stempelgrün; sonst unverändert (vier Schnellzugriffe + „Mehr“).

### Diagramme (recharts)

- Linien 2 px in Einnahme-Grün und Rotstift, Marker r = 4 mit 2-px-Ring in
  Blattfarbe.
- Flächen als **Schraffur** statt Verlauf: `<pattern>` mit 1-px-Linien im
  Serienton, 45° für Einnahmen, 135° für Ausgaben, 38 % Deckkraft. Das ist
  der gedruckte Chart – und zugleich der Kanal, der bei Farbsehschwäche
  trägt.
- Raster als durchgezogene Hairline (`--border`), keine Strichelung;
  Grundlinie in `--rule-strong`. Achsen-Text in Mono, gedämpft.
- Endwert-Beschriftung am letzten Punkt in Tinte (nie in Serienfarbe).
- Legende immer bei zwei Serien; Tooltip als kleines Blatt.
- Kreis-Diagramm mit 2-px-Papierfugen zwischen den Segmenten, Summe in
  Serife in der Mitte, Legende mit Betrag und Prozent daneben.
- Prognose-Fortsetzungen (Konten, Vorsorge) bleiben gestrichelt – das ist
  die Bleistiftlinie neben der Tinte.
- `ReferenceArea`-Bänder (Zinsbindung, Phasen) in `--paper-deep` mit
  Hairline statt farbiger Füllung.

## Stand der Umsetzung

- **Phase 1 ist umgesetzt** (Tokens, Schriften, Ecken, Schatten, Körnung):
  `src/index.css` trägt die Tokens aus `tokens.css`, `src/fonts.css` bündelt
  Newsreader, IBM Plex Sans und IBM Plex Mono (nur latin + latin-ext, woff2,
  zusammen rund 400 KB), `tailwind.config.js` kennt `font-serif`/`font-mono`,
  die Farben `positive`/`negative`/`warning`/`stamp`/`note`/`pencil-*` und
  die Schatten `sheet`/`lift`. Seitentitel, `h2` und die Titel von Karten,
  Dialogen und Sheets stehen in Serife (über `data-slot`-Selektoren, ohne
  `ui/` anzufassen). Abweichung vom Entwurf: Die Körnung ist ein
  Hintergrundbild des `body` statt einer festen Ebene mit Blend-Modus – das
  kostet beim Scrollen nichts und braucht keine Einstellung.
- **Phase 2 ist umgesetzt** (Farbe nur mit Bedeutung): Keine Tailwind-
  Palettenklasse (`emerald`, `rose`, `amber`, `sky`, `indigo`, `violet`) mehr
  in `src/`. Einnahmen, Erfolg und „erreicht“ stehen in `text-positive`,
  Ausgaben in `text-negative`, Fristen und Budgets ab 80 % in `text-warning`;
  Marke, Fokus, Link-Aktionen, „hat Belege/Tags“ und die aktive Navigation
  in `stamp`. Primäre Knöpfe tragen keine eigene Farbe mehr und sind damit
  Tinte (Button-Default). Dekorative Abschnitts-Icons in Kartentiteln sind
  `text-muted-foreground`. Die aktive Navigation ist ein Register-Reiter
  (`bg-card border-border shadow-xs`, Icon in Stempelgrün). Diagramm-
  Serien mit Vorzeichen (Ist/Saldo/Eigenkapital, Restschuld, Ablauf-Bänder,
  Vorjahr) beziehen ihre Farbe aus `src/lib/chartColors.ts`
  (`CHART.positive` usw. = `hsl(var(--…))`, funktioniert in SVG-Attributen);
  Serien ohne Vorzeichen (Prognose, Säule 2/3a, Stufen) nutzen
  `CHART.pencil(n)`. Nicht Teil von Phase 2: die Farb-Paletten zur Auswahl
  (Kategorien, Tags, Projekte, Personen, `PIE_COLORS`, `SOURCE_COLORS`) –
  sie kommen in Phase 5.
- Phasen 3 bis 5 stehen aus.

## Umsetzung in Phasen

Der Entwurf ist so gebaut, dass Phase 1 allein schon den größten Teil des
Eindrucks liefert und jede weitere Phase für sich mergebar ist.

### Phase 1 – Tokens, Schrift, Ecken, Schatten (ein halber Tag)

1. `tokens.css` aus diesem Ordner in `src/index.css` übernehmen (ersetzt die
   `:root`- und `.dark`-Blöcke) und den `body::before`-Block für die
   Körnung ergänzen.
2. Schriften bündeln (siehe „Schrift“) und in `tailwind.config.js`
   registrieren:

   ```js
   theme: {
     extend: {
       fontFamily: {
         sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
         serif: ['"Newsreader Variable"', '"Iowan Old Style"', 'Palatino', 'Georgia', 'serif'],
         mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
       },
       colors: {
         positive: 'hsl(var(--positive))',
         negative: 'hsl(var(--negative))',
         warning: 'hsl(var(--warning))',
         stamp: { DEFAULT: 'hsl(var(--stamp))', foreground: 'hsl(var(--stamp-foreground))' },
         note: { DEFAULT: 'hsl(var(--note))', foreground: 'hsl(var(--note-foreground))' },
         'paper-deep': 'hsl(var(--paper-deep))',
         'rule-strong': 'hsl(var(--rule-strong))',
         pencil: { 1: 'hsl(var(--pencil-1))', /* … */ 8: 'hsl(var(--pencil-8))' },
       },
       boxShadow: { sheet: 'var(--shadow-sheet)', lift: 'var(--shadow-lift)' },
     },
   },
   ```

3. `ui/card.tsx`: `rounded-xl shadow-sm` → `rounded shadow-sheet`; `CardTitle`
   bekommt `font-serif text-[17px]`. `h1` der Seiten: `font-serif`.
4. Beträge: `formatCents`-Ausgaben in Listen und Tabellen bekommen
   `font-mono tabular-nums` – am einfachsten über eine kleine Komponente
   `<Amount cents={…} />`, die auch Vorzeichen und Farbe (positiv/negativ)
   setzt. Das ersetzt gleich die verstreuten `text-emerald-600`/`text-rose-500`.

### Phase 2 – Farbe nur mit Bedeutung (ein Tag)

`grep` zählt heute **197 hartkodierte Tailwind-Farbklassen in 45
Dateien** unter `src/` (Stand dieses Vorschlags), überwiegend `emerald`
und `rose`, dazu `amber`, `sky`, `violet`. Ersetzen nach Bedeutung:

| Heute | Neu |
|---|---|
| `text-emerald-600`, `dark:text-emerald-400` (Einnahme, Erfolg, Marke) | `text-positive` (Zahlen) bzw. `text-stamp` (Marke, aktives Icon) |
| `bg-emerald-600` (Logo, primärer Knopf) | `bg-stamp` (Logo) bzw. Button default (Tinte) |
| `bg-emerald-600/10` (aktive Navigation) | Register-Reiter: `bg-card border shadow-xs` |
| `text-rose-500`, `text-red-*` | `text-negative` |
| `text-amber-*`, `bg-amber-*` (Warnungen) | `text-warning`, `bg-warning/10` bzw. Notizzettel |
| `#10b981`, `#f43f5e` in recharts-Props | `hsl(var(--positive))`, `hsl(var(--negative))` |

Der Fokus-Ring (`--ring`) ist bereits Stempelgrün; `focus-visible` bleibt
damit sichtbar, ohne dass irgendwo `emerald` stehen muss.

### Phase 3 – Papier-Komponenten (ein bis zwei Tage)

- `Badge`: Varianten `stamp` (mit `tone: good | warn | bad | ink`) und `label`
  (mit Farbpunkt) neben den bestehenden; Aufrufer in Transaktionen,
  Dauerbuchungen, Versicherungen, Sparzielen umstellen.
- `Table`: Fußzeilen-Variante mit Doppelstrich; Datum-Spalten `font-mono`.
- `Button`: Variante `stamp`; `destructive` als Umriss.
- `Alert` → `Note` (Notizzettel) für Erinnerungen mit Datum; Aufrufer:
  Hypotheken-Hinweise, Versicherungs-Deckungs-Check, Sync-Toast.
- `Progress` → Meter mit Ocker/Rotstift-Stufen (Budgets, Sparziele).
- `Dialog`/`Sheet`: Overlay in Unterlagenfarbe, `shadow-lift`.
- `Layout.tsx`: Register-Reiter, Stempel-Logo, Briefkopf-Zeile.

### Phase 4 – Diagramme (ein Tag)

Gemeinsame `chartTheme.ts` mit Farben aus den Tokens, Schraffur-`<defs>`,
Raster-Props und einem Papier-Tooltip; Dashboard, Konten-Verlauf, Prognosen,
Vorsorge, Hypotheken, Jahresvergleich umstellen.

### Phase 5 – Buntstifte, Icons, Bericht (ein halber Tag)

- `TAG_COLORS` und die Kategorien-/Projekt-Palette in den Einstellungen auf
  die acht Buntstifte umstellen. Bestehende Kategorien behalten ihre
  gespeicherte Farbe; optional eine Migration, die die alten acht
  Tailwind-Töne 1:1 auf die neuen Slots abbildet (`f43f5e → Rot`,
  `f59e0b → Ocker`, `3b82f6 → Blau`, `a855f7 → Violett`, `ec4899 → Rosa`,
  `14b8a6 → Grün`, `94a3b8 → Tinte gedämpft`, `10b981 → Laubgrün`).
- `public/icons/icon.svg` und PNGs als Stempel (grüner Fuchs auf Blatt),
  `theme-color` in `index.html` und Manifest auf `#2F6B4F` bzw. Unterlage.
- Screenshots in `docs/screenshots/` und README erneuern.
- **Chance:** Der PDF-Bericht (`api/lib/report`) ist ohnehin ein Blatt
  Papier. Dieselbe Serife, Mono-Kolonnen und der Doppelstrich unter den
  Summen machen aus App und Bericht ein Stück.

## Was gleich bleibt

Informationsarchitektur, Navigation (`navGroups`, mobile Leiste), alle
Seiten und Dialoge, das Responsive-Verhalten (kein seitliches Scrollen der
Seite, Container scrollen), die Locale-Regeln für Zahlen und Daten, der
Offline-Betrieb. Der Entwurf verändert kein Verhalten, nur Darstellung.

## Offene Fragen und Risiken

- **Serife auf dem Handy.** Newsreader ist für Bildschirme gezeichnet und
  bleibt bei 24 px gut lesbar; auf sehr kleinen Geräten könnte man Titel
  ab 380 px Breite in Sans setzen. In der Vorschau (Gerät: Handy) prüfen.
- **Marke: Grün als Stempel statt als Anstrich.** Das ist die größte
  Geschmacksentscheidung des Entwurfs. Wer den grünen Akzent in der
  Navigation behalten will, färbt den aktiven Reiter-Rand in `--stamp` –
  der Rest des Entwurfs bleibt unberührt.
- **Körnung.** Ein festes Overlay mit `mix-blend-mode` kostet auf alten
  Geräten etwas Scroll-Leistung. Deshalb als Einstellung „Papierkörnung“
  (an/aus) und per Default aus, wenn `prefers-reduced-transparency` gesetzt
  ist.
- **Gespeicherte Kategorie-Farben.** Bestehende Haushalte haben
  Neon-Farben in der DB; ohne Migration mischen sich Neon und Buntstift.
  Empfehlung: die 1:1-Abbildung aus Phase 5 als guardierte Migration.
- **Dunkelmodus ist warm, nicht schwarz.** Wer OLED-Schwarz erwartet,
  bekommt Anthrazit. Bewusst so – Papier ist nie schwarz –, aber es sollte
  einmal auf einem echten Handy bei Nacht angesehen werden.
- **Destruktive Knöpfe im Dunkeln.** `--destructive` ist dunkel eine
  eigene, tiefere Füllung (`#9E3B32`), weil das helle Rotstift-Rot mit
  weißem Text nicht genug Kontrast hätte; `button.tsx` nutzt `text-white`
  fest – bei der Umstellung auf `text-destructive-foreground` wechseln.
