import { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

export default function Login() {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);
  // Zweiter Schritt bei aktiviertem TOTP: Token aus dem Passwort-Schritt
  const [totpToken, setTotpToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data.requiresTotp) {
        setTotpToken(data.totpToken);
        setPassword('');
        setTotpCode('');
      } else {
        utils.invalidate();
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const verifyTotp = trpc.auth.verifyTotpLogin.useMutation({
    onSuccess: () => utils.invalidate(),
    // Der Login-Token ist einmalig — bei jedem Fehler zurück zum Passwort
    onError: (err) => {
      toast.error(err.message);
      setTotpToken(null);
      setTotpCode('');
    },
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
    if (totpToken) {
      verifyTotp.mutate({ token: totpToken, code: totpCode });
    } else if (resetMode) {
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
          <CardTitle>Finance Fox</CardTitle>
          <CardDescription>
            {totpToken
              ? 'Gib den 6-stelligen Code aus deiner Authenticator-App ein'
              : resetMode
                ? 'Reset-Link anfordern (erscheint im Server-Log)'
                : 'Am gemeinsamen Haushalt anmelden'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {totpToken ? (
              <div className="space-y-2">
                <Label>Einmal-Code</Label>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    inputMode="numeric"
                    autoFocus
                    value={totpCode}
                    onChange={setTotpCode}
                  >
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={
                login.isPending || requestReset.isPending || verifyTotp.isPending ||
                (totpToken !== null && totpCode.length !== 6)
              }
            >
              {totpToken ? 'Code prüfen' : resetMode ? 'Reset-Link anfordern' : 'Anmelden'}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => (totpToken ? setTotpToken(null) : setResetMode((v) => !v))}
            >
              {totpToken ? 'Zurück zur Anmeldung' : resetMode ? 'Zurück zur Anmeldung' : 'Passwort vergessen?'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
