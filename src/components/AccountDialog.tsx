import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { useAuth } from '@/providers/auth';
import { amountPlaceholder, currencySymbol, parseEuro } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Konto, wie es finance.listAccounts liefert (nur die hier benötigten Felder) */
export interface DialogAccount {
  id: number;
  name: string;
  type: string; // Key aus account_types
  initialBalance: number;
  bankId: number | null;
  iban: string | null;
  ownerId: number | null;
  access: 'view' | 'edit';
  isOwner: boolean;
}

/** Dialog zum Anlegen (ohne `account`) und Bearbeiten (mit `account`) eines Kontos */
export default function AccountDialog({ account, trigger }: { account?: DialogAccount; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && <AccountDialogForm account={account} close={() => setOpen(false)} />}
    </Dialog>
  );
}

/** Formular-Inhalt; wird bei jedem Öffnen neu gemountet, damit die Initialwerte stimmen */
function AccountDialogForm({ account, close }: { account?: DialogAccount; close: () => void }) {
  const { user } = useAuth();
  const { users, accountTypes, banks } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const utils = trpc.useUtils();
  const isEdit = !!account;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<string>(account?.type ?? 'checking');
  const [balance, setBalance] = useState(
    account ? (account.initialBalance / 100).toFixed(2).replace('.', ',') : '',
  );
  const [bankId, setBankId] = useState<number | null>(account?.bankId ?? null);
  const [iban, setIban] = useState(account?.iban ?? '');
  const [isPrivate, setIsPrivate] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  // Inline-Bereiche für "+ Neuer Typ" / "+ Neue Bank"
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [newBankOpen, setNewBankOpen] = useState(false);
  const [newBankName, setNewBankName] = useState('');

  const isPrivateAccount = !!account && account.ownerId !== null;

  // Freigaben nur laden, wenn der Besitzer ein privates Konto bearbeitet
  const permissions = trpc.finance.listAccountPermissions.useQuery(
    { accountId: account?.id ?? 0 },
    { enabled: !!account && account.isOwner && isPrivateAccount },
  );

  const createAccount = trpc.finance.createAccount.useMutation({
    onSuccess: () => { toast.success('Konto angelegt.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const updateAccount = trpc.finance.updateAccount.useMutation({
    onSuccess: () => { toast.success('Konto gespeichert.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const setPrivacy = trpc.finance.setAccountPrivacy.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(vars.private ? 'Konto ist jetzt privat.' : 'Konto ist jetzt ein Gemeinschaftskonto.');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const setPermission = trpc.finance.setAccountPermission.useMutation({
    onSuccess: () => {
      toast.success('Freigabe gespeichert.');
      utils.finance.listAccountPermissions.invalidate({ accountId: account?.id ?? 0 });
      utils.finance.listAccounts.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteAccount = trpc.finance.deleteAccount.useMutation({
    onSuccess: () => { toast.success('Konto und zugehörige Buchungen gelöscht.'); invalidate(); close(); },
    onError: (err) => toast.error(err.message),
  });
  const createAccountType = trpc.finance.createAccountType.useMutation({
    onSuccess: (created) => {
      toast.success('Kontotyp angelegt.');
      utils.finance.listAccountTypes.invalidate();
      setType(created.key); // neuen Typ direkt auswählen
      setNewTypeName('');
      setNewTypeOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const createBank = trpc.finance.createBank.useMutation({
    onSuccess: (created) => {
      toast.success('Bank angelegt.');
      utils.finance.listBanks.invalidate();
      setBankId(created.id); // neue Bank direkt auswählen
      setNewBankName('');
      setNewBankOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  // Andere aktive Mitglieder (Besitzer und man selbst ausgeklammert)
  const members = users.filter((u) => u.active && u.id !== account?.ownerId && u.id !== user?.id);

  const permLevel = (userId: number): 'none' | 'view' | 'edit' => {
    const p = permissions.data?.find((row) => row.userId === userId);
    if (!p) return 'none';
    return p.canEdit ? 'edit' : 'view';
  };

  const submit = () => {
    if (!name.trim()) { toast.error('Bitte einen Namen eingeben.'); return; }
    if (isEdit && account) {
      updateAccount.mutate({
        id: account.id, name: name.trim(), type, initialBalance: parseEuro(balance),
        bankId, iban: iban.trim(),
      });
    } else {
      createAccount.mutate({
        name: name.trim(), type, initialBalance: parseEuro(balance),
        bankId, iban: iban.trim(), private: isPrivate,
      });
    }
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Konto bearbeiten' : 'Neues Konto'}</DialogTitle>
        <DialogDescription>
          {isEdit ? 'Name, Typ, Bank und Anfangsbestand anpassen.' : 'Lege ein Konto für Einnahmen und Ausgaben an.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input placeholder="z. B. Gemeinschaftskonto" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Typ</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {accountTypes.map((t) => (
                  <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {newTypeOpen ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="z. B. Säule 3a"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!newTypeName.trim() || createAccountType.isPending}
                  onClick={() => createAccountType.mutate({ name: newTypeName.trim() })}
                >
                  Anlegen
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                onClick={() => setNewTypeOpen(true)}
              >
                <Plus className="h-3 w-3" /> Neuer Typ
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label>Anfangsbestand ({currencySymbol()})</Label>
            <Input inputMode="decimal" placeholder={amountPlaceholder} value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Bank (optional)</Label>
            <Select
              value={bankId === null ? 'none' : String(bankId)}
              onValueChange={(v) => setBankId(v === 'none' ? null : Number(v))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Keine Bank</SelectItem>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {newBankOpen ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="z. B. Postfinance"
                  value={newBankName}
                  onChange={(e) => setNewBankName(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!newBankName.trim() || createBank.isPending}
                  onClick={() => createBank.mutate({ name: newBankName.trim() })}
                >
                  Anlegen
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                onClick={() => setNewBankOpen(true)}
              >
                <Plus className="h-3 w-3" /> Neue Bank
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label>IBAN (optional)</Label>
            <Input
              placeholder="CH93 0076 2011 6238 5295 7"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
            />
          </div>
        </div>

        {!isEdit && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="private"
              checked={isPrivate}
              onCheckedChange={(checked) => setIsPrivate(checked === true)}
            />
            <Label htmlFor="private" className="cursor-pointer">Privates Konto (nur für mich sichtbar)</Label>
          </div>
        )}

        {isEdit && account.isOwner && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="privacy" className="cursor-pointer">Privates Konto</Label>
                <p className="text-xs text-muted-foreground">
                  Nur du (und freigegebene Mitglieder) sehen dieses Konto.
                </p>
              </div>
              <Switch
                id="privacy"
                checked={isPrivateAccount}
                disabled={setPrivacy.isPending}
                onCheckedChange={(checked) => setPrivacy.mutate({ id: account.id, private: checked })}
              />
            </div>
            {isPrivateAccount && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Zugriff für andere Mitglieder</p>
                {members.length === 0 && (
                  <p className="text-xs text-muted-foreground">Keine weiteren aktiven Mitglieder im Haushalt.</p>
                )}
                {members.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm" style={{ color: u.color }}>{u.name}</span>
                    <Select
                      value={permLevel(u.id)}
                      disabled={setPermission.isPending}
                      onValueChange={(v) =>
                        setPermission.mutate({ accountId: account.id, userId: u.id, level: v as 'none' | 'view' | 'edit' })}
                    >
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Kein Zugriff</SelectItem>
                        <SelectItem value="view">Ansehen</SelectItem>
                        <SelectItem value="edit">Ansehen &amp; Bearbeiten</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isEdit && (
          <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm font-semibold text-destructive">Gefahrenzone</p>
            <p className="text-xs text-muted-foreground">
              Das Konto und alle zugehörigen Buchungen werden unwiderruflich gelöscht.
              Gib zur Bestätigung den exakten Kontonamen ein: <span className="font-medium">{account.name}</span>
            </p>
            <Input
              placeholder={account.name}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
            <Button
              variant="destructive"
              disabled={confirmName !== account.name || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate({ id: account.id, name: confirmName })}
            >
              Konto endgültig löschen
            </Button>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>Abbrechen</Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={createAccount.isPending || updateAccount.isPending}
        >
          {isEdit ? 'Speichern' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
