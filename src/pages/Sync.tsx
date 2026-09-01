import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CloudOff,
  History,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { useOffline } from "@/providers/offline";
import {
  describeRecord,
  entityLabel,
  fieldLabel,
  formatFieldValue,
} from "@/lib/syncLabels";
import { formatSyncTime } from "@/lib/syncTime";
import { cn } from "@/lib/utils";

/**
 * Seite „Abgleich": alles, was der Benutzer über die Synchronisierung wissen
 * und entscheiden muss.
 *
 * Kern ist die Konfliktliste. Ein Konflikt entsteht nur, wenn **dasselbe Feld**
 * unterwegs und zuhause verschieden geändert wurde — verschiedene Felder führt
 * die App selbst zusammen und protokolliert das darunter.
 *
 * Bis zur Entscheidung gilt lokal der Stand aus dem Heimnetz; die eigene
 * Fassung ist im Konflikt festgehalten und geht nicht verloren. Das steht so
 * auch auf der Seite — sonst wirkt es, als wäre die eigene Änderung weg.
 */
export default function Sync() {
  const { status, available, syncNow } = useOffline();
  const conflicts = trpc.sync.listConflicts.useQuery();
  const merges = trpc.sync.listMerges.useQuery({ limit: 50 });
  const utils = trpc.useUtils();

  const resolve = trpc.sync.resolveConflict.useMutation({
    onSuccess: () => {
      toast.success(
        "Entschieden — die Änderung geht beim nächsten Abgleich raus."
      );
      utils.sync.listConflicts.invalidate();
      utils.invalidate();
      syncNow();
    },
    onError: err => toast.error(err.message),
  });

  const clearMerges = trpc.sync.clearMerges.useMutation({
    onSuccess: () => {
      utils.sync.listMerges.invalidate();
      toast.success("Protokoll geleert.");
    },
  });

  const open = conflicts.data ?? [];
  const mergeRows = merges.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Abgleich</h1>
          <p className="text-sm text-muted-foreground">
            Was zwischen diesem Gerät und dem Heimserver hin- und hergeht
          </p>
        </div>
        <Button variant="outline" disabled={status?.syncing} onClick={syncNow}>
          <RefreshCw
            className={cn("mr-2 h-4 w-4", status?.syncing && "animate-spin")}
          />
          Jetzt abgleichen
        </Button>
      </div>

      {!available && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CloudOff className="h-5 w-5 text-muted-foreground" />
              Offline-Betrieb nicht aktiv
            </CardTitle>
            <CardDescription>
              Diese App läuft ohne lokale Kopie — es gibt nichts abzugleichen.
              Warum das so ist, steht in den Einstellungen unter
              „Offline-Betrieb".
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {available && status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Status
              {status.reachable ? (
                <Badge variant="secondary">Heimnetz erreichbar</Badge>
              ) : (
                <Badge variant="outline">Unterwegs</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Zuletzt abgeglichen"
              value={formatSyncTime(status.lastSyncAt)}
            />
            <Stat
              label="Wartet auf das Heimnetz"
              value={
                status.pending === 0 ? "nichts" : `${status.pending} Änderungen`
              }
            />
            <Stat
              label="Zu entscheiden"
              value={
                status.conflicts === 0
                  ? "nichts"
                  : `${status.conflicts} Konflikte`
              }
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Konflikte
            {open.length > 0 && <Badge variant="outline">{open.length}</Badge>}
          </CardTitle>
          <CardDescription>
            Hier steht nur, was die App nicht selbst entscheiden kann: dasselbe
            Feld wurde unterwegs und zuhause verschieden geändert. Bis zu deiner
            Entscheidung gilt der Stand aus dem Heimnetz — deine Fassung ist
            hier festgehalten und geht nicht verloren.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {open.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-emerald-600" />
              Keine offenen Konflikte.
            </p>
          )}
          {open.map(conflict => (
            <ConflictCard
              key={`${conflict.entity}:${conflict.rowId}`}
              conflict={conflict}
              busy={resolve.isPending}
              onResolve={choice =>
                resolve.mutate({
                  entity: conflict.entity,
                  rowId: conflict.rowId,
                  choice,
                })
              }
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Automatisch zusammengeführt
              {mergeRows.length > 0 && (
                <Badge variant="secondary">{mergeRows.length}</Badge>
              )}
            </CardTitle>
            {mergeRows.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={clearMerges.isPending}
                onClick={() => clearMerges.mutate()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Protokoll leeren
              </Button>
            )}
          </div>
          <CardDescription>
            Wurden verschiedene Felder desselben Datensatzes geändert, führt die
            App beides zusammen, ohne zu fragen. Hier steht, was sie dabei
            entschieden hat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mergeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Bisher nichts zusammengeführt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datensatz</TableHead>
                    <TableHead>Von hier übernommen</TableHead>
                    <TableHead>Aus dem Heimnetz</TableHead>
                    <TableHead className="whitespace-nowrap">Wann</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mergeRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-0">
                        {entityLabel(row.entity)}
                      </TableCell>
                      <TableCell>
                        {row.mineFields.map(fieldLabel).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        {row.theirFields.map(fieldLabel).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatSyncTime(row.mergedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-sm font-medium">{value}</p>
    </div>
  );
}

type Conflict = inferRouterOutputs<AppRouter>["sync"]["listConflicts"][number];
type Choice = "mine" | "theirs" | { fields: Record<string, "mine" | "theirs"> };

/**
 * Eine Karte je Konflikt. Die vier Arten brauchen verschiedene Worte — ein
 * gelöschter Datensatz ist etwas anderes als ein strittiges Feld, und eine
 * entzogene Berechtigung lässt gar keine Wahl.
 */
function ConflictCard({
  conflict,
  busy,
  onResolve,
}: {
  conflict: Conflict;
  busy: boolean;
  onResolve: (choice: Choice) => void;
}) {
  const [picks, setPicks] = useState<Record<string, "mine" | "theirs">>({});
  const title = useMemo(
    () => describeRecord(conflict.entity, conflict.mine ?? conflict.theirs),
    [conflict]
  );

  if (conflict.kind === "forbidden") {
    return (
      <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            {conflict.detail ||
              "Für diesen Datensatz fehlt inzwischen die Berechtigung."}{" "}
            Deine Änderung von unterwegs lässt sich deshalb nicht übernehmen.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onResolve("theirs")}
        >
          Änderung verwerfen
        </Button>
      </div>
    );
  }

  if (conflict.kind === "deleted-remote" || conflict.kind === "deleted-local") {
    const deletedHere = conflict.kind === "deleted-local";
    return (
      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            {deletedHere
              ? "Du hast diesen Eintrag unterwegs gelöscht — im Heimnetz wurde er inzwischen geändert."
              : "Du hast diesen Eintrag unterwegs geändert — im Heimnetz wurde er inzwischen gelöscht."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("mine")}
          >
            {deletedHere
              ? "Trotzdem löschen"
              : "Eintrag behalten (meine Fassung)"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("theirs")}
          >
            {deletedHere ? "Eintrag behalten" : "Löschen übernehmen"}
          </Button>
        </div>
      </div>
    );
  }

  const fields = conflict.fields;
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            {fields.length === 1
              ? "Ein Feld wurde auf beiden Seiten verschieden geändert."
              : `${fields.length} Felder wurden auf beiden Seiten verschieden geändert.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("mine")}
          >
            Alles von hier
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("theirs")}
          >
            Alles aus dem Heimnetz
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Feld</TableHead>
              <TableHead>Auf diesem Gerät</TableHead>
              <TableHead>Im Heimnetz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map(field => {
              const pick = picks[field] ?? "theirs";
              return (
                <TableRow key={field}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {fieldLabel(field)}
                  </TableCell>
                  <ValueCell
                    active={pick === "mine"}
                    value={formatFieldValue(
                      field,
                      conflict.mine?.[field] ?? null
                    )}
                    onPick={() => setPicks(p => ({ ...p, [field]: "mine" }))}
                  />
                  <ValueCell
                    active={pick === "theirs"}
                    value={formatFieldValue(
                      field,
                      conflict.theirs?.[field] ?? null
                    )}
                    onPick={() => setPicks(p => ({ ...p, [field]: "theirs" }))}
                  />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          const chosen = Object.fromEntries(
            fields.map(field => [field, picks[field] ?? "theirs"])
          ) as Record<string, "mine" | "theirs">;
          onResolve({ fields: chosen });
        }}
      >
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        Auswahl übernehmen
      </Button>
    </div>
  );
}

function ValueCell({
  active,
  value,
  onPick,
}: {
  active: boolean;
  value: string;
  onPick: () => void;
}) {
  return (
    <TableCell className="min-w-0 p-0">
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2 text-left transition-colors",
          active ? "bg-emerald-600/10 font-medium" : "hover:bg-muted/60"
        )}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            active ? "bg-emerald-600" : "bg-muted-foreground/30"
          )}
        />
        <span className="min-w-0 break-words">{value}</span>
      </button>
    </TableCell>
  );
}
