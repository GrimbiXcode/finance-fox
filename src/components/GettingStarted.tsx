import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Circle, ListChecks, X } from 'lucide-react';
import Note from '@/components/Note';
import TransactionDialog from '@/components/TransactionDialog';
import DefaultCategoriesPicker from '@/components/DefaultCategoriesPicker';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useFinanceData } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { trpc } from '@/providers/trpc';

const HIDDEN_KEY = 'ff-getting-started-hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Ein Schritt: Haken, Text, Aktion (Link oder Dialog-Auslöser) */
function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {done
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" />
        : <Circle className="h-4 w-4 shrink-0 opacity-60" />}
      <span className={done ? 'line-through opacity-60' : ''}>{children}</span>
    </li>
  );
}

const actionClass = 'font-medium underline decoration-dotted underline-offset-4 hover:decoration-solid';

/**
 * Erste Schritte auf dem Dashboard: zeigt, welche Grundlagen noch fehlen, in
 * der sinnvollen Reihenfolge — jeder Punkt führt direkt zur Aktion. Der
 * Zettel verschwindet, sobald alles erledigt ist, und lässt sich pro Gerät
 * ausblenden.
 */
export default function GettingStarted() {
  const { user } = useAuth();
  const { accounts, categories, users, recurring, budgets, isLoading } = useFinanceData();
  // Sichtbare Buchungen (nicht haushaltsweit `hasData` — das verriete, dass
  // ein anderes Mitglied privat bucht)
  const anyTx = trpc.finance.searchTransactions.useQuery({ limit: 1 });
  const [hidden, setHidden] = useState(readHidden);
  const [catsOpen, setCatsOpen] = useState(false);

  const isAdmin = user?.role === 'admin';
  const steps = {
    account: accounts.length > 0,
    categories: categories.length > 0,
    transaction: (anyTx.data?.total ?? 0) > 0,
    person: users.length > 1,
    recurring: recurring.length > 0,
    budget: budgets.length > 0,
  };
  const relevant = Object.entries(steps).filter(([key]) => key !== 'person' || isAdmin);
  const doneCount = relevant.filter(([, done]) => done).length;

  if (isLoading || anyTx.isLoading || hidden || doneCount === relevant.length) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, 'true');
    } catch {
      // Ohne Speicher bleibt der Zettel nur für diese Sitzung weg
    }
  };

  return (
    <Note title={`Erste Schritte (${doneCount} von ${relevant.length})`} icon={ListChecks} tilt={-0.3}>
      <button
        type="button"
        onClick={hide}
        title="Erste Schritte ausblenden"
        className="float-right -mt-7 rounded p-1 opacity-60 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <Step done={steps.account}>
          <Link to="/konten" className={actionClass}>Konto anlegen</Link> — wo das Geld liegt
        </Step>
        <Step done={steps.categories}>
          <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
            <DialogTrigger asChild>
              <button type="button" className={actionClass}>Kategorien übernehmen</button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Kategorie-Vorschläge</DialogTitle>
                <DialogDescription>
                  Ein erprobtes Set für den Haushalt — später frei änderbar.
                </DialogDescription>
              </DialogHeader>
              <DefaultCategoriesPicker submitLabel="Übernehmen" onDone={() => setCatsOpen(false)} />
            </DialogContent>
          </Dialog>{' '}
          — Grundlage für Budgets
        </Step>
        <Step done={steps.transaction}>
          <TransactionDialog
            trigger={<button type="button" className={actionClass}>Erste Buchung erfassen</button>}
          />
        </Step>
        {isAdmin && (
          <Step done={steps.person}>
            <Link to="/personen" className={actionClass}>Haushaltsmitglied einladen</Link>
          </Step>
        )}
        <Step done={steps.recurring}>
          <Link to="/wiederkehrend?neu=1" className={actionClass}>Dauerbuchung anlegen</Link> — Lohn, Miete, Abos
        </Step>
        <Step done={steps.budget}>
          <Link to="/budgets" className={actionClass}>Budget setzen</Link> — z. B. Lebensmittel pro Monat
        </Step>
      </ul>
    </Note>
  );
}
