/**
 * Vorgeschlagene Startkategorien — angeboten im Ersteinrichtungs-Wizard und
 * in den Einstellungen („Vorschläge ergänzen“). Ohne Kategorien ergeben die
 * erste Buchung, Budgets und die Auswertung keinen Sinn; deshalb gibt es
 * ein Set, das in den meisten Haushalten (CH/DE) ohne Umbau passt.
 *
 * `key` ist stabil (Auswahl im Frontend, Validierung im Backend), `name`
 * wird angelegt. Vorhandene Kategorien gleichen Namens werden nie
 * dupliziert, sondern um fehlende Unterkategorien ergänzt.
 */
export interface DefaultCategory {
  key: string;
  name: string;
  type: "income" | "expense";
  children: string[];
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: "lohn", name: "Lohn", type: "income", children: [] },
  {
    key: "nebeneinkuenfte",
    name: "Nebeneinkünfte",
    type: "income",
    children: [],
  },
  {
    key: "rueckerstattungen",
    name: "Rückerstattungen",
    type: "income",
    children: [],
  },
  {
    key: "wohnen",
    name: "Wohnen",
    type: "expense",
    children: ["Miete", "Nebenkosten", "Internet & TV", "Hausrat"],
  },
  {
    key: "lebensmittel",
    name: "Lebensmittel",
    type: "expense",
    children: ["Supermarkt", "Bäckerei", "Markt"],
  },
  {
    key: "mobilitaet",
    name: "Mobilität",
    type: "expense",
    children: ["ÖV", "Auto", "Velo"],
  },
  {
    key: "freizeit",
    name: "Freizeit",
    type: "expense",
    children: ["Restaurant", "Kino & Kultur", "Sport", "Abos & Streaming"],
  },
  {
    key: "gesundheit",
    name: "Gesundheit",
    type: "expense",
    children: ["Krankenkasse", "Arzt & Apotheke"],
  },
  {
    key: "versicherungen",
    name: "Versicherungen",
    type: "expense",
    children: [],
  },
  {
    key: "kinder",
    name: "Kinder",
    type: "expense",
    children: ["Betreuung", "Kleidung Kinder"],
  },
  { key: "kleidung", name: "Kleidung", type: "expense", children: [] },
  { key: "ferien", name: "Ferien", type: "expense", children: [] },
  { key: "geschenke", name: "Geschenke", type: "expense", children: [] },
  { key: "sonstiges", name: "Sonstiges", type: "expense", children: [] },
];

export const DEFAULT_CATEGORY_KEYS = DEFAULT_CATEGORIES.map(c => c.key) as [
  string,
  ...string[],
];
