import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { getUserLocale } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const MAX_SIZE = 5 * 1024 * 1024;

type ImportResult = { imported: number; skipped: number; errors: string[] };

/** Dialog zum CSV-Import von Transaktionen auf ein Zielkonto */
export default function CsvImportDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" /> CSV importieren
        </Button>
      </DialogTrigger>
      {open && <CsvImportForm close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit der Zustand frisch ist */
function CsvImportForm({ close }: { close: () => void }) {
  const { accounts } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const importCsv = trpc.finance.importTransactionsCsv.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.imported > 0) invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Nur Konten, auf die der Nutzer Schreibzugriff hat
  const editableAccounts = accounts.filter((a) => a.access === 'edit');

  // Formathinweis passend zur Browser-Region (de: Semikolon/Dezimalkomma,
  // sonst Komma/Dezimalpunkt — der Import erkennt das Trennzeichen selbst)
  const isGermanCsv = getUserLocale().toLowerCase().startsWith('de');
  const csvSeparator = isGermanCsv ? ';' : ',';
  const csvHeaderExample = ['Datum', 'Typ', 'Betrag', 'Kategorie', 'Konto', 'Zielkonto', 'Notiz'].join(csvSeparator);
  const csvAmountExample = isGermanCsv ? '12,34' : '12.34';

  const submit = async () => {
    if (!file) { toast.error('Bitte eine CSV-Datei auswählen.'); return; }
    if (file.size > MAX_SIZE) { toast.error('Die Datei ist größer als 5 MB.'); return; }
    if (!accountId) { toast.error('Bitte ein Zielkonto auswählen.'); return; }
    const csv = await file.text();
    importCsv.mutate({ csv, accountId: Number(accountId) });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>CSV importieren</DialogTitle>
        <DialogDescription>
          Transaktionen aus einer CSV-Datei auf ein Konto importieren.
        </DialogDescription>
      </DialogHeader>
      {result ? (
        <div className="grid gap-3 py-2">
          <p className="text-sm">
            <span className="font-semibold">{result.imported}</span> Buchungen importiert
            {result.skipped > 0 && (
              <>, <span className="font-semibold">{result.skipped}</span> Zeilen übersprungen
              (u. a. Umbuchungen und fehlerhafte Zeilen)</>
            )}.
          </p>
          {result.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-destructive/50 p-3">
              <p className="text-sm font-semibold text-destructive">Fehlerhafte Zeilen</p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>CSV-Datei (max. 5 MB)</Label>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label>Zielkonto</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
              <SelectContent>
                {editableAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editableAccounts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Du hast auf kein Konto Schreibzugriff.
              </p>
            )}
          </div>
          <div className="rounded-lg border p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Erwartetes Format</p>
            <p>
              {isGermanCsv ? 'Semikolon-getrennt' : 'Komma-getrennt'} mit Kopfzeile{' '}
              <code className="rounded bg-muted px-1">{csvHeaderExample}</code>,
              Betrag mit {isGermanCsv ? 'Dezimalkomma' : 'Dezimalpunkt'} (z.&nbsp;B.{' '}
              <code className="rounded bg-muted px-1">{csvAmountExample}</code>),
              Datum als <code className="rounded bg-muted px-1">JJJJ-MM-TT</code>.
              Es werden nur Einnahmen und Ausgaben importiert — Umbuchungen werden übersprungen.
              Kategorien werden per Name zugeordnet, das Konto der Zeilen wird ignoriert.
            </p>
          </div>
        </div>
      )}
      <DialogFooter>
        {result ? (
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={close}>Schließen</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close}>Abbrechen</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={submit}
              disabled={importCsv.isPending || !file || !accountId}
            >
              {importCsv.isPending ? 'Importiere…' : 'Importieren'}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
