import { useState } from 'react';
import { CheckCircle2, Copy, PiggyBank, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

interface InvitedUser {
  id: number;
  name: string;
  email: string;
  inviteLink: string;
}

const COLORS = ['#6366f1', '#f59e0b', '#f43f5e', '#0ea5e9', '#a855f7', '#14b8a6'];

/** Ersteinrichtungs-Wizard: Admin anlegen → weitere Personen einladen → ggf. lokale Daten importieren */
export default function Setup() {
  const utils = trpc.useUtils();
  const [step, setStep] = useState(0);

  // Schritt 1: Admin
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  // Schritt 2: weitere Personen
  const [invited, setInvited] = useState<InvitedUser[]>([]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Schritt 3: Import lokaler Daten
  const [localData, setLocalData] = useState<Record<string, unknown> | null>(null);
  const [memberMap, setMemberMap] = useState<Record<string, number>>({});
  const [importDone, setImportDone] = useState(false);

  const setup = trpc.auth.setup.useMutation({
    onSuccess: () => {
      toast.success('Administratorkonto angelegt.');
      utils.auth.me.invalidate();
      setStep(1);
    },
    onError: (err) => toast.error(err.message),
  });

  const createUser = trpc.auth.createUser.useMutation({
    onSuccess: (res, vars) => {
      setInvited((prev) => [...prev, { id: res.id, name: vars.name, email: vars.email, inviteLink: res.inviteLink }]);
      setNewName(''); setNewEmail('');
      toast.success('Einladungslink erzeugt.');
    },
    onError: (err) => toast.error(err.message),
  });

  const importLocal = trpc.finance.importLocalFull.useMutation({
    onSuccess: () => { setImportDone(true); toast.success('Lokale Daten wurden übernommen.'); },
    onError: (err) => toast.error(err.message),
  });

  const localMembers = (localData?.members as { id: string; name: string }[] | undefined) ?? [];

  const readLocalData = () => {
    try {
      const raw = localStorage.getItem('haushaltsfinanzen-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (Array.isArray(parsed.transactions)) {
          setLocalData(parsed);
          return;
        }
      }
      toast.info('Keine lokalen Daten aus der bisherigen App-Version gefunden.');
    } catch {
      toast.error('Lokale Daten konnten nicht gelesen werden.');
    }
  };

  const finish = () => {
    utils.invalidate();
    window.location.hash = '#/';
    window.location.reload();
  };

  const doImport = () => {
    if (!localData) return;
    importLocal.mutate({
      accounts: (localData.accounts as { id: string; name: string; type: 'checking' | 'cash' | 'savings'; initialBalance: number }[])
        .map((acc) => ({ oldId: acc.id, name: acc.name, type: acc.type, initialBalance: acc.initialBalance })),
      categories: (localData.categories as { id: string; name: string; type: 'income' | 'expense'; color: string }[])
        .map((cat) => ({ oldId: cat.id, name: cat.name, type: cat.type, color: cat.color })),
      transactions: localData.transactions as never,
      budgets: localData.budgets as never,
      recurring: localData.recurring as never,
      goals: localData.goals as never,
      memberMap,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <PiggyBank className="h-6 w-6" />
          </div>
          <CardTitle>Einrichtung</CardTitle>
          <CardDescription>
            Schritt {step + 1} von 3 — {['Administratorkonto', 'Personen einladen', 'Datenübernahme'][step]}
          </CardDescription>
          <div className="flex gap-1.5 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-1.5 w-16 rounded-full ${i <= step ? 'bg-emerald-600' : 'bg-muted'}`} />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (password !== password2) { toast.error('Passwörter stimmen nicht überein.'); return; }
                setup.mutate({ name, email, password });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Dein Name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Alex" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pw">Passwort</Label>
                  <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw2">Wiederholen</Label>
                  <Input id="pw2" type="password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={setup.isPending}>
                Konto anlegen & weiter
              </Button>
            </form>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Lade weitere Haushaltsmitglieder ein. Jede Person erhält einen Link,
                über den sie ihr eigenes Passwort setzt. (Der Link erscheint auch im Server-Log.)
              </p>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input placeholder="E-Mail" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                <Button
                  variant="outline" size="icon"
                  disabled={!newName.trim() || !newEmail.trim() || createUser.isPending}
                  onClick={() => createUser.mutate({
                    name: newName.trim(), email: newEmail.trim(),
                    role: 'member', color: COLORS[invited.length % COLORS.length],
                  })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {invited.map((u) => (
                <div key={u.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{u.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{u.email}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost" size="icon" title="Link kopieren"
                        onClick={() => { navigator.clipboard.writeText(u.inviteLink); toast.success('Link kopiert.'); }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setInvited((p) => p.filter((x) => x.id !== u.id))}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  <code className="mt-2 block break-all rounded bg-muted px-2 py-1 text-[11px]">{u.inviteLink}</code>
                </div>
              ))}
              <div className="flex justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Überspringen</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setStep(2)}>
                  <Users className="mr-2 h-4 w-4" /> Weiter
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {!localData && !importDone && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Auf diesem Gerät wurden möglicherweise Daten aus der bisherigen
                    lokalen App-Version gefunden. Du kannst sie in die Datenbank übernehmen.
                  </p>
                  <Button variant="outline" className="w-full" onClick={readLocalData}>
                    Lokale Daten suchen
                  </Button>
                </>
              )}
              {localData && !importDone && (
                <>
                  <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
                    <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                    {(localData.transactions as unknown[]).length} Buchungen,{' '}
                    {(localData.accounts as unknown[]).length} Konten gefunden.
                  </div>
                  {localMembers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Personen zuordnen:</p>
                      {localMembers.map((m) => (
                        <LocalMemberAssign
                          key={m.id}
                          localName={m.name}
                          invited={invited}
                          value={memberMap[m.id]}
                          onChange={(uid) => setMemberMap((prev) => ({ ...prev, [m.id]: uid }))}
                        />
                      ))}
                    </div>
                  )}
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    disabled={importLocal.isPending || localMembers.some((m) => !memberMap[m.id])}
                    onClick={doImport}
                  >
                    Daten übernehmen
                  </Button>
                </>
              )}
              {importDone && (
                <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                  Import abgeschlossen.
                </div>
              )}
              <Separator />
              <Button className="w-full" variant={importDone ? 'default' : 'outline'} onClick={finish}>
                Einrichtung abschließen
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Badge variant="secondary">Tipp</Badge> Personen und Daten kannst du später jederzeit in den Einstellungen verwalten.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LocalMemberAssign({
  localName, invited, value, onChange,
}: {
  localName: string;
  invited: InvitedUser[];
  value: number | undefined;
  onChange: (uid: number) => void;
}) {
  const { data: users } = trpc.auth.listUsers.useQuery();
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-sm">„{localName}“ (lokal) →</span>
      <select
        className="rounded-md border bg-background px-2 py-1 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="" disabled>Benutzer wählen…</option>
        {(users ?? []).map((u) => (
          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
        ))}
        {invited.filter((i) => !(users ?? []).some((u) => u.id === i.id)).map((u) => (
          <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
        ))}
      </select>
    </div>
  );
}
