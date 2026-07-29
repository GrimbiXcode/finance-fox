import { useRef, useState } from "react";
import QRCode from "qrcode";
import {
  DatabaseBackup,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Switch } from "@/components/ui/switch";
import { CURRENCIES, type CurrencyCode } from "@contracts/types";
import { useAuth } from "@/providers/auth";
import { useFinanceData, useInvalidateFinance } from "@/lib/data";
import { setAppCurrency, getUserLocale } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

const CAT_COLORS = [
  "#f43f5e",
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#94a3b8",
  "#10b981",
];
const PROFILE_COLORS = [
  "#10b981",
  "#6366f1",
  "#f59e0b",
  "#f43f5e",
  "#0ea5e9",
  "#a855f7",
];

// Deutsche Beschreibungen der Audit-Log-Aktionen (Fallback: roher action-Key)
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "account.created": "Konto angelegt",
  "account.updated": "Konto bearbeitet",
  "account.deleted": "Konto gelöscht",
  "account.privacy": "Konto-Sichtbarkeit geändert",
  "account.permission": "Konto-Freigabe geändert",
  "account.reconciled": "Kontoabgleich gebucht",
  "category.created": "Kategorie angelegt",
  "category.updated": "Kategorie bearbeitet",
  "category.deleted": "Kategorie gelöscht",
  "transaction.created": "Buchung erfasst",
  "transaction.updated": "Buchung bearbeitet",
  "transaction.deleted": "Buchung gelöscht",
  "transaction.imported": "Buchungen importiert",
  "transaction.tags": "Tags einer Buchung geändert",
  "tag.created": "Tag angelegt",
  "tag.deleted": "Tag gelöscht",
  "budget.saved": "Budget gespeichert",
  "budget.deleted": "Budget gelöscht",
  "recurring.created": "Dauerbuchung angelegt",
  "recurring.updated": "Dauerbuchung bearbeitet",
  "recurring.toggled": "Dauerbuchung umgeschaltet",
  "recurring.deleted": "Dauerbuchung gelöscht",
  "goal.created": "Sparziel angelegt",
  "goal.updated": "Sparziel-Stand geändert",
  "goal.deleted": "Sparziel gelöscht",
  "goal.contribution.added": "Sparziel-Beitrag hinzugefügt",
  "goal.contribution.deleted": "Sparziel-Beitrag gelöscht",
  "goal.sourceAdded": "Sparziel mit Konto verknüpft",
  "goal.sourceDeleted": "Sparziel-Verknüpfung gelöst",
  "project.created": "Projekt angelegt",
  "project.deleted": "Projekt gelöscht",
  "splitTemplate.created": "Aufteilungsvorlage angelegt",
  "splitTemplate.deleted": "Aufteilungsvorlage gelöscht",
  "data.imported": "Daten importiert",
  "data.reset": "Finanzdaten zurückgesetzt",
  "settings.currency": "Währung geändert",
  "settings.notify": "Benachrichtigungen geändert",
  "auth.login": "Angemeldet",
  "auth.login.failed": "Anmeldung fehlgeschlagen",
  "auth.logout": "Abgemeldet",
  "user.created": "Benutzer angelegt",
  "user.deactivated": "Benutzer deaktiviert",
  "user.reactivated": "Benutzer reaktiviert",
  "user.updated": "Profil geändert",
  "user.passwordChanged": "Passwort geändert",
  "user.totp.enabled": "2FA aktiviert",
  "user.totp.disabled": "2FA deaktiviert",
};

// Entity-Gruppen für den Filter in der Aktivitäten-Card
const AUDIT_ENTITY_GROUPS: [string, string, string[]][] = [
  ["account", "Konten", ["account"]],
  ["transaction", "Buchungen", ["transaction"]],
  ["category", "Kategorien", ["category"]],
  ["tag", "Tags", ["tag"]],
  ["budget", "Budgets", ["budget"]],
  ["recurring", "Dauerbuchungen", ["recurring"]],
  ["goal", "Sparziele", ["goal"]],
  ["project", "Projekte", ["project", "splitTemplate"]],
  ["user", "Benutzer", ["user", "auth"]],
  ["settings", "Einstellungen", ["settings", "data"]],
];

