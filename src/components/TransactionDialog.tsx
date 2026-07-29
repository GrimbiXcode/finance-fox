import { useMemo, useRef, useState, type ReactNode } from 'react';
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
import { SearchableSelect } from '@/components/SearchableSelect';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import {
  amountPlaceholder, currencySymbol, formatCents, getUserLocale, parseEuro, todayISO,
} from '@/lib/finance';
import { sharesFromWeights, type ShareWeight } from '@contracts/splitShares';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

type TxType = 'income' | 'expense' | 'transfer';

/** Buchung aus listTransactions, die im Edit-Modus bearbeitet wird */
export type EditableTransaction = {
  id: number;
  type: TxType;
  accountId: number;
  toAccountId: number | null;
  amount: number;
  categoryId: number | null;
  userId: number;
  projectId: number | null;
  date: string;
  note: string;
  recurringId: number | null;
  splits: { userId: number; amount: number }[];
  tags: { id: number; name: string; color: string }[];
};

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

/**
 * Dialog zum Erfassen einer neuen Buchung (Einnahme, Ausgabe, Umbuchung).
 * Mit `transaction`-Prop Edit-Modus: befüllt alle Felder, die Art-Wahl ist
 * deaktiviert (Buchungsart ist unveränderlich) und Speichern ruft
 * updateTransaction mit optionalem Änderungskommentar auf. Belege werden im
 * Edit-Modus nicht angeboten (dafür gibt es den Belege-Dialog).
 */
