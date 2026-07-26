import { useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CURRENCIES, type CurrencyCode } from '@contracts/types';
import { useAuth } from '@/providers/auth';
import { useFinanceData, useInvalidateFinance } from '@/lib/data';
import { setAppCurrency } from '@/lib/finance';
import { trpc } from '@/providers/trpc';
import { toast } from 'sonner';

const CAT_COLORS = ['#f43f5e', '#f59e0b', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#94a3b8', '#10b981'];
const PROFILE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#f43f5e', '#0ea5e9', '#a855f7'];

export default function Settings() {
  const { user, refresh } = useAuth();
  const { categories } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'income' | 'expense'>('expense');
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [profileColor, setProfileColor] = useState(user?.color ?? '#10b981');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const appSettings = trpc.finance.getAppSettings.useQuery();
  // null = noch keine eigene Auswahl → Server-Wert verwenden (kein Effekt nötig)
  const [currencyChoice, setCurrencyChoice] = useState<CurrencyCode | null>(null);
  const currency = currencyChoice ?? appSettings.data?.currency ?? 'EUR';

  const createCategory = trpc.finance.createCategory.useMutation({
    onSuccess: () => { toast.success('Kategorie hinzugefügt.'); invalidate(); setCatName(''); },
    onError: (err) => toast.error(err.message),
  });
  const deleteCategory = trpc.finance.deleteCategory.useMutation({
    onSuccess: () => { toast.success('Kategorie gelöscht.'); invalidate(); },
  });
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => { toast.success('Profil gespeichert.'); refresh(); },
    onError: (err) => toast.error(err.message),
  });
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => { toast.success('Passwort geändert.'); setCurrentPw(''); setNewPw(''); },
    onError: (err) => toast.error(err.message),
  });
  const resetData = trpc.finance.resetFinanceData.useMutation({
    onSuccess: () => { toast.success('Alle Finanzdaten wurden gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const saveCurrency = trpc.finance.setCurrency.useMutation({
    onSuccess: (_data, vars) => {
      toast.success('Währung gespeichert.');
      setAppCurrency(vars.currency);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">Profil, Kategorien und Datenverwaltung</p>
      </div>

      <Card className="border-emerald-600/30 bg-emerald-600/5">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <span className="font-semibold">Datenschutz:</span> Alle Daten liegen in einer SQLite-Datenbank
            auf deinem eigenen Server — nichts verlässt dein Netz. Als Self-Hoster bist du selbst für
            Absicherung (HTTPS, Backups des <code className="rounded bg-muted px-1">data/</code>-Ordners) verantwortlich.
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mein Profil</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Anzeigename</Label>
              <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Farbe</Label>
              <div className="flex gap-2">
                {PROFILE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-8 w-8 rounded-full border-2 ${profileColor === c ? 'border-foreground' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setProfileColor(c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              disabled={updateProfile.isPending}
              onClick={() => updateProfile.mutate({ name: profileName, color: profileColor })}
            >
              Profil speichern
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Passwort ändern</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Aktuelles Passwort</Label>
              <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="space-y-2">
              <Label>Neues Passwort (min. 8 Zeichen)</Label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            </div>
            <Button
              variant="outline"
              disabled={changePassword.isPending || !currentPw || newPw.length < 8}
              onClick={() => changePassword.mutate({ currentPassword: currentPw, newPassword: newPw })}
            >
              Passwort ändern
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Währung</CardTitle>
          <CardDescription>
            Gilt für den gesamten Haushalt — alle Beträge in der App werden in dieser Währung angezeigt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select
            value={currency}
            onValueChange={(v) => setCurrencyChoice(v as CurrencyCode)}
            disabled={user?.role !== 'admin'}
          >
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {user?.role === 'admin' ? (
            <Button
              variant="outline"
              disabled={saveCurrency.isPending || currency === appSettings.data?.currency}
              onClick={() => saveCurrency.mutate({ currency })}
            >
              Währung speichern
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nur Administratoren können die Währung ändern.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kategorien</CardTitle>
          <CardDescription>{categories.length} Kategorien</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Badge key={c.id} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                <button
                  type="button"
                  className="ml-1 rounded-full p-0.5 hover:bg-muted"
                  onClick={() => deleteCategory.mutate({ id: c.id })}
                  title="Löschen"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="Neue Kategorie…" value={catName} onChange={(e) => setCatName(e.target.value)} />
            <Select value={catType} onValueChange={(v) => setCatType(v as 'income' | 'expense')}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Ausgabe</SelectItem>
                <SelectItem value="income">Einnahme</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                if (!catName.trim()) return;
                createCategory.mutate({
                  name: catName.trim(), type: catType,
                  color: CAT_COLORS[categories.length % CAT_COLORS.length],
                });
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datenverwaltung</CardTitle>
          <CardDescription>Alle Finanzdaten des Haushalts unwiderruflich löschen (Benutzerkonten bleiben bestehen).</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Alle Finanzdaten löschen</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Wirklich alles löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Konten, Buchungen, Budgets, Dauerbuchungen, Kategorien und Sparziele werden
                  unwiderruflich gelöscht. Sichere vorher den <code>data/</code>-Ordner auf dem Server,
                  falls du ein Backup brauchst.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetData.mutate()}>
                  Endgültig löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