/** Kategorie, wie sie finance.listCategories liefert (nur die benötigten Felder) */
type EditCategory = {
  id: number;
  name: string;
  type: "income" | "expense";
  color: string;
  parentId: number | null;
};

/**
 * Kleiner Dialog zum Bearbeiten einer Kategorie: Name, Farbe und Einordnung
 * (Ober-/Unterkategorie). Der Typ ist unveränderlich und wird nur angezeigt.
 */
function CategoryEditDialog({
  cat,
  roots,
  hasChildren,
  onClose,
}: {
  cat: EditCategory;
  /** Mögliche Oberkategorien: Oberkategorien desselben Typs ohne die Kategorie selbst */
  roots: { id: number; name: string }[];
  /** Oberkategorien mit Unterkategorien können nicht verschoben werden */
  hasChildren: boolean;
  onClose: () => void;
}) {
  const invalidate = useInvalidateFinance();
  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);
  // "" = Oberkategorie, sonst ID der gewählten Oberkategorie
  const [parent, setParent] = useState(cat.parentId ? String(cat.parentId) : "");

  const updateCategory = trpc.finance.updateCategory.useMutation({
    onSuccess: () => {
      toast.success("Kategorie gespeichert.");
      invalidate();
      onClose();
    },
    onError: err => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Bitte einen Namen eingeben.");
      return;
    }
    updateCategory.mutate({
      id: cat.id,
      name: name.trim(),
      color,
      // undefined = Einordnung unverändert, null = zur Oberkategorie machen
      parentId:
        parent === ""
          ? cat.parentId === null
            ? undefined
            : null
          : Number(parent),
    });
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Kategorie bearbeiten</DialogTitle>
        <DialogDescription>
          Name, Farbe und Einordnung anpassen — der Typ (
          {cat.type === "expense" ? "Ausgabe" : "Einnahme"}) bleibt unverändert.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Farbe</Label>
          <div className="flex items-center gap-1.5">
            {CAT_COLORS.map(c => (
              <button
                key={c}
                type="button"
                title={c}
                disabled={parent !== ""}
                onClick={() => setColor(c)}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform disabled:opacity-40",
                  color === c
                    ? "scale-110 border-foreground"
                    : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {parent !== "" && (
            <p className="text-xs text-muted-foreground">
              Unterkategorien übernehmen die Farbe der Oberkategorie.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Oberkategorie</Label>
          {/* Sentinel „none" = Oberkategorie bleiben/werden (intern leerer String) */}
          <SearchableSelect
            value={parent || "none"}
            onValueChange={v => setParent(v === "none" ? "" : v)}
            disabled={hasChildren}
            options={[
              { value: "none", label: "Keine (Oberkategorie)" },
              ...roots.map(r => ({ value: String(r.id), label: r.name })),
            ]}
          />
          {hasChildren && (
            <p className="text-xs text-muted-foreground">
              Kategorien mit Unterkategorien können nicht verschoben werden.
            </p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={submit}
          disabled={updateCategory.isPending}
        >
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function Settings() {
  const { user, refresh } = useAuth();
  const { categories, accountTypes, banks, tags } = useFinanceData();
  const invalidate = useInvalidateFinance();
  const [catName, setCatName] = useState("");
  const [catType, setCatType] = useState<"income" | "expense">("expense");
  // '' = neue Oberkategorie, sonst ID der Oberkategorie für eine Unterkategorie
  const [catParent, setCatParent] = useState("");
  // Aktuell im Bearbeiten-Dialog geöffnete Kategorie (null = kein Dialog)
  const [editingCat, setEditingCat] = useState<EditCategory | null>(null);
  const [tagName, setTagName] = useState("");
  const [profileName, setProfileName] = useState(user?.name ?? "");
  const [profileColor, setProfileColor] = useState(user?.color ?? "#10b981");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const appSettings = trpc.finance.getAppSettings.useQuery();
  // null = noch keine eigene Auswahl → Server-Wert verwenden (kein Effekt nötig)
  const [currencyChoice, setCurrencyChoice] = useState<CurrencyCode | null>(
    null
  );
  const currency = currencyChoice ?? appSettings.data?.currency ?? "EUR";

  // Kategorien-Baum: Oberkategorien (parentId null) und deren Unterkategorien
  const catRoots = categories.filter(c => c.parentId === null);
  const catChildrenOf = (id: number) =>
    categories.filter(c => c.parentId === id);

  const createCategory = trpc.finance.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Kategorie hinzugefügt.");
      invalidate();
      setCatName("");
      setCatParent("");
    },
    onError: err => toast.error(err.message),
  });
  const deleteCategory = trpc.finance.deleteCategory.useMutation({
    onSuccess: () => {
      toast.success("Kategorie gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const createTag = trpc.finance.createTag.useMutation({
    onSuccess: () => {
      toast.success("Tag angelegt.");
      invalidate();
      setTagName("");
    },
    onError: err => toast.error(err.message),
  });
  const deleteTag = trpc.finance.deleteTag.useMutation({
    onSuccess: () => {
      toast.success("Tag gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const deleteAccountType = trpc.finance.deleteAccountType.useMutation({
    onSuccess: () => {
      toast.success("Kontotyp gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const deleteBank = trpc.finance.deleteBank.useMutation({
    onSuccess: () => {
      toast.success("Bank gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const updateProfile = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profil gespeichert.");
      refresh();
    },
    onError: err => toast.error(err.message),
  });
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Passwort geändert.");
      setCurrentPw("");
      setNewPw("");
    },
    onError: err => toast.error(err.message),
  });

  // Zwei-Faktor-Authentifizierung (opt-in pro Benutzer)
  // null = kein Setup läuft; nach setupTotp: Secret + otpauth-URL für den QR-Code
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [disablePw, setDisablePw] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const setupTotp = trpc.auth.setupTotp.useMutation({
    onSuccess: async data => {
      setTotpSetup(data);
      setTotpCode("");
      try {
        setTotpQr(
          await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 200 })
        );
      } catch {
        setTotpQr(null);
      }
    },
    onError: err => toast.error(err.message),
  });
  const enableTotp = trpc.auth.enableTotp.useMutation({
    onSuccess: () => {
      toast.success("Zwei-Faktor-Authentifizierung aktiviert.");
      setTotpSetup(null);
      setTotpQr(null);
      refresh();
    },
    onError: err => toast.error(err.message),
  });
  const disableTotp = trpc.auth.disableTotp.useMutation({
    onSuccess: () => {
      toast.success("Zwei-Faktor-Authentifizierung deaktiviert.");
      setDisableOpen(false);
      setDisablePw("");
      refresh();
    },
    onError: err => toast.error(err.message),
  });
  const resetData = trpc.finance.resetFinanceData.useMutation({
    onSuccess: () => {
      toast.success("Alle Finanzdaten wurden gelöscht.");
      invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const saveCurrency = trpc.finance.setCurrency.useMutation({
    onSuccess: (_data, vars) => {
      toast.success("Währung gespeichert.");
      setAppCurrency(vars.currency);
      invalidate();
    },
    onError: err => toast.error(err.message),
  });

  // Benachrichtigungen (nur Admins): null = noch nicht angefasst → Server-Wert
  const notifySettings = trpc.finance.getNotifySettings.useQuery(undefined, {
    enabled: user?.role === "admin",
  });
  const [ntfyUrl, setNtfyUrl] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [notifyEvents, setNotifyEvents] = useState<{
    budget: boolean;
    recurring: boolean;
    goal: boolean;
  } | null>(null);
  const ntfy = ntfyUrl ?? notifySettings.data?.ntfyUrl ?? "";
  const webhook = webhookUrl ?? notifySettings.data?.webhookUrl ?? "";
  const events = notifyEvents ??
    notifySettings.data?.events ?? {
      budget: true,
      recurring: true,
      goal: true,
    };
  const saveNotify = trpc.finance.setNotifySettings.useMutation({
    onSuccess: () => {
      toast.success("Benachrichtigungen gespeichert.");
      invalidate();
      notifySettings.refetch();
    },
    onError: err => toast.error(err.message),
  });
  const testNotify = trpc.finance.sendTestNotification.useMutation({
    onSuccess: data =>
      toast.success(
        `Testbenachrichtigung gesendet über: ${data.sent.join(", ")}.`
      ),
    onError: err => toast.error(err.message),
  });

  // Datensicherung (nur Admins, siehe unten)
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // Aktivitäten-Chronik (für alle Mitglieder): Limit wächst per „Mehr laden“,
  // der Entity-Filter gruppiert verwandte Bereiche clientseitig
  const [auditLimit, setAuditLimit] = useState(50);
  const [auditFilter, setAuditFilter] = useState("all");
  const auditQuery = trpc.finance.listAuditLog.useQuery({ limit: auditLimit });
  const auditEntries = (auditQuery.data ?? []).filter(e => {
    if (auditFilter === "all") return true;
    if (auditFilter === "system") return e.userName === null;
    const group = AUDIT_ENTITY_GROUPS.find(([key]) => key === auditFilter);
    return group ? group[2].includes(e.entity) : true;
  });
  const formatAuditTime = (d: Date) =>
    new Date(d).toLocaleString(getUserLocale(), {
      dateStyle: "short",
      timeStyle: "short",
    });

  /** SQLite-Datenbank vom Server laden und als Datei herunterladen */
  const downloadBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch("/api/backup", { credentials: "same-origin" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error ?? `Backup fehlgeschlagen (Status ${res.status}).`
        );
      }
      const blob = await res.blob();
      const match = /filename="?([^";]+)"?/.exec(
        res.headers.get("Content-Disposition") ?? ""
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "finance-fox-backup.db";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Backup fehlgeschlagen."
      );
    } finally {
      setBackupLoading(false);
    }
  };

  /** Backup-Datei an den Server schicken — ersetzt die komplette Datenbank */
  const restoreBackup = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        body: restoreFile,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error ??
            `Wiederherstellung fehlgeschlagen (Status ${res.status}).`
        );
      }
      toast.success("Backup wiederhergestellt — die Seite wird neu geladen.");
      // Alle Daten haben sich geändert: kompletter Neustart der App
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Wiederherstellung fehlgeschlagen."
      );
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Einstellungen</h1>
        <p className="text-sm text-muted-foreground">
          Profil, Kategorien und Datenverwaltung
        </p>
      </div>

      <Card className="border-emerald-600/30 bg-emerald-600/5">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <span className="font-semibold">Datenschutz:</span> Alle Daten
            liegen in einer SQLite-Datenbank auf deinem eigenen Server — nichts
            verlässt dein Netz. Als Self-Hoster bist du selbst für Absicherung
            (HTTPS, Backups des{" "}
            <code className="rounded bg-muted px-1">data/</code>-Ordners)
            verantwortlich.
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
              <Input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Farbe</Label>
              <div className="flex gap-2">
                {PROFILE_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`h-8 w-8 rounded-full border-2 ${profileColor === c ? "border-foreground" : "border-transparent"}`}
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
              onClick={() =>
                updateProfile.mutate({ name: profileName, color: profileColor })
              }
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
              <Input
                type="password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label>Neues Passwort (min. 8 Zeichen)</Label>
              <Input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button
              variant="outline"
              disabled={
                changePassword.isPending || !currentPw || newPw.length < 8
              }
              onClick={() =>
                changePassword.mutate({
                  currentPassword: currentPw,
                  newPassword: newPw,
                })
              }
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
            Gilt für den gesamten Haushalt — alle Beträge in der App werden in
            dieser Währung angezeigt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select
            value={currency}
            onValueChange={v => setCurrencyChoice(v as CurrencyCode)}
            disabled={user?.role !== "admin"}
          >
            <SelectTrigger
              className="w-64 min-w-0 [&>span]:truncate"
              title={`${currency} — ${CURRENCIES.find(c => c.code === currency)?.name ?? ""}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {user?.role === "admin" ? (
            <Button
              variant="outline"
              disabled={
                saveCurrency.isPending ||
                currency === appSettings.data?.currency
              }
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

      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>Benachrichtigungen</CardTitle>
            <CardDescription>
              Optional (opt-in): Finance Fox kann Ereignisse an einen
              selbstgehosteten ntfy-Server (volle Topic-URL, z.&nbsp;B.{" "}
              <code>https://ntfy.sh/mein-haushalt</code>) und/oder einen
              generischen Webhook (JSON per POST) melden. Ohne URL bleibt alles
              lokal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>ntfy-Topic-URL</Label>
                <Input
                  placeholder="https://ntfy.sh/mein-haushalt"
                  value={ntfy}
                  onChange={e => setNtfyUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Webhook-URL</Label>
                <Input
                  placeholder="https://example.org/hook"
                  value={webhook}
                  onChange={e => setWebhookUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Benachrichtigen bei</Label>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {(
                  [
                    ["budget", "Budget-Überschreitung"],
                    ["recurring", "Wiederkehrende Buchungen"],
                    ["goal", "Sparziel-Meilensteine"],
                  ] as const
                ).map(([key, label]) => (
                  <span key={key} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={events[key]}
                      onCheckedChange={checked =>
                        setNotifyEvents({ ...events, [key]: checked })
                      }
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
                onClick={() =>
                  saveNotify.mutate({
                    ntfyUrl: ntfy,
                    webhookUrl: webhook,
                    events,
                  })
                }
              >
                Benachrichtigungen speichern
              </Button>
              <Button
                variant="outline"
                disabled={testNotify.isPending}
                onClick={() => testNotify.mutate()}
              >
                {testNotify.isPending
                  ? "Sende…"
                  : "Testbenachrichtigung senden"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" /> Zwei-Faktor-Authentifizierung
            </CardTitle>
            <Badge variant={user?.totpEnabled ? "default" : "secondary"}>
              {user?.totpEnabled ? "Aktiviert" : "Deaktiviert"}
            </Badge>
          </div>
          <CardDescription>
            Zusätzlicher Schutz für dein Konto: Beim Anmelden wird neben dem
            Passwort ein 6-stelliger Code aus einer Authenticator-App
            (z.&nbsp;B. Aegis, Bitwarden, 2FAS) abgefragt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {totpSetup ? (
            <>
              <p className="text-sm">
                1. Scanne den QR-Code mit deiner Authenticator-App oder gib das
                Geheimnis von Hand ein.
              </p>
              <div className="flex flex-wrap items-start gap-4">
                {totpQr && (
                  <img
                    src={totpQr}
                    alt="QR-Code für die Authenticator-App"
                    className="h-40 w-40 rounded-lg border bg-white p-1"
                  />
                )}
                <div className="space-y-1">
                  <Label>Geheimnis (manuelle Eingabe)</Label>
                  <code className="block max-w-64 break-all rounded bg-muted px-2 py-1.5 text-sm">
                    {totpSetup.secret}
                  </code>
                </div>
              </div>
              <p className="text-sm">
                2. Gib den Code aus der App ein, um die Einrichtung
                abzuschließen.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-36"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ""))}
                />
                <Button
                  disabled={enableTotp.isPending || totpCode.length !== 6}
                  onClick={() => enableTotp.mutate({ code: totpCode })}
                >
                  2FA aktivieren
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTotpSetup(null);
                    setTotpQr(null);
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            </>
          ) : user?.totpEnabled ? (
            <>
              <p className="text-sm text-muted-foreground">
                Dein Konto ist durch einen zweiten Faktor geschützt.
              </p>
              <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">2FA deaktivieren</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>2FA deaktivieren?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Die Zwei-Faktor-Authentifizierung wird entfernt. Bestätige
                      das mit deinem aktuellen Passwort.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-2">
                    <Label>Aktuelles Passwort</Label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={disablePw}
                      onChange={e => setDisablePw(e.target.value)}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={disableTotp.isPending || !disablePw}
                      onClick={() =>
                        disableTotp.mutate({ password: disablePw })
                      }
                    >
                      Deaktivieren
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <Button
              variant="outline"
              disabled={setupTotp.isPending}
              onClick={() => setupTotp.mutate()}
            >
              2FA einrichten
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kategorien</CardTitle>
          <CardDescription>{categories.length} Kategorien</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Baum-Ansicht: Oberkategorien mit eingerückten Unterkategorien */}
          <div className="space-y-1.5">
            {catRoots.map(root => (
              <div key={root.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1.5 py-1 pl-2 pr-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: root.color }}
                  />
                  {root.name}
                  <button
                    type="button"
                    className="ml-1 rounded-full p-0.5 hover:bg-muted"
                    onClick={() => setEditingCat(root)}
                    title="Bearbeiten"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-muted"
                    onClick={() => deleteCategory.mutate({ id: root.id })}
                    title="Löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
                {catChildrenOf(root.id).map(child => (
                  <Badge
                    key={child.id}
                    variant="secondary"
                    className="ml-4 gap-1.5 py-1 pl-2 pr-1"
                  >
                    <span className="text-muted-foreground">└</span>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: child.color }}
                    />
                    {child.name}
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                      onClick={() => setEditingCat(child)}
                      title="Bearbeiten"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-muted"
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
            <Input
              className="min-w-40 flex-1"
              placeholder="Neue Kategorie…"
              value={catName}
              onChange={e => setCatName(e.target.value)}
            />
            <SearchableSelect
              value={catParent || "none"}
              onValueChange={v => {
                const parentId = v === "none" ? "" : v;
                setCatParent(parentId);
                // Unterkategorien erben den Typ der Oberkategorie
                const parent = catRoots.find(c => String(c.id) === parentId);
                if (parent) setCatType(parent.type);
              }}
              className="w-48"
              options={[
                { value: "none", label: "Oberkategorie" },
                ...catRoots.map(c => ({
                  value: String(c.id),
                  label: `Unter: ${c.name}`,
                })),
              ]}
            />
            <Select
              value={catType}
              onValueChange={v => setCatType(v as "income" | "expense")}
              disabled={catParent !== ""}
            >
              <SelectTrigger
                className="w-32 min-w-0 [&>span]:truncate"
                title={catType === "expense" ? "Ausgabe" : "Einnahme"}
              >
                <SelectValue />
              </SelectTrigger>
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
                const parent = catRoots.find(c => String(c.id) === catParent);
                createCategory.mutate({
                  name: catName.trim(),
                  type: catType,
                  color:
                    parent?.color ??
                    CAT_COLORS[categories.length % CAT_COLORS.length],
                  parentId: parent?.id,
                });
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bearbeiten-Dialog: wird pro Kategorie neu gemountet (Initialwerte) */}
      <Dialog
        open={editingCat !== null}
        onOpenChange={o => {
          if (!o) setEditingCat(null);
        }}
      >
        {editingCat && (
          <CategoryEditDialog
            key={editingCat.id}
            cat={editingCat}
            roots={catRoots.filter(
              c => c.type === editingCat.type && c.id !== editingCat.id
            )}
            hasChildren={catChildrenOf(editingCat.id).length > 0}
            onClose={() => setEditingCat(null)}
          />
        )}
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
          <CardDescription>
            {tags.length} Tags — haushaltsweite Labels für Buchungen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {tags.map(tag => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="gap-1.5 py-1 pl-2 pr-1"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
                <button
                  type="button"
                  className="ml-1 rounded-full p-0.5 hover:bg-muted"
                  onClick={() => deleteTag.mutate({ id: tag.id })}
                  title="Löschen (Zuordnungen zu Buchungen werden entfernt)"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {tags.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Noch keine Tags angelegt.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Beim Löschen eines Tags werden seine Zuordnungen zu Buchungen
            entfernt — die Buchungen bleiben erhalten.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-40 flex-1"
              placeholder="Neuer Tag…"
              value={tagName}
              onChange={e => setTagName(e.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => {
                if (!tagName.trim()) return;
                // Die Farbe vergibt der Server automatisch aus der Palette
                createTag.mutate({ name: tagName.trim() });
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
            Neue Typen und Banken legst du direkt im Konto-Dialog an (über „+
            Neuer Typ“ bzw. „+ Neue Bank“).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Kontotypen</p>
            <div className="flex flex-wrap gap-2">
              {accountTypes.map(t => (
                <Badge
                  key={t.id}
                  variant="secondary"
                  className="gap-1.5 py-1 pl-2 pr-1"
                >
                  {t.name}
                  {t.builtin && (
                    <Badge variant="outline" className="ml-1 text-[10px]">
                      Standard
                    </Badge>
                  )}
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
              <p className="text-sm text-muted-foreground">
                Noch keine Banken angelegt.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {banks.map(b => (
                <Badge
                  key={b.id}
                  variant="secondary"
                  className="gap-1.5 py-1 pl-2 pr-1"
                >
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

      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>Datensicherung</CardTitle>
            <CardDescription>
              Komplette Datenbank als Datei sichern oder aus einer Sicherung
              wiederherstellen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={downloadBackup}
                disabled={backupLoading}
              >
                <DatabaseBackup className="mr-2 h-4 w-4" />
                {backupLoading ? "Lade herunter…" : "Backup herunterladen"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Lädt die komplette SQLite-Datenbank als <code>.db</code>-Datei
                herunter.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border border-destructive/50 p-3">
              <p className="text-sm font-semibold text-destructive">
                Backup wiederherstellen
              </p>
              <p className="text-xs text-muted-foreground">
                Ersetzt die komplette Datenbank auf dem Server durch die
                hochgeladene Datei.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  ref={restoreInputRef}
                  type="file"
                  accept=".db,application/octet-stream"
                  className="max-w-xs"
                  onChange={e => setRestoreFile(e.target.files?.[0] ?? null)}
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
                <AlertDialogTitle>
                  Backup wirklich wiederherstellen?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="font-semibold">{restoreFile?.name}</span>{" "}
                  wird auf den Server geladen und ersetzt{" "}
                  <span className="font-semibold">ALLE aktuellen Daten</span> —
                  Konten, Buchungen, Budgets, Kategorien, Sparziele und
                  Benutzer. Dieser Schritt kann nicht rückgängig gemacht werden.
                  Lade vorher ein aktuelles Backup herunter.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={restoring}>
                  Abbrechen
                </AlertDialogCancel>
                <AlertDialogAction onClick={restoreBackup} disabled={restoring}>
                  {restoring
                    ? "Stelle wieder her…"
                    : "Endgültig wiederherstellen"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datenverwaltung</CardTitle>
          <CardDescription>
            Alle Finanzdaten des Haushalts unwiderruflich löschen
            (Benutzerkonten bleiben bestehen).
          </CardDescription>
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
                  Konten, Buchungen, Budgets, Dauerbuchungen, Kategorien und
                  Sparziele werden unwiderruflich gelöscht. Sichere vorher den{" "}
                  <code>data/</code>-Ordner auf dem Server, falls du ein Backup
                  brauchst.
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Aktivitäten
            </CardTitle>
            <Select value={auditFilter} onValueChange={setAuditFilter}>
              <SelectTrigger
                className="w-44 min-w-0 [&>span]:truncate"
                title={
                  auditFilter === "all"
                    ? "Alle Bereiche"
                    : auditFilter === "system"
                      ? "System"
                      : (AUDIT_ENTITY_GROUPS.find(([key]) => key === auditFilter)?.[1] ?? auditFilter)
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Bereiche</SelectItem>
                {AUDIT_ENTITY_GROUPS.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardDescription>
            Chronik der Änderungen im Haushalt — sichtbar für alle Mitglieder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {auditEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {auditQuery.isLoading ? "Lade…" : "Noch keine Einträge."}
            </p>
          )}
          <ul className="divide-y">
            {auditEntries.map(e => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatAuditTime(e.createdAt)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-medium">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: e.userColor ?? "#94a3b8" }}
                  />
                  {e.userName ?? "System"}
                </span>
                <span>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</span>
                {e.detail && (
                  <span className="text-muted-foreground">{e.detail}</span>
                )}
              </li>
            ))}
          </ul>
          {(auditQuery.data?.length ?? 0) >= auditLimit && (
            <Button
              variant="outline"
              size="sm"
              disabled={auditQuery.isFetching}
              onClick={() => setAuditLimit(l => l + 100)}
            >
              Mehr laden
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
