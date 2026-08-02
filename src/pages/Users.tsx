import { useState } from 'react';
import { Copy, KeyRound, Plus, UserCheck, UserX } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/providers/auth';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const COLORS = ['#6366f1', '#f59e0b', '#f43f5e', '#0ea5e9', '#a855f7', '#14b8a6', '#10b981'];

export default function UsersPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const usersQuery = trpc.auth.listUsers.useQuery();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviteLink, setInviteLink] = useState('');

  const invalidate = () => usersQuery.refetch();

  const createUser = trpc.auth.createUser.useMutation({
    onSuccess: (res) => {
      setInviteLink(res.inviteLink);
      invalidate();
      utils.auth.listUsers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const deactivate = trpc.auth.deactivateUser.useMutation({
    onSuccess: () => { toast.success('Benutzer deaktiviert.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const reactivate = trpc.auth.reactivateUser.useMutation({
    onSuccess: () => { toast.success('Benutzer reaktiviert.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const resetPw = trpc.auth.resetUserPassword.useMutation({
    onSuccess: (res) => {
      navigator.clipboard.writeText(res.inviteLink);
      toast.success('Neuer Link erzeugt und kopiert.');
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim() || !email.trim()) { toast.error('Name und E-Mail angeben.'); return; }
    createUser.mutate({
      name: name.trim(), email: email.trim(), role,
      color: COLORS[(usersQuery.data?.length ?? 0) % COLORS.length],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Personen</h1>
          <p className="text-sm text-muted-foreground">
            {usersQuery.data?.length ?? 0} Benutzerkonten im Haushalt
          </p>
        </div>
        {user?.role === 'admin' && (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setInviteLink(''); setName(''); setEmail(''); } }}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" /> Person hinzufügen</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Neue Person einladen</DialogTitle>
                <DialogDescription>
                  Die Person erhält einen Link, über den sie ihr eigenes Passwort setzt.
                  Der Link erscheint zusätzlich im Server-Log.
                </DialogDescription>
              </DialogHeader>
              {inviteLink ? (
                <div className="space-y-3 py-2">
                  <p className="text-sm font-medium">Einladungslink (7 Tage gültig):</p>
                  <code className="block break-all rounded bg-muted px-3 py-2 text-xs">{inviteLink}</code>
                  <Button
                    variant="outline" className="w-full"
                    onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success('Link kopiert.'); }}
                  >
                    <Copy className="mr-2 h-4 w-4" /> Link kopieren
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 py-2">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sam" />
                  </div>
                  <div className="space-y-2">
                    <Label>E-Mail</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Rolle</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
                      <SelectTrigger
                        className="w-full min-w-0 [&>span]:truncate"
                        title={role === 'admin' ? 'Administrator' : 'Mitglied'}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Mitglied</SelectItem>
                        <SelectItem value="admin">Administrator</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <DialogFooter>
                {inviteLink ? (
                  <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setOpen(false)}>Fertig</Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={createUser.isPending}>
                      Einladung erzeugen
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(usersQuery.data ?? []).map((u) => (
          <Card key={u.id} className={!u.active ? 'opacity-60' : ''}>
            <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ backgroundColor: u.color }}>
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base" title={u.name}>{u.name}</CardTitle>
                  <CardDescription className="text-xs">{u.email}</CardDescription>
                </div>
              </div>
              <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className={u.role === 'admin' ? 'bg-emerald-600' : ''}>
                {u.role === 'admin' ? 'Admin' : 'Mitglied'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 text-xs">
                {!u.active && <Badge variant="destructive">Deaktiviert</Badge>}
                {!u.hasPassword && <Badge variant="outline">Passwort noch nicht gesetzt</Badge>}
                {u.id === user?.id && <Badge variant="secondary">Das bist du</Badge>}
              </div>
              {user?.role === 'admin' && u.id !== user.id && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => resetPw.mutate({ userId: u.id })}>
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Neuer Link
                  </Button>
                  {u.active ? (
                    <Button variant="outline" size="sm" onClick={() => deactivate.mutate({ userId: u.id })}>
                      <UserX className="mr-1.5 h-3.5 w-3.5" /> Deaktivieren
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => reactivate.mutate({ userId: u.id })}>
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Reaktivieren
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
