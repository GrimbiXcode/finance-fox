import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/providers/auth';

/**
 * „Meine Sicht“ oder „Haushalt“ (H6): ein Umschalter in der Kopfzeile, pro
 * Gerät gemerkt. In „Meine Sicht“ zählen Dashboard, Transaktionen und
 * Auswertung nur Buchungen, die man selbst erfasst bzw. bezahlt hat
 * (`userId`). Vermögen, Budgets und Aufteilung bleiben haushaltsweit — ein
 * Konto gehört nicht einer Buchungsperson.
 */
type Scope = 'household' | 'mine';
const KEY = 'ff-scope';

interface ScopeValue {
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** userId für die Endpunkte (undefined = Haushalt) */
  userId: number | undefined;
}

const ScopeContext = createContext<ScopeValue | null>(null);

function readScope(): Scope {
  try {
    return localStorage.getItem(KEY) === 'mine' ? 'mine' : 'household';
  } catch {
    return 'household';
  }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [scope, setScopeState] = useState<Scope>(readScope);
  const setScope = useCallback((next: Scope) => {
    setScopeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // nur für diese Sitzung
    }
  }, []);
  const userId = scope === 'mine' ? user?.id : undefined;
  const value = useMemo(() => ({ scope, setScope, userId }), [scope, setScope, userId]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope muss innerhalb von ScopeProvider stehen');
  return ctx;
}