export default function TransactionDialog({
  defaultType = 'expense',
  transaction,
  trigger,
}: {
  defaultType?: TxType;
  transaction?: EditableTransaction;
  trigger?: ReactNode;
}) {
  const { user } = useAuth();
  const { accounts, banks, categories, users, projects, splitTemplates, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const isEdit = transaction !== undefined;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TxType>(transaction?.type ?? defaultType);
  const [amount, setAmount] = useState(transaction ? shareFormatter.format(transaction.amount / 100) : '');
  const [accountId, setAccountId] = useState(transaction ? String(transaction.accountId) : '');
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId ? String(transaction.toAccountId) : '');
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ? String(transaction.categoryId) : '');
  const [userId, setUserId] = useState(transaction ? String(transaction.userId) : '');
  const [projectId, setProjectId] = useState(transaction?.projectId ? String(transaction.projectId) : ''); // '' = Haushalt
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [note, setNote] = useState(transaction?.note ?? '');
  const [splitEnabled, setSplitEnabled] = useState((transaction?.splits.length ?? 0) > 0);
  const [shares, setShares] = useState<Record<number, string>>(() => {
    const next: Record<number, string> = {};
    for (const s of transaction?.splits ?? []) next[s.userId] = shareFormatter.format(s.amount / 100);
    return next;
  });
  // Optionaler Kommentar für die Änderungshistorie (nur Edit-Modus)
  const [comment, setComment] = useState('');
  // Inline-Bereich „Als Vorlage speichern" (aktuelle Anteile als Gewichte)
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  // Im Edit-Modus standardmäßig geöffnet (Kommentarfeld liegt hier)
  const [detailsOpen, setDetailsOpen] = useState(isEdit);
  // Inline-Bereich für "+ Neue Kategorie" (Muster wie "+ Neuer Typ" im Konto-Dialog)
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  // Gewählte Tags der Buchung + Inline-Bereich für "+ Neuer Tag"
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(transaction?.tags.map((t) => t.id) ?? []);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  // Inline-Anlage als Unterkategorie der aktuell gewählten Oberkategorie
  const [newCatAsChild, setNewCatAsChild] = useState(false);
  // Gewählte Beleg-Dateien (werden nach dem Speichern der Buchung hochgeladen)
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const createTx = trpc.finance.createTransaction.useMutation();
  const updateTx = trpc.finance.updateTransaction.useMutation();

  const createTemplate = trpc.finance.createSplitTemplate.useMutation({
    onSuccess: () => {
      toast.success('Vorlage gespeichert.');
      utils.finance.listSplitTemplates.invalidate();
      setSaveTplName('');
      setSaveTplOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

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

  const createTag = trpc.finance.createTag.useMutation({
    onSuccess: async (created) => {
      toast.success('Tag angelegt.');
      await utils.finance.listTags.invalidate();
      // createTag liefert den neuen Tag zurück — direkt auswählen
      setSelectedTagIds((ids) => [...ids, created.id]);
      setNewTagName('');
      setNewTagOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  /** Tag-Auswahl umschalten (mehrere Tags pro Buchung möglich) */
  const toggleTag = (tagId: number) => {
    setSelectedTagIds((ids) =>
      ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId],
    );
  };

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
    } else if (isEdit && type === 'expense' && transaction.splits.length > 0) {
      // Bestehende Aufteilung entfernen (Ersetzen-Semantik serverseitig)
      splits = [];
    }

    setSaving(true);
    try {
      if (isEdit) {
        // Edit-Modus: partielles Update, Änderungen werden protokolliert
        await updateTx.mutateAsync({
          id: transaction.id,
          amount: cents,
          date,
          note,
          accountId: effectiveAccountId,
          toAccountId: type === 'transfer' ? effectiveToAccountId : undefined,
          categoryId: type === 'transfer' ? undefined : categoryId ? Number(categoryId) : null,
          projectId: projectId ? Number(projectId) : null,
          userId: effectiveUserId,
          tagIds: selectedTagIds,
          splits,
          comment: comment.trim() ? comment.trim() : undefined,
        });
        toast.success('Buchung aktualisiert.');
        invalidate();
        setOpen(false);
        return;
      }
      // Erst die Buchung speichern, dann die Belege zur neuen ID hochladen
      const created = await createTx.mutateAsync({
        type, accountId: effectiveAccountId,
        toAccountId: type === 'transfer' ? effectiveToAccountId : undefined,
        amount: cents, categoryId: categoryId ? Number(categoryId) : undefined,
        projectId: projectId ? Number(projectId) : undefined,
        userId: effectiveUserId, date, note, splits,
        tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
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
      setProjectId(''); setSaveTplOpen(false); setSaveTplName('');
      setSelectedTagIds([]); setNewTagOpen(false); setNewTagName('');
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

  /**
   * Betrag gewichtet auf Anteile verteilen (Restdifferenz auf dem ersten
   * Anteil) — Mitglieder ohne Gewicht bekommen 0.
   */
  const applyWeights = (weights: ShareWeight[]) => {
    const cents = parseEuro(amount);
    if (cents <= 0) { toast.error('Zuerst einen Betrag eingeben.'); return; }
    const byUser = new Map(sharesFromWeights(cents, weights).map((s) => [s.userId, s.amount]));
    const next: Record<number, string> = {};
    for (const u of users) next[u.id] = shareFormatter.format((byUser.get(u.id) ?? 0) / 100);
    setShares(next);
  };

  /** Vorlagen-Auswahl: Schnellwahl (60/40, 70/30) oder gespeicherte Vorlage */
  const applyTemplate = (value: string) => {
    const other = users.find((u) => u.id !== effectiveUserId);
    if (value === 'preset-60-40' || value === 'preset-70-30') {
      if (!other) return;
      const first = value === 'preset-60-40' ? 60 : 70;
      applyWeights([
        { userId: effectiveUserId, weight: first },
        { userId: other.id, weight: 100 - first },
      ]);
      return;
    }
    const tpl = splitTemplates.find((t) => `tpl-${t.id}` === value);
    if (tpl) applyWeights(tpl.shares);
  };

  /** Aktuell eingegebene Anteile als Gewichte einer neuen Vorlage speichern */
  const saveAsTemplate = () => {
    const weights = users
      .map((u) => ({ userId: u.id, weight: parseEuro(shares[u.id] ?? '') }))
      .filter((w) => w.weight > 0);
    if (weights.length === 0) { toast.error('Zuerst Anteile eingeben.'); return; }
    if (!saveTplName.trim()) { toast.error('Bitte einen Namen für die Vorlage eingeben.'); return; }
    createTemplate.mutate({ name: saveTplName.trim(), shares: weights });
  };

  const isTransfer = type === 'transfer';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="mr-2 h-4 w-4" /> Neue Buchung
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Buchung bearbeiten' : 'Neue Buchung'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Bestehende Buchung anpassen — jede Änderung wird protokolliert.'
              : 'Einnahme, Ausgabe oder Umbuchung zwischen Konten erfassen.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
            {([['expense', 'Ausgabe'], ['income', 'Einnahme'], ['transfer', 'Umbuchung']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={isEdit}
                title={isEdit ? 'Die Buchungsart kann nicht geändert werden — bitte löschen und neu anlegen.' : undefined}
                className={cn(
                  'rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-muted-foreground',
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

          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Von Konto</Label>
                <SearchableSelect
                  value={String(effectiveAccountId || '')}
                  onValueChange={setAccountId}
                  placeholder="Konto wählen"
                  options={accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Nach Konto</Label>
                <SearchableSelect
                  value={String(effectiveToAccountId || '')}
                  onValueChange={setToAccountId}
                  placeholder="Zielkonto"
                  options={accounts
                    .filter((a) => a.id !== effectiveAccountId)
                    .map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Konto</Label>
                <SearchableSelect
                  value={String(effectiveAccountId || '')}
                  onValueChange={setAccountId}
                  placeholder="Konto wählen"
                  options={accounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Kategorie</Label>
                {/* Sentinel „none" statt leerem String — intern bleibt „keine
                    Kategorie" der leere String (submit mappt auf undefined/null) */}
                <SearchableSelect
                  value={categoryId || 'none'}
                  onValueChange={(v) => setCategoryId(v === 'none' ? '' : v)}
                  placeholder="Optional"
                  options={[
                    { value: 'none', label: 'Keine Kategorie' },
                    ...groupedCategories.map((c) => ({
                      value: String(c.id),
                      // Unterkategorien eingerückt (Gruppierung wie bisher)
                      label: c.parentId ? `\u00A0\u00A0${c.name}` : c.name,
                    })),
                  ]}
                />
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
              <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <div className="flex items-center gap-2">
                    <Select value="" onValueChange={applyTemplate}>
                      <SelectTrigger className="h-8 w-36 min-w-0 text-xs [&>span]:truncate" title="Vorlage…">
                        <SelectValue placeholder="Vorlage…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preset-60-40">60/40</SelectItem>
                        <SelectItem value="preset-70-30">70/30</SelectItem>
                        {splitTemplates.map((t) => (
                          <SelectItem key={t.id} value={`tpl-${t.id}`}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={splitEvenly}>Gleichmäßig</Button>
                  </div>
                )}
              </div>
              {splitEnabled && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
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
                  {saveTplOpen ? (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        placeholder="Name der Vorlage"
                        className="h-8 text-xs"
                        value={saveTplName}
                        onChange={(e) => setSaveTplName(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={createTemplate.isPending}
                        onClick={saveAsTemplate}
                      >
                        Speichern
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                      onClick={() => setSaveTplOpen(true)}
                    >
                      <Plus className="h-3 w-3" /> Als Vorlage speichern
                    </button>
                  )}
                </>
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
                Details (Person, Notiz, Projekt, Tags)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                {isEdit && transaction.recurringId !== null && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:col-span-2 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    Diese Buchung stammt aus einer Dauerbuchung — die Änderung betrifft nur diese Buchung, nicht die Dauerbuchung.
                  </p>
                )}
                <div className="space-y-2">
                  <Label>{type === 'expense' ? 'Bezahlt von' : 'Person'}</Label>
                  <SearchableSelect
                    value={String(effectiveUserId || '')}
                    onValueChange={setUserId}
                    options={users.map((u) => ({ value: String(u.id), label: u.name }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note">Notiz</Label>
                  <Input id="note" placeholder="z. B. Wocheneinkauf" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                {projects.length > 0 && (
                  <div className="space-y-2">
                    <Label>Projekt</Label>
                    {/* Sentinel „household" = laufender Haushalt (intern leerer String) */}
                    <SearchableSelect
                      value={projectId || 'household'}
                      onValueChange={(v) => setProjectId(v === 'household' ? '' : v)}
                      options={[
                        { value: 'household', label: 'Haushalt' },
                        ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                      ]}
                    />
                  </div>
                )}
                <div className="space-y-2 sm:col-span-2">
                  <Label>Tags</Label>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => {
                        const active = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                              active
                                ? 'border-transparent bg-emerald-600 text-white'
                                : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {newTagOpen ? (
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        placeholder="Name des Tags"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!newTagName.trim() || createTag.isPending}
                        onClick={() => createTag.mutate({ name: newTagName.trim() })}
                      >
                        Anlegen
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                      onClick={() => setNewTagOpen(true)}
                    >
                      <Plus className="h-3 w-3" /> Neuer Tag
                    </button>
                  )}
                </div>
                {isEdit && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="edit-comment">Änderungskommentar (optional)</Label>
                    <Input
                      id="edit-comment"
                      placeholder="z. B. Betrag korrigiert"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Wird zusammen mit den geänderten Feldern im Änderungsverlauf gespeichert.
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {!isEdit && (
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
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={submit}
            disabled={saving}
          >
            {saving ? 'Speichern…' : isEdit ? 'Änderungen speichern' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
