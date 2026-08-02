import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard, ArrowLeftRight, Wallet, Target, Users, Repeat, PiggyBank,
  Settings, ShieldCheck, TrendingUp, UserCog, LogOut, Sun, Moon, ChartColumn, Landmark,
  PanelLeftClose, PanelLeftOpen, GitBranch, House, Menu,
} from 'lucide-react';
import { useAuth } from '@/providers/auth';
import { useFinanceData } from '@/lib/data';
import { formatCents, setAppCurrency, totalBalance } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import QuickAddDialog from '@/components/QuickAddDialog';

// Menüstruktur (Desktop-Seitenleiste und mobiles „Mehr“-Menü): thematisch
// gruppiert — Alltag (buchen & teilen), Konten, Planung, Analyse, Verwaltung.
const navGroups = [
  {
    label: 'Alltag',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/transaktionen', label: 'Transaktionen', icon: ArrowLeftRight },
      { to: '/wiederkehrend', label: 'Wiederkehrend', icon: Repeat },
      { to: '/aufteilung', label: 'Aufteilung', icon: Users },
    ],
  },
  {
    label: 'Konten',
    items: [
      { to: '/konten', label: 'Konten', icon: Wallet },
      { to: '/geldfluss', label: 'Geldfluss', icon: GitBranch },
    ],
  },
  {
    label: 'Planung',
    items: [
      { to: '/budgets', label: 'Budgets', icon: Target },
      { to: '/sparziele', label: 'Sparziele', icon: PiggyBank },
      { to: '/vorsorge', label: 'Vorsorge', icon: Landmark },
      { to: '/hypotheken', label: 'Hypotheken', icon: House },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/prognosen', label: 'Prognosen', icon: TrendingUp },
      { to: '/auswertung', label: 'Auswertung', icon: ChartColumn },
    ],
  },
  {
    label: 'Verwaltung',
    items: [
      { to: '/personen', label: 'Personen', icon: UserCog },
      { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
    ],
  },
];

// Mobile Schnellzugriffe in der unteren Leiste — alles Weitere über „Mehr“.
const mobilePrimary = ['/', '/transaktionen', '/konten', '/budgets'];
const mobilePrimaryItems = navGroups
  .flatMap((g) => g.items)
  .filter((i) => mobilePrimary.includes(i.to));

const SIDEBAR_KEY = 'ff-sidebar-collapsed';

export default function Layout() {
  const { user, logout } = useAuth();
  const { accounts, transactions, users } = useFinanceData();
  const { resolvedTheme, setTheme } = useTheme();
  const total = totalBalance(accounts, transactions);
  // Eingeklappte Seitenleiste (nur Icons) pro Gerät merken
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true');
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, String(!c));
      return !c;
    });
  };

  // Haushaltsweite Währung laden und für formatCents/currencySymbol setzen.
  // Ändert der Admin die Währung, wird die Query invalidiert und das Layout
  // rendert mitsamt aller Seiten mit der neuen Währung neu.
  const appSettings = trpc.finance.getAppSettings.useQuery();
  useEffect(() => {
    if (appSettings.data?.currency) setAppCurrency(appSettings.data.currency);
  }, [appSettings.data?.currency]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className={cn('hidden flex-col border-r bg-card transition-all md:sticky md:top-0 md:flex md:h-screen', collapsed ? 'w-16' : 'w-64')}>
        <div className={cn('flex items-center gap-2 border-b py-5', collapsed ? 'justify-center px-2' : 'px-6')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <PiggyBank className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold leading-tight">Finance Fox</div>
              <div className="text-xs text-muted-foreground">Self-hosted &amp; privat</div>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navGroups.map((group, gi) => (
            <div key={group.label}>
              {collapsed
                ? gi > 0 && <div className="mx-2 my-2 border-t" />
                : (
                  <div className={cn('px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70', gi > 0 && 'pt-4')}>
                    {group.label}
                  </div>
                )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    collapsed && 'justify-center px-0',
                    isActive
                      ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {!collapsed && (
          <div className="border-t px-6 py-4">
            <div className="text-xs text-muted-foreground">Gesamtvermögen</div>
            <div className={cn('text-lg font-semibold', total < 0 && 'text-destructive')}>{formatCents(total)}</div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Daten bleiben auf deinem Server
            </div>
          </div>
        )}
        <div className="flex justify-center border-t py-3">
          <Button
            variant="ghost" size="icon" onClick={toggleCollapsed}
            title={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
          >
            {collapsed
              ? <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
              : <PanelLeftClose className="h-4 w-4 text-muted-foreground" />}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <PiggyBank className="h-5 w-5 shrink-0 text-emerald-600" />
            <span className="truncate font-semibold">Finance Fox</span>
          </div>
          <div className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">
            Gemeinsamer Haushalt · {users.map((u) => u.name).join(' & ')}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <QuickAddDialog />
            <Button
              variant="ghost"
              size="icon"
              title={resolvedTheme === 'dark' ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark'
                ? <Sun className="h-4 w-4 text-muted-foreground" />
                : <Moon className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <div className="flex -space-x-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  title={u.name}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-background text-xs font-semibold text-white"
                  style={{ backgroundColor: u.color }}
                >
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
            <div className="hidden items-center gap-2 border-l pl-3 sm:flex">
              <span className="text-sm font-medium">{user?.name}</span>
              <Button variant="ghost" size="icon" title="Abmelden" onClick={logout}>
                <LogOut className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </header>
        {/* `overflow-x-clip` hält die Seite selbst immer im Viewport: zu breite
            Inhalte (lange Kontonamen, IBANs) dürfen nie die ganze App seitwärts
            scrollen lassen. Seitwärts scrollen darf nur der jeweilige Container
            (Tabellen/Karten mit `overflow-x-auto`) — wie in einer nativen App. */}
        <main className="min-w-0 flex-1 overflow-x-clip px-4 py-6 md:px-8">
          <Outlet />
        </main>
        <nav className="sticky bottom-0 z-10 flex justify-around border-t bg-background py-2 md:hidden">
          {mobilePrimaryItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1 text-[10px]',
                isActive ? 'text-emerald-600' : 'text-muted-foreground',
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="w-full truncate text-center">{item.label}</span>
            </NavLink>
          ))}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1 text-[10px]',
                  moreOpen ? 'text-emerald-600' : 'text-muted-foreground',
                )}
              >
                <Menu className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-center">Mehr</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Alle Bereiche</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                {navGroups.map((group) => (
                  <div key={group.label}>
                    <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group.label}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setMoreOpen(false)}
                          className={({ isActive }) => cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </div>
  );
}
