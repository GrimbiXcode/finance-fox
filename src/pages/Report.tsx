import { useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  REPORT_MONTHS, REPORT_MONTHS_LABELS, REPORT_SECTIONS,
  REPORT_SECTION_HINTS, REPORT_SECTION_LABELS, type ReportSection,
} from '@contracts/report';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { trpc } from '@/providers/trpc';
import { filenameFromResponse, saveBlobAsFile } from '@/lib/download';
import { getUserLocale } from '@/lib/finance';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'ff-report-sections';

/** Zuletzt gewählte Abschnitte; ohne gespeicherte Auswahl sind alle an. */
function loadSelection(): ReportSection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...REPORT_SECTIONS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...REPORT_SECTIONS];
    const wanted = new Set(parsed.map(String));
    return REPORT_SECTIONS.filter((s) => wanted.has(s));
  } catch {
    return [...REPORT_SECTIONS];
  }
}

/**
 * Bericht über Konten und ihre Verwendung — als PDF zum Mitnehmen (etwa ins
 * Bankgespräch) oder als Excel-Mappe zum Weiterrechnen. Die Abschnitte sind
 * frei wählbar; erzeugt werden die Dateien serverseitig
 * (`GET /api/export/bericht.pdf|.xlsx`).
 */
export default function Report() {
  const [selected, setSelected] = useState<ReportSection[]>(loadSelection);
  const [months, setMonths] = useState<number>(12);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

  // Nur zum Vorab-Hinweis „keine Daten" — der Bericht selbst sammelt
  // serverseitig neu, damit die Zahlen in einer Quelle entstehen.
  const goals = trpc.finance.listGoals.useQuery();
  const accounts = trpc.finance.listAccounts.useQuery();
  const recurring = trpc.finance.listRecurring.useQuery();
  const mortgage = trpc.mortgage.summary.useQuery();
  const insurance = trpc.insurance.summary.useQuery();
  const pension = trpc.pension.getProfile.useQuery();

  const hasData = useMemo<Record<ReportSection, boolean | undefined>>(
    () => ({
      accounts: accounts.data && accounts.data.length > 0,
      goals: goals.data && goals.data.length > 0,
      mortgages: mortgage.data && mortgage.data.count > 0,
      pension: pension.data !== undefined ? pension.data !== null : undefined,
      insurances: insurance.data && insurance.data.count > 0,
      recurring: recurring.data && recurring.data.length > 0,
      // Cashflow und Nettovermögen leiten sich aus Buchungen bzw. Konten ab —
      // ohne Konto gibt es beides nicht.
      cashflow: accounts.data && accounts.data.length > 0,
      netWorth: accounts.data && accounts.data.length > 0,
    }),
    [accounts.data, goals.data, mortgage.data, insurance.data, pension.data, recurring.data],
  );

  const toggle = (section: ReportSection) => {
    setSelected((prev) => {
      const next = prev.includes(section)
        ? prev.filter((s) => s !== section)
        : REPORT_SECTIONS.filter((s) => s === section || prev.includes(s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const setAll = (on: boolean) => {
    const next = on ? [...REPORT_SECTIONS] : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSelected(next);
  };

  /** Bericht vom Server holen und als Datei herunterladen (Muster: Backup) */
  const download = async (format: 'pdf' | 'xlsx') => {
    setBusy(format);
    try {
      const params = new URLSearchParams({
        sections: selected.join(','),
        months: String(months),
        locale: getUserLocale(),
      });
      const res = await fetch(`/api/export/bericht.${format}?${params}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Export fehlgeschlagen (Status ${res.status}).`);
      }
      const blob = await res.blob();
      saveBlobAsFile(blob, filenameFromResponse(res, `finance-fox-bericht.${format}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  const nothingSelected = selected.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bericht</h1>
          <p className="text-sm text-muted-foreground">
            Konten und ihre Verwendung als Dokument — zum Mitnehmen ins Bank-
            oder Beratungsgespräch
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => download('pdf')} disabled={nothingSelected || busy !== null}>
            <FileText className="mr-2 h-4 w-4" />
            {busy === 'pdf' ? 'Erstelle…' : 'PDF-Bericht'}
          </Button>
          <Button
            variant="outline"
            onClick={() => download('xlsx')}
            disabled={nothingSelected || busy !== null}
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {busy === 'xlsx' ? 'Erstelle…' : 'Excel-Mappe'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Inhalt des Berichts</CardTitle>
              <CardDescription>
                {nothingSelected
                  ? 'Kein Abschnitt gewählt — bitte mindestens einen ankreuzen.'
                  : `${selected.length} von ${REPORT_SECTIONS.length} Abschnitten gewählt`}
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
                Alle
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAll(false)}>
                Keine
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {REPORT_SECTIONS.map((section) => {
              const checked = selected.includes(section);
              const empty = hasData[section] === false;
              return (
                <label
                  key={section}
                  htmlFor={`section-${section}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    checked ? 'border-emerald-600/40 bg-emerald-600/5' : 'hover:bg-muted/50',
                  )}
                >
                  <Checkbox
                    id={`section-${section}`}
                    checked={checked}
                    onCheckedChange={() => toggle(section)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {REPORT_SECTION_LABELS[section]}
                      </span>
                      {empty && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          keine Daten
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {REPORT_SECTION_HINTS[section]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Label htmlFor="report-months" className="text-sm">
              Horizont der Prognose
            </Label>
            <select
              id="report-months"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {REPORT_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {REPORT_MONTHS_LABELS[m]}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              wirkt auf den Abschnitt „{REPORT_SECTION_LABELS.netWorth}"
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileDown className="h-4 w-4" /> Was im Bericht steht
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">PDF</strong> — ein gegliederter
            Bericht mit Kennzahlen und Tabellen, gedacht zum Ausdrucken und
            Weitergeben.
          </p>
          <p>
            <strong className="text-foreground">Excel</strong> — dieselben
            Daten als Arbeitsmappe, ein Blatt je Abschnitt. Beträge stehen als
            Zahlen in den Zellen und lassen sich sofort summieren und filtern.
          </p>
          <p>
            Der Bericht enthält <strong className="text-foreground">deine
            Sicht</strong>: Konten, die für dich sichtbar sind, und deine
            eigenen Vorsorgedaten — die Vorsorge ist pro Person privat.
            Hypotheken und Versicherungen gelten für den ganzen Haushalt.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
