import { useMemo, useRef, useState } from 'react';
import { ChevronRight, Paperclip, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import {
  amountPlaceholder, currencySymbol, formatCents, getUserLocale, parseEuro, todayISO,
} from '@/lib/finance';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

type TxType = 'income' | 'expense' | 'transfer';

// Farbpalette wie in der Kategorien-Verwaltung (Einstellungen)
const CAT_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#94a3b8', '#10b981'];

/** Locale-konforme Betragsanzeige ohne Währungssymbol/Tausendertrenner (für Eingabefelder) */
const shareFormatter = new Intl.NumberFormat(getUserLocale(), {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

// Erlaubte Beleg-Typen und Größenlimit wie in api/lib/attachments.ts
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

/** Dialog zum Erfassen einer neuen Buchung (Einnahme, Ausgabe, Umbuchung) */
export default function TransactionDialog({ defaultType = 'expense' }: { defaultType?: TxType }) {
  const { user } = useAuth();
  const { accounts, categories, users } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>(defaultType);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [shares, setShares] = useState<Record<number, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Inline-Bereich für "+ Neue Kategorie" (Muster wie "+ Neuer Typ" im Konto-Dialog)
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  // Inline-Anlage als Unterkategorie der aktuell gewählten Oberkategorie
  const [newCatAsChild, setNewCatAsChild] = useState(false);
  // Gewählte Beleg-Dateien (werden nach dem Speichern der Buchung hochgeladen)
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const createTx = trpc.finance.createTransaction.useMutation();

  const createCategory = trpc.finance.createCategory.useMutation({
    onSuccess: async (_data, vars) => {
      toast.success('Kategorie angelegt.');
      await utils.finance.listCategories.invalidate();
      // createCategory liefert keine ID zurück — neue Kategorie über Namen finden
      const created = utils.finance.listCategories
        .getData()
        ?.find(
          (c) =>
            c.name === vars.name &&
            c.type === vars.type &&
            (c.parentId ?? null) === (vars.parentId ?? null),
        );
      if (created) setCategoryId(String(created.id)); // direkt auswählen
      setNewCatName('');
      setNewCatAsChild(false);
      setNewCatOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const effectiveUserId = userId ? Number(userId) : (user?.id ?? 0);
  const effectiveAccountId = accountId ? Number(accountId) : (accounts[0]?.id ?? 0);
  const effectiveToAccountId = toAccountId ? Number(toAccountId) : (accounts.find((a) => a.id !== effectiveAccountId)?.id ?? 0);

  const filteredCategories = useMemo(
    () => categories.filter((c) => (type === 'income' ? c.type === 'income' : c.type === 'expense')),
    [categories, type],
  );

  /**
   * Gruppierte Reihenfolge für das Kategorie-Select: jede Oberkategorie,
   * direkt gefolgt von ihren Unterkategorien (in der Anzeige eingerückt).
   */
  const groupedCategories = useMemo(() => {
    const roots = filteredCategories.filter((c) => c.parentId === null);
    return roots.flatMap((root) => [
      root,
      ...filteredCategories.filter((c) => c.parentId === root.id),
    ]);
  }, [filteredCategories]);

  // Gewählte Kategorie, falls es eine Oberkategorie ist — dann kann die
  // Inline-Anlage optional eine Unterkategorie davon anlegen
  const selectedRoot = useMemo(() => {
    const sel = categories.find((c) => String(c.id) === categoryId);
    return sel && sel.parentId === null ? sel : undefined;
  }, [categories, categoryId]);

  /** Palettenfarbe mit der geringsten bisherigen Verwendung wählen */
  const nextCategoryColor = (): string => {
    const counts = new Map<string, number>(CAT_COLORS.map((c) => [c, 0]));
    for (const c of categories) counts.set(c.color, (counts.get(c.color) ?? 0) + 1);
    return CAT_COLORS.reduce((best, c) => ((counts.get(c) ?? 0) < (counts.get(best) ?? 0) ? c : best));
  };

  /** Buchungsart wechseln — Kategorie zurücksetzen, wenn sie nicht zum neuen Typ passt */
  const changeType = (value: TxType) => {
    setType(value);
    if (value === 'transfer') {
      setCategoryId('');
      setNewCatOpen(false);
      return;
    }
    const selected = categories.find((c) => String(c.id) === categoryId);
    if (selected && selected.type !== value) setCategoryId('');
  };

  /** Dateien zur Beleg-Liste hinzufügen (mit Größen-Check pro Datei) */
  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const next: File[] = [];
    for (const file of Array.from(selected)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`Die Datei „${file.name}" ist zu groß (maximal 10 MB).`);
        continue;
      }
      next.push(file);
    }
    if (next.length > 0) setFiles((f) => [...f, ...next]);
  };

  /** Einzelnen Beleg hochladen; true bei Erfolg */
  const uploadAttachment = async (transactionId: number, file: File): Promise<boolean> => {
    try {
      const res = await fetch(`/api/attachments?transactionId=${transactionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const submit = async () => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Bitte einen gültigen Betrag eingeben.'); return; }
    if (!effectiveAccountId) { toast.error('Bitte zuerst ein Konto anlegen.'); return; }
    if (type === 'transfer' && (!effectiveToAccountId || effectiveToAccountId === effectiveAccountId)) {
      toast.error('Zielkonto muss ein anderes Konto sein.'); return;
    }

    let splits;
    if (type === 'expense' && splitEnabled && users.length > 1) {
      const parsed = users.map((u) => ({ userId: u.id, amount: parseEuro(shares[u.id] ?? '') }));
      const sum = parsed.reduce((s, p) => s + p.amount, 0);
      if (sum !== cents) {
        toast.error(`Die Anteile (${formatCents(sum)}) müssen in Summe dem Betrag entsprechen.`);
        return;
      }
      splits = parsed.filter((p) => p.amount > 0);
    }

    setSaving(true);
    try {
      // Erst die Buchung speichern, dann die Belege zur neuen ID hochladen
      const created = await createTx.mutateAsync({
        type, accountId: effectiveAccountId,
        toAccountId: type === 'transfer' ? effectiveToAccountId : undefined,
        amount: cents, categoryId: categoryId ? Number(categoryId) : undefined,
        userId: effectiveUserId, date, note, splits,
      });
      for (const file of files) {
        const ok = await uploadAttachment(created.id, file);
        if (!ok) {
          toast.warning(`Buchung gespeichert, aber Beleg „${file.name}" konnte nicht hochgeladen werden.`);
        }
      }
      toast.success('Buchung gespeichert.');
      invalidate();
      setOpen(false);
      setAmount(''); setNote(''); setCategoryId(''); setSplitEnabled(false); setShares({});
      setFiles([]);
      setDate(todayISO());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Die Buchung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const splitEvenly = () => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Zuerst einen Betrag eingeben.'); return; }
    const base = Math.floor(cents / users.length);
    const next: Record<number, string> = {};
    users.forEach((u, idx) => {
      const share = idx === 0 ? cents - base * (users.length - 1) : base;
      next[u.id] = shareFormatter.format(share / 100);
    });
    setShares(next);
  };

  const isTransfer = type === 'transfer';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="mr-2 h-4 w-4" /> Neue Buchung
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue Buchung</DialogTitle>
          <DialogDescription>Einnahme, Ausgabe oder Umbuchung zwischen Konten erfassen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
            {([['expense', 'Ausgabe'], ['income', 'Einnahme'], ['transfer', 'Umbuchung']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  'rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                  type === value && 'bg-background text-foreground shadow-sm',
                  type === value && value === 'expense' && 'text-rose-600 dark:text-rose-400',
                  type === value && value === 'income' && 'text-emerald-600 dark:text-emerald-400',
                )}
                onClick={() => changeType(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Betrag ({currencySymbol()})</Label>
              <Input id="amount" inputMode="decimal" placeholder={amountPlaceholder} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Datum</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          {isTransfer ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Von Konto</Label>
                <Select value={String(effectiveAccountId || '')} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nach Konto</Label>
                <Select value={String(effectiveToAccountId || '')} onValueChange={setToAccountId}>
                  <SelectTrigger><SelectValue placeholder="Zielkonto" /></SelectTrigger>
                  <SelectContent>
                    {accounts.filter((a) => a.id !== effectiveAccountId).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Konto</Label>
                <Select value={String(effectiveAccountId || '')} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Konto wählen" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kategorie</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    {groupedCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.parentId ? `\u00A0\u00A0${c.name}` : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newCatOpen ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        placeholder="Name der Kategorie"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!newCatName.trim() || createCategory.isPending}
                        onClick={() =>
                          createCategory.mutate({
                            name: newCatName.trim(),
                            type: type === 'income' ? 'income' : 'expense',
                            color: newCatAsChild && selectedRoot ? selectedRoot.color : nextCategoryColor(),
                            parentId: newCatAsChild && selectedRoot ? selectedRoot.id : undefined,
                          })}
                      >
                        Anlegen
                      </Button>
                    </div>
                    {selectedRoot && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="new-cat-child"
                          checked={newCatAsChild}
                          onCheckedChange={(checked) => setNewCatAsChild(checked === true)}
                        />
                        <Label htmlFor="new-cat-child" className="cursor-pointer text-xs font-normal text-muted-foreground">
                          Als Unterkategorie von „{selectedRoot.name}“ anlegen
                        </Label>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                    onClick={() => setNewCatOpen(true)}
                  >
                    <Plus className="h-3 w-3" /> Neue Kategorie
                  </button>
                )}
              </div>
            </div>
          )}

          {type === 'expense' && users.length > 1 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="split"
                    checked={splitEnabled}
                    onCheckedChange={(checked) => {
                      setSplitEnabled(checked === true);
                      if (checked === true) splitEvenly();
                    }}
                  />
                  <Label htmlFor="split" className="cursor-pointer">Kosten aufteilen</Label>
                </div>
                {splitEnabled && (
                  <Button type="button" variant="ghost" size="sm" onClick={splitEvenly}>Gleichmäßig</Button>
                )}
              </div>
              {splitEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  {users.map((u) => (
                    <div key={u.id} className="space-y-1">
                      <Label className="text-xs" style={{ color: u.color }}>{u.name} ({currencySymbol()})</Label>
                      <Input
                        inputMode="decimal"
                        placeholder={amountPlaceholder}
                        value={shares[u.id] ?? ''}
                        onChange={(e) => setShares((s) => ({ ...s, [u.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-90')} />
                Details (Person, Notiz)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{type === 'expense' ? 'Bezahlt von' : 'Person'}</Label>
                  <Select value={String(effectiveUserId || '')} onValueChange={setUserId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note">Notiz</Label>
                  <Input id="note" placeholder="z. B. Wocheneinkauf" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="space-y-2">
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = ''; // gleiche Datei erneut wählbar machen
              }}
            />
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" /> Belege hinzufügen
            </button>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {files.map((file, idx) => (
                  <span
                    key={`${file.name}-${idx}`}
                    className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                  >
                    <span className="max-w-48 truncate">{file.name}</span>
                    <button
                      type="button"
                      title="Datei entfernen"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setFiles((f) => f.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Speichern…' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
