import { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

export default function Login() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);

  const login = trpc.auth.login.useMutation({
    onSuccess: () => utils.invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const requestReset = trpc.auth.requestReset.useMutation({
    onSuccess: () => {
      toast.success('Falls ein Konto existiert, wurde ein Reset-Link im Server-Log erzeugt.');
      setResetMode(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resetMode) {
      requestReset.mutate({ email });
    } else {
      login.mutate({ email, password });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <PiggyBank className="h-6 w-6" />
          </div>
          <CardTitle>Haushaltsfinanzen</CardTitle>
          <CardDescription>
            {resetMode ? 'Reset-Link anfordern (erscheint im Server-Log)' : 'Am gemeinsamen Haushalt anmelden'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {!resetMode && (
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={login.isPending || requestReset.isPending}
            >
              {resetMode ? 'Reset-Link anfordern' : 'Anmelden'}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setResetMode((v) => !v)}
            >
              {resetMode ? 'Zurück zur Anmeldung' : 'Passwort vergessen?'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
