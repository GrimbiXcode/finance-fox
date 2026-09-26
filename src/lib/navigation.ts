import {
  ArrowLeftRight, ChartColumn, FileDown, GitBranch, History, House, Landmark, LayoutDashboard,
  PiggyBank, RefreshCw, Repeat, Settings, Target, TrendingUp, Umbrella, UserCog, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Zusätzliche Suchbegriffe für die Befehlspalette */
  keywords?: string[];
}

/**
 * Menüstruktur — thematisch gruppiert: Alltag (buchen & teilen), Konten,
 * Planung, Analyse, Verwaltung. Speist die Desktop-Seitenleiste, das mobile
 * „Mehr“-Menü und die Befehlspalette (⌘K).
 */
export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Alltag',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: ['übersicht', 'start'] },
      { to: '/transaktionen', label: 'Transaktionen', icon: ArrowLeftRight, keywords: ['buchungen', 'ausgaben', 'einnahmen'] },
      { to: '/wiederkehrend', label: 'Wiederkehrend', icon: Repeat, keywords: ['dauerbuchungen', 'fixkosten', 'abos'] },
      { to: '/aufteilung', label: 'Aufteilung', icon: Users, keywords: ['splitten', 'schulden', 'ausgleich', 'projekte'] },
    ],
  },
  {
    label: 'Konten',
    items: [
      { to: '/konten', label: 'Konten', icon: Wallet, keywords: ['salden', 'bank', 'iban'] },
      { to: '/geldfluss', label: 'Geldfluss', icon: GitBranch, keywords: ['diagramm', 'ströme'] },
    ],
  },
  {
    label: 'Planung',
    items: [
      { to: '/budgets', label: 'Budgets', icon: Target, keywords: ['limit'] },
      { to: '/sparziele', label: 'Sparziele', icon: PiggyBank, keywords: ['ziele', 'sparen'] },
      { to: '/vorsorge', label: 'Vorsorge', icon: Landmark, keywords: ['ahv', 'pensionskasse', '3a', 'rente'] },
      { to: '/hypotheken', label: 'Hypotheken', icon: House, keywords: ['liegenschaft', 'tranche', 'zins'] },
      { to: '/versicherungen', label: 'Versicherungen', icon: Umbrella, keywords: ['policen', 'deckung'] },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/prognosen', label: 'Prognosen', icon: TrendingUp, keywords: ['szenario', 'zukunft'] },
      { to: '/auswertung', label: 'Auswertung', icon: ChartColumn, keywords: ['jahresvergleich', 'matrix', 'sparquote'] },
      { to: '/bericht', label: 'Bericht', icon: FileDown, keywords: ['pdf', 'excel', 'export'] },
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      { to: '/personen', label: 'Personen', icon: UserCog, keywords: ['benutzer', 'einladen'] },
      { to: '/verlauf', label: 'Verlauf', icon: History, keywords: ['aktivitäten', 'audit', 'wer hat'] },
      { to: '/abgleich', label: 'Abgleich', icon: RefreshCw, keywords: ['offline', 'sync', 'konflikte'] },
      { to: '/einstellungen', label: 'Einstellungen', icon: Settings, keywords: ['kategorien', 'tags', 'backup', 'währung'] },
    ],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);
