/**
 * Darstellungs-Konstanten der Geldfluss-Ansichten (Chart, Liste, Detail) —
 * getrennt vom Layout (lib/moneyflow.ts) und von den Komponenten, damit
 * Chart und Liste dieselben Farben und Icons nutzen.
 */

import { Banknote, CreditCard, PiggyBank, Wallet, type LucideIcon } from 'lucide-react';
import type { MoneyFlowEdgeKind } from '@/lib/moneyflow';

/** Farben der Kanten nach Art (Tailwind-Palette, hell- und dunkeltauglich) */
export const EDGE_COLORS: Record<MoneyFlowEdgeKind, string> = {
  income: '#059669', // emerald-600
  expense: '#f43f5e', // rose-500
  transfer: '#0284c7', // sky-600
};

export const EDGE_LABELS: Record<MoneyFlowEdgeKind, string> = {
  income: 'Einnahme',
  expense: 'Ausgabe',
  transfer: 'Umbuchung',
};

/**
 * Icons für die Builtin-Kontotypen — Lookup mit Fallback:
 * `ACCOUNT_TYPE_ICONS[type] ?? ACCOUNT_TYPE_FALLBACK_ICON`
 * (kein Funktionsaufruf, damit React die Komponente nicht als „im Render
 * erzeugt" wertet)
 */
export const ACCOUNT_TYPE_ICONS: Record<string, LucideIcon> = {
  checking: CreditCard,
  cash: Banknote,
  savings: PiggyBank,
};
export const ACCOUNT_TYPE_FALLBACK_ICON: LucideIcon = Wallet;
