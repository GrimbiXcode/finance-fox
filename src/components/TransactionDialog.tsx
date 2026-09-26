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
import TypeSegment from '@/components/TypeSegment';
import DateField from '@/components/DateField';
import NoteSuggestInput, { type NoteSuggestion } from '@/components/NoteSuggestInput';
import { accountLabel, useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import {
  amountPlaceholder, currencySymbol, formatCents, getUserLocale, parseEuro, todayISO,
} from '@/lib/finance';
import { sharesFromWeights, type ShareWeight } from '@contracts/splitShares';
import { cn } from '@/lib/utils';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';
import { PENCIL_COLORS , pencil } from '@/lib/pencil';

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
const CAT_COLORS = PENCIL_COLORS;

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
  template,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: {
  defaultType?: TxType;
  transaction?: EditableTransaction;
  /**
   * Duplizieren (B6): neue Buchung, vorbefüllt aus einer bestehenden —
   * Datum heute, ohne Belege und ohne Änderungskommentar.
   */
  template?: EditableTransaction;
  trigger?: ReactNode;
  /**
   * Gesteuert von außen (Tastaturkürzel „N“, Befehlspalette): dann ohne
   * eigenen Auslöser, sofern kein `trigger` übergeben wird.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fokus nach dem Schließen (globaler Dialog: zurück aufs Element davor) */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const { user } = useAuth();
  const { accounts, banks, categories, users, projects, splitTemplates, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const isEdit = transaction !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  // Vorbelegung: beim Bearbeiten die Buchung, beim Duplizieren die Vorlage
  const source = transaction ?? template;
  const [type, setType] = useState<TxType>(source?.type ?? defaultType);
  const [amount, setAmount] = useState(source ? shareFormatter.format(source.amount / 100) : '');
  const [accountId, setAccountId] = useState(source ? String(source.accountId) : '');
  const [toAccountId, setToAccountId] = useState(source?.toAccountId ? String(source.toAccountId) : '');
  const [categoryId, setCategoryId] = useState(source?.categoryId ? String(source.categoryId) : '');
  const [userId, setUserId] = useState(source ? String(source.userId) : '');
  const [projectId, setProjectId] = useState(source?.projectId ? String(source.projectId) : ''); // '' = Haushalt
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [note, setNote] = useState(source?.note ?? '');
  const [splitEnabled, setSplitEnabled] = useState((source?.splits.length ?? 0) > 0);
  const [shares, setShares] = useState<Record<number, string>>(() => {
    const next: Record<number, string> = {};
    for (const s of source?.splits ?? []) next[s.userId] = shareFormatter.format(s.amount / 100);
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
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(source?.tags.map((t) => t.id) ?? []);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  // Inline-Anlage als Unterkategorie der aktuell gewählten Oberkategorie
  const [newCatAsChild, setNewCatAsChild] = useState(false);
  // Gewählte Beleg-Dateien (werden nach dem Speichern der Buchung hochgeladen)
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  // „Speichern & weitere“: Anzahl der in diesem Durchgang erfassten Buchungen
  const [savedCount, setSavedCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);

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
  // Buchen darf man nur auf Konten mit Bearbeitungsrecht; nur lesend
  // sichtbare Konten taugen als Ziel einer Umbuchung, nicht als Quelle
  const editableAccounts = accounts.filter((a) => a.access === 'edit');
  const sourceOptions = editableAccounts.map((a) => ({ value: String(a.id), label: accountLabel(a, banks) }));
  const effectiveAccountId = accountId ? Number(accountId) : (editableAccounts[0]?.id ?? 0);
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

  const usage = trpc.finance.categoryUsage.useQuery(undefined, { enabled: open && type !== 'transfer', staleTime: 60_000 });
  const frequentCategories = (type === 'transfer' ? [] : (usage.data?.[type].frequent ?? []))
    .map((id) => filteredCategories.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

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

  /**
   * Vorschlag aus der Historie übernehmen (siehe NoteSuggestInput). Beim
   * Bearbeiten nur die Notiz — sonst verschöbe ein Enter im Notizfeld die
   * Buchung still auf ein anderes Konto oder in eine andere Kategorie.
   */
  const applySuggestion = (s: NoteSuggestion) => {
    setNote(s.note);
    if (isEdit) return;
    if (s.categoryId !== null && categories.some((c) => c.id === s.categoryId && c.type === type)) {
      setCategoryId(String(s.categoryId));
    }
    if (accounts.some((a) => a.id === s.accountId && a.access === 'edit')) {
      setAccountId(String(s.accountId));
    }
    // Zielkonto nur, wenn es für mich sichtbar ist (Umbuchungen des Partners
    // auf dessen Privatkonto)
    if (type === 'transfer' && s.toAccountId !== null && accounts.some((a) => a.id === s.toAccountId)) {
      setToAccountId(String(s.toAccountId));
    }
    if (s.projectId !== null && projects.some((p) => p.id === s.projectId && !p.closedAt)) {
      setProjectId(String(s.projectId));
    }
    if (parseEuro(amount) <= 0) setAmount(shareFormatter.format(s.amount / 100));
  };

  /** Dialog öffnen/schließen — der Zähler gilt nur für einen Durchgang */
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setSavedCount(0);
    // Neu öffnen beginnt beim heutigen Datum — auch wenn der Dialog seit
    // gestern gemountet ist oder zuletzt ein Stapel rückdatiert wurde
    if (next && !isEdit) setDate(todayISO());
    // Duplizieren: jedes Öffnen beginnt wieder bei der Vorlage (nach dem
    // Speichern waren Betrag, Notiz usw. geleert)
    if (next && template && !isEdit) {
      setType(template.type);
      setAmount(shareFormatter.format(template.amount / 100));
      setAccountId(String(template.accountId));
      setToAccountId(template.toAccountId ? String(template.toAccountId) : '');
      setCategoryId(template.categoryId ? String(template.categoryId) : '');
      setUserId(String(template.userId));
      setProjectId(template.projectId ? String(template.projectId) : '');
      setNote(template.note);
      setSplitEnabled(template.splits.length > 0);
      setShares(Object.fromEntries(template.splits.map((s) => [s.userId, shareFormatter.format(s.amount / 100)])));
      setSelectedTagIds(template.tags.map((t) => t.id));
    }
  };

  /**
   * Speichern. Mit `keepOpen` (nur beim Anlegen) bleibt der Dialog offen:
   * Art, Datum, Konto, Person und Projekt bleiben stehen, Betrag, Notiz,
   * Kategorie, Aufteilung, Tags und Belege werden für die nächste Buchung
   * geleert — so lässt sich ein Stapel Belege in einem Zug nachtragen.
   */
  const submit = async (keepOpen = false) => {
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
        changeOpen(false);
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
      setAmount(''); setNote(''); setCategoryId(''); setSplitEnabled(false); setShares({});
      setSaveTplOpen(false); setSaveTplName('');
      setSelectedTagIds([]); setNewTagOpen(false); setNewTagName('');
      setFiles([]);
      if (keepOpen) {
        setSavedCount((n) => n + 1);
        amountInput.current?.focus();
        return;
      }
      changeOpen(false);
      setProjectId('');
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
    <Dialog open={open} onOpenChange={changeOpen}>
      {(trigger || !controlled) && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button title="Neue Buchung (Taste N)">
              <Plus className="mr-2 h-4 w-4" /> Neue Buchung
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        // Neue Buchung: gleich im Betragsfeld beginnen (Kürzel „n“)
        onOpenAutoFocus={(e) => {
          if (isEdit) return;
          e.preventDefault();
          amountInput.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(e) => {
          // Radix hört Escape schon in der Capture-Phase — bei offener
          // Vorschlagsliste schließt Escape nur die Liste, nicht den Dialog
          if ((e.target as HTMLElement | null)?.getAttribute?.('aria-expanded') === 'true') e.preventDefault();
        }}
        onKeyDown={(e) => {
          // ⌘/Strg+Enter speichert, mit Umschalt „Speichern & weitere“
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !saving) {
            e.preventDefault();
            void submit(e.shiftKey && !isEdit);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Buchung bearbeiten' : template ? 'Buchung duplizieren' : 'Neue Buchung'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Bestehende Buchung anpassen — jede Änderung wird protokolliert.'
              : savedCount > 0
                ? `${savedCount} ${savedCount === 1 ? 'Buchung' : 'Buchungen'} erfasst — Datum, Konto und Person bleiben für die nächste stehen.`
                : 'Einnahme, Ausgabe oder Umbuchung zwischen Konten erfassen.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <TypeSegment
            value={type}
            onChange={changeType}
            disabled={isEdit}
            disabledTitle="Die Buchungsart kann nicht geändert werden — bitte löschen und neu anlegen."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="amount">Betrag ({currencySymbol()})</Label>
              <Input
                ref={amountInput} id="amount" inputMode="decimal" placeholder={amountPlaceholder}
                value={amount} onChange={(e) => setAmount(e.target.value)}
                // Enter springt zur Beschreibung (⌘/Strg+Enter speichert weiterhin)
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    document.getElementById('note')?.focus();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Datum</Label>
              <DateField id="date" value={date} onChange={setDate} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Beschreibung</Label>
            {/* Vorschläge aus früheren Buchungen belegen Kategorie, Konto,
                Projekt und — bei leerem Feld — den Betrag vor */}
            <NoteSuggestInput
              id="note"
              type={type}
              placeholder="z. B. Wocheneinkauf Coop"
              value={note}
              onChange={setNote}
              onPick={applySuggestion}
            />
          </div>

          {isTransfer ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Von Konto</Label>
                <SearchableSelect
                  value={String(effectiveAccountId || '')}
                  onValueChange={setAccountId}
                  placeholder="Konto wählen"
                  options={sourceOptions}
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
                    .map((a) => ({
                      value: String(a.id),
                      label: `${accountLabel(a, banks)}${a.access === 'view' ? ' (nur lesend)' : ''}`,
                    }))}
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
                  options={sourceOptions}
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
                  // Die meistgenutzten der letzten 90 Tage oben (B3)
                  pinned={frequentCategories.map((c) => ({ value: String(c.id), label: c.name }))}
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
                    className="flex items-center gap-1 text-xs text-stamp hover:underline"
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
                        <Label className="text-xs" style={{ color: pencil(u.color) }}>{u.name} ({currencySymbol()})</Label>
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
                      className="flex items-center gap-1 text-xs text-stamp hover:underline"
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
                Details (Person, Projekt, Tags{isEdit ? ', Kommentar' : ''})
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                {isEdit && transaction.recurringId !== null && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning sm:col-span-2">
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
                {projects.length > 0 && (
                  <div className="space-y-2">
                    <Label>Projekt</Label>
                    {/* Sentinel „household" = laufender Haushalt (intern leerer String) */}
                    <SearchableSelect
                      value={projectId || 'household'}
                      onValueChange={(v) => setProjectId(v === 'household' ? '' : v)}
                      options={[
                        { value: 'household', label: 'Haushalt' },
                        // Abgeschlossene Projekte nur, wenn die Buchung schon dazugehört
                        ...projects
                          .filter((p) => !p.closedAt || String(p.id) === projectId)
                          .map((p) => ({ value: String(p.id), label: p.closedAt ? `${p.name} (abgeschlossen)` : p.name })),
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
                                ? 'border-transparent bg-stamp text-stamp-foreground'
                                : 'bg-muted/40 text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pencil(tag.color) }} />
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
                      className="flex items-center gap-1 text-xs text-stamp hover:underline"
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
          <Button variant="outline" onClick={() => changeOpen(false)}>
            {savedCount > 0 ? 'Fertig' : 'Abbrechen'}
          </Button>
          {!isEdit && (
            <Button
              variant="outline"
              onClick={() => void submit(true)}
              disabled={saving}
              title="Speichern und direkt die nächste Buchung erfassen (⌘/Strg+Umschalt+Enter)"
            >
              Speichern &amp; weitere
            </Button>
          )}
          <Button
            onClick={() => void submit()}
            disabled={saving}
            title="⌘/Strg+Enter"
          >
            {saving ? 'Speichern…' : isEdit ? 'Änderungen speichern' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
