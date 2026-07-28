import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const MAX_SIZE = 10 * 1024 * 1024;

type ImportResult = { imported: number; duplicates: number; errors: string[] };

/** Dialog zum Import von camt.053-Kontoauszügen (ISO-20022-XML) auf ein Zielkonto */
export default function CamtImportDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="mr-2 h-4 w-4" /> CAMT importieren
        </Button>
      </DialogTrigger>
      {open && <CamtImportForm close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit der Zustand frisch ist */
function CamtImportForm({ close }: { close: () => void }) {
  const { accounts, banks } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const importCamt = trpc.finance.importCamt.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.imported > 0) invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Nur Konten, auf die der Nutzer Schreibzugriff hat
  const editableAccounts = accounts.filter((a) => a.access === 'edit');

  const submit = async () => {
    if (!file) { toast.error('Bitte eine XML-Datei auswählen.'); return; }
    if (file.size > MAX_SIZE) { toast.error('Die Datei ist größer als 10 MB.'); return; }
    if (!accountId) { toast.error('Bitte ein Zielkonto auswählen.'); return; }
    const xml = await file.text();
    importCamt.mutate({ xml, accountId: Number(accountId) });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>CAMT importieren</DialogTitle>
        <DialogDescription>
          Kontoauszug im camt.053-Format (ISO 20022) auf ein Konto importieren.
        </DialogDescription>
      </DialogHeader>
      {result ? (
        <div className="grid gap-3 py-2">
          <p className="text-sm">
            <span className="font-semibold">{result.imported}</span> Buchungen importiert
            {result.duplicates > 0 && (
              <>, <span className="font-semibold">{result.duplicates}</span> Dubletten übersprungen</>
            )}.
          </p>
          {result.errors.length > 0 && (
            <div className="space-y-1 rounded-lg border border-destructive/50 p-3">
              <p className="text-sm font-semibold text-destructive">Fehlerhafte Buchungen</p>
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>XML-Datei (max. 10 MB)</Label>
            <Input
              type="file"
              accept=".xml,text/xml,application/xml"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label>Zielkonto</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
              <SelectContent>
                {editableAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{accountLabel(a, banks)}</SelectItem>
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
            <p className="mb-1 font-medium text-foreground">Hinweis</p>
            <p>
              Exportiere im E-Banking deiner Bank den Kontoauszug als
              camt.053-XML (ISO 20022, Standard bei Schweizer Banken) und lade
              die Datei hier hoch. Gutschriften werden als Einnahmen, Belastungen
              als Ausgaben ohne Kategorie gebucht; bereits vorhandene Buchungen
              (gleiches Datum, gleicher Betrag und gleiche Notiz) werden als
              Dubletten übersprungen.
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
              disabled={importCamt.isPending || !file || !accountId}
            >
              {importCamt.isPending ? 'Importiere…' : 'Importieren'}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
