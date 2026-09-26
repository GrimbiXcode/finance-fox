/**
 * Karten des Dashboards — Katalog für die persönliche Anordnung (D7).
 * Reihenfolge = Standard. Die Anordnung eines Benutzers steht als JSON in
 * `users.dashboard_layout`; unbekannte IDs werden beim Lesen verworfen,
 * neue Karten hinten angehängt (sichtbar), damit ein Update nichts
 * versteckt.
 */
export const DASHBOARD_CARDS = [
  { id: "kpis", label: "Kennzahlen" },
  { id: "attention", label: "Was ansteht" },
  { id: "budgets", label: "Budgets" },
  { id: "cashflow", label: "Cashflow" },
  { id: "categories", label: "Ausgaben nach Kategorie" },
  { id: "accounts", label: "Konten" },
  { id: "goals", label: "Sparziele" },
  { id: "upcoming", label: "Fälligkeiten" },
  { id: "recent", label: "Letzte Buchungen" },
  { id: "balances", label: "Offene Salden" },
  { id: "activity", label: "Zuletzt im Haushalt" },
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARDS)[number]["id"];
export type DashboardLayout = { id: DashboardCardId; visible: boolean }[];

export const DASHBOARD_CARD_IDS = DASHBOARD_CARDS.map(c => c.id) as [
  DashboardCardId,
  ...DashboardCardId[],
];

/** Standard: alle Karten außer „Fälligkeiten“ (die stehen bei Wiederkehrend) */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = DASHBOARD_CARDS.map(
  c => ({ id: c.id, visible: c.id !== "upcoming" })
);

/** Gespeicherte Anordnung bereinigen: Unbekanntes raus, Neues hinten dran */
export function normalizeDashboardLayout(raw: unknown): DashboardLayout {
  if (!Array.isArray(raw)) return DEFAULT_DASHBOARD_LAYOUT;
  const known = new Set<string>(DASHBOARD_CARD_IDS);
  const seen = new Set<string>();
  const out: DashboardLayout = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, visible } = entry as { id?: unknown; visible?: unknown };
    if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: id as DashboardCardId, visible: visible !== false });
  }
  for (const card of DEFAULT_DASHBOARD_LAYOUT) {
    if (!seen.has(card.id)) out.push(card);
  }
  return out;
}
