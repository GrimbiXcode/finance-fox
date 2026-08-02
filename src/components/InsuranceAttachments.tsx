import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { formatBytes } from "@/lib/finance";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

/**
 * Dokumente einer Police (Policenkopie, AVB, Versicherungsausweis): Liste mit
 * Öffnen-Link, Löschen mit Bestätigung und Upload über die Hono-Routen
 * /api/insurance-attachments. Muster: PensionAttachments.
 *
 * Anders als dort gibt es keinen Besitzcheck — das Modul ist haushaltsweit,
 * jedes Mitglied darf die Dokumente sehen und verwalten.
 */
export default function InsuranceAttachments({
  policyId,
}: {
  policyId: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  const listQuery = trpc.insurance.listAttachments.useQuery({ policyId });
  const attachments = listQuery.data ?? [];

  const refresh = async () => {
    await utils.insurance.listAttachments.invalidate({ policyId });
    // Der Zähler „Dokumente (N)" hängt an der Policen-Liste
    await utils.insurance.listPolicies.invalidate();
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error("Die Datei ist zu groß (maximal 10 MB).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/insurance-attachments?policyId=${policyId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Filename": encodeURIComponent(file.name),
          },
          body: file,
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Das Dokument konnte nicht hochgeladen werden.");
        return;
      }
      toast.success("Dokument hochgeladen.");
      await refresh();
    } catch {
      toast.error("Das Dokument konnte nicht hochgeladen werden.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/insurance-attachments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Das Dokument konnte nicht gelöscht werden.");
        return;
      }
      toast.success("Dokument gelöscht.");
      await refresh();
    } catch {
      toast.error("Das Dokument konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {listQuery.isSuccess && attachments.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Noch keine Dokumente hinterlegt. Policenkopie oder AVB hochladen, dann
          hast du sie beim Nachschlagen sofort zur Hand.
        </p>
      )}
      {attachments.map(a => (
        <div
          key={a.id}
          className="flex items-center gap-2 rounded-lg border p-2"
        >
          <a
            href={`/api/insurance-attachments/${a.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted"
          >
            <FileText className="h-4 w-4 text-muted-foreground" />
          </a>
          <div className="min-w-0 flex-1">
            <a
              href={`/api/insurance-attachments/${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium hover:underline"
            >
              {a.originalName}
            </a>
            <p className="text-xs text-muted-foreground">
              {formatBytes(a.sizeBytes)}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title="Dokument löschen"
                disabled={busy}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Dokument wirklich löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  „{a.originalName}“ wird unwiderruflich gelöscht.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => remove(a.id)}
                >
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ))}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="mr-2 h-4 w-4" />{" "}
        {busy ? "Bitte warten…" : "Dokument hochladen"}
      </Button>
    </div>
  );
}
