import { useRef, useState } from 'react';
import { DatabaseBackup, Plus, ShieldCheck, Trash2, Upload } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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
  const { categories, accountTypes, banks } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'income' | 'expense'>('expense');
  // '' = neue Oberkategorie, sonst ID der Oberkategorie für eine Unterkategorie
  const [catParent, setCatParent] = useState('');
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [profileColor, setProfileColor] = useState(user?.color ?? '#10b981');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const appSettings = trpc.finance.getAppSettings.useQuery();
  // null = noch keine eigene Auswahl → Server-Wert verwenden (kein Effekt nötig)
  const [currencyChoice, setCurrencyChoice] = useState<CurrencyCode | null>(null);
  const currency = currencyChoice ?? appSettings.data?.currency ?? 'EUR';

  // Kategorien-Baum: Oberkategorien (parentId null) und deren Unterkategorien
  const catRoots = categories.filter((c) => c.parentId === null);
  const catChildrenOf = (id: number) => categories.filter((c) => c.parentId === id);

  const createCategory = trpc.finance.createCategory.useMutation({
    onSuccess: () => { toast.success('Kategorie hinzugefügt.'); invalidate(); setCatName(''); setCatParent(''); },
    onError: (err) => toast.error(err.message),
  });
  const deleteCategory = trpc.finance.deleteCategory.useMutation({
    onSuccess: () => { toast.success('Kategorie gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteAccountType = trpc.finance.deleteAccountType.useMutation({
    onSuccess: () => { toast.success('Kontotyp gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const deleteBank = trpc.finance.deleteBank.useMutation({
    onSuccess: () => { toast.success('Bank gelöscht.'); invalidate(); },
    onError: (err) => toast.error(err.message),
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

  // Benachrichtigungen (nur Admins): null = noch nicht angefasst → Server-Wert
  const notifySettings = trpc.finance.getNotifySettings.useQuery(undefined, {
    enabled: user?.role === 'admin',
  });
  const [ntfyUrl, setNtfyUrl] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [notifyEvents, setNotifyEvents] = useState<{ budget: boolean; recurring: boolean; goal: boolean } | null>(null);
  const ntfy = ntfyUrl ?? notifySettings.data?.ntfyUrl ?? '';
  const webhook = webhookUrl ?? notifySettings.data?.webhookUrl ?? '';
  const events = notifyEvents ?? notifySettings.data?.events ?? { budget: true, recurring: true, goal: true };
  const saveNotify = trpc.finance.setNotifySettings.useMutation({
    onSuccess: () => { toast.success('Benachrichtigungen gespeichert.'); invalidate(); notifySettings.refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const testNotify = trpc.finance.sendTestNotification.useMutation({
    onSuccess: (data) => toast.success(`Testbenachrichtigung gesendet über: ${data.sent.join(', ')}.`),
    onError: (err) => toast.error(err.message),
  });

  // Datensicherung (nur Admins, siehe unten)
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  /** SQLite-Datenbank vom Server laden und als Datei herunterladen */
  const downloadBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch('/api/backup', { credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Backup fehlgeschlagen (Status ${res.status}).`);
      }
      const blob = await res.blob();
      const match = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] ?? 'finance-fox-backup.db';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup fehlgeschlagen.');
    } finally {
      setBackupLoading(false);
    }
  };

  /** Backup-Datei an den Server schicken — ersetzt die komplette Datenbank */
  const restoreBackup = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        credentials: 'same-origin',
        body: restoreFile,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Wiederherstellung fehlgeschlagen (Status ${res.status}).`);
      }
      toast.success('Backup wiederhergestellt — die Seite wird neu geladen.');
      // Alle Daten haben sich geändert: kompletter Neustart der App
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Wiederherstellung fehlgeschlagen.');
      setRestoring(false);
    }
  };

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

      {user?.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Benachrichtigungen</CardTitle>
            <CardDescription>
              Optional (opt-in): Finance Fox kann Ereignisse an einen selbstgehosteten
              ntfy-Server (volle Topic-URL, z.&nbsp;B. <code>https://ntfy.sh/mein-haushalt</code>)
              und/oder einen generischen Webhook (JSON per POST) melden. Ohne URL bleibt alles lokal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>ntfy-Topic-URL</Label>
                <Input
                  placeholder="https://ntfy.sh/mein-haushalt"
                  value={ntfy}
                  onChange={(e) => setNtfyUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Webhook-URL</Label>
                <Input
                  placeholder="https://example.org/hook"
                  value={webhook}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Benachrichtigen bei</Label>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {([
                  ['budget', 'Budget-Überschreitung'],
                  ['recurring', 'Wiederkehrende Buchungen'],
                  ['goal', 'Sparziel-Meilensteine'],
                ] as const).map(([key, label]) => (
                  <span key={key} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={events[key]}
                      onCheckedChange={(checked) => setNotifyEvents({ ...events, [key]: checked })}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={saveNotify.isPending}
                onClick={() => saveNotify.mutate({ ntfyUrl: ntfy, webhookUrl: webhook, events })}
              >
                Benachrichtigungen speichern
              </Button>
              <Button
                variant="outline"
                disabled={testNotify.isPending}
                onClick={() => testNotify.mutate()}
              >
                {testNotify.isPending ? 'Sende…' : 'Testbenachrichtigung senden'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Kategorien</CardTitle>
          <CardDescription>{categories.length} Kategorien</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Baum-Ansicht: Oberkategorien mit eingerückten Unterkategorien */}
          <div className="space-y-1.5">
            {catRoots.map((root) => (
              <div key={root.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: root.color }} />
                  {root.name}
                  <button
                    type="button"
                    className="ml-1 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => deleteCategory.mutate({ id: root.id })}
                    title="Löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
                {catChildrenOf(root.id).map((child) => (
                  <Badge key={child.id} variant="secondary" className="ml-4 gap-1.5 py-1 pl-2 pr-1">
                    <span className="text-muted-foreground">└</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: child.color }} />
                    {child.name}
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                      onClick={() => deleteCategory.mutate({ id: child.id })}
                      title="Löschen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-40 flex-1" placeholder="Neue Kategorie…" value={catName} onChange={(e) => setCatName(e.target.value)} />
            <Select
              value={catParent || 'none'}
              onValueChange={(v) => {
                const parentId = v === 'none' ? '' : v;
                setCatParent(parentId);
                // Unterkategorien erben den Typ der Oberkategorie
                const parent = catRoots.find((c) => String(c.id) === parentId);
                if (parent) setCatType(parent.type);
              }}
            >
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Oberkategorie</SelectItem>
                {catRoots.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>Unter: {c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={catType} onValueChange={(v) => setCatType(v as 'income' | 'expense')} disabled={catParent !== ''}>
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
                // Unterkategorien erben Farbe (und Typ) der Oberkategorie —
                // die Palette wird nur für Oberkategorien automatisch vergeben
                const parent = catRoots.find((c) => String(c.id) === catParent);
                createCategory.mutate({
                  name: catName.trim(), type: catType,
                  color: parent?.color ?? CAT_COLORS[categories.length % CAT_COLORS.length],
                  parentId: parent?.id,
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
          <CardTitle>Kontotypen &amp; Banken</CardTitle>
          <CardDescription>
            Neue Typen und Banken legst du direkt im Konto-Dialog an (über „+ Neuer Typ“ bzw. „+ Neue Bank“).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Kontotypen</p>
            <div className="flex flex-wrap gap-2">
              {accountTypes.map((t) => (
                <Badge key={t.id} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                  {t.name}
                  {t.builtin && <Badge variant="outline" className="ml-1 text-[10px]">Standard</Badge>}
                  {!t.builtin && (
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                      onClick={() => deleteAccountType.mutate({ id: t.id })}
                      title="Löschen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Banken</p>
            {banks.length === 0 && (
              <p className="text-sm text-muted-foreground">Noch keine Banken angelegt.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {banks.map((b) => (
                <Badge key={b.id} variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                  {b.name}
                  <button
                    type="button"
                    className="ml-1 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => deleteBank.mutate({ id: b.id })}
                    title="Löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {user?.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Datensicherung</CardTitle>
            <CardDescription>
              Komplette Datenbank als Datei sichern oder aus einer Sicherung wiederherstellen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={downloadBackup} disabled={backupLoading}>
                <DatabaseBackup className="mr-2 h-4 w-4" />
                {backupLoading ? 'Lade herunter…' : 'Backup herunterladen'}
              </Button>
              <p className="text-sm text-muted-foreground">
                Lädt die komplette SQLite-Datenbank als <code>.db</code>-Datei herunter.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
              <p className="text-sm font-semibold text-destructive">Backup wiederherstellen</p>
              <p className="text-xs text-muted-foreground">
                Ersetzt die komplette Datenbank auf dem Server durch die hochgeladene Datei.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  ref={restoreInputRef}
                  type="file"
                  accept=".db,application/octet-stream"
                  className="max-w-xs"
                  onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant="destructive"
                  disabled={!restoreFile || restoring}
                  onClick={() => setRestoreOpen(true)}
                >
                  <Upload className="mr-2 h-4 w-4" /> Wiederherstellen
                </Button>
              </div>
            </div>
          </CardContent>
          <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Backup wirklich wiederherstellen?</AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-semibold">{restoreFile?.name}</span> wird auf den Server
                  geladen und ersetzt <span className="font-semibold">ALLE aktuellen Daten</span> —
                  Konten, Buchungen, Budgets, Kategorien, Sparziele und Benutzer. Dieser Schritt
                  kann nicht rückgängig gemacht werden. Lade vorher ein aktuelles Backup herunter.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={restoring}>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={restoreBackup} disabled={restoring}>
                  {restoring ? 'Stelle wieder her…' : 'Endgültig wiederherstellen'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      )}

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
