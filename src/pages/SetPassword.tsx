import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

/** Passwort setzen über Einladungs- oder Reset-Link (#/einladung/:token bzw. #/reset/:token) */
export default function SetPassword({ purpose }: { purpose: 'invite' | 'reset' }) {
  const token = window.location.hash.split('/').pop() ?? '';
  const utils = trpc.useUtils();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  const info = trpc.auth.tokenInfo.useQuery({ token, purpose }, { retry: false });
  const setPw = trpc.auth.setPassword.useMutation({
    onSuccess: () => {
      toast.success('Passwort gespeichert — willkommen!');
      utils.invalidate();
      window.location.hash = '#/';
      window.location.reload();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle>{purpose === 'invite' ? 'Willkommen im Haushalt' : 'Passwort zurücksetzen'}</CardTitle>
          <CardDescription>
            {info.data
              ? `${purpose === 'invite' ? 'Lege dein Passwort fest' : 'Neues Passwort'} für ${info.data.name} (${info.data.email})`
              : info.isLoading ? 'Link wird geprüft…' : 'Dieser Link ist ungültig oder abgelaufen.'}
          </CardDescription>
        </CardHeader>
        {info.data && (
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (password !== password2) { toast.error('Passwörter stimmen nicht überein.'); return; }
                setPw.mutate({ token, purpose, password });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="pw">Neues Passwort</Label>
                <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Wiederholen</Label>
                <Input id="pw2" type="password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </div>
              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={setPw.isPending}>
                Passwort speichern
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
