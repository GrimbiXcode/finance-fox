import { useRef, useState, type ReactNode } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useInvalidateFinance } from '@/lib/data';
import { formatBytes } from '@/lib/finance';
import { toast } from 'sonner';

/** Beleg-Metadaten, wie sie finance.listTransactions mitliefert */
export interface TxAttachment {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

/**
 * Dialog für die Belege (Fotos/PDF) einer Buchung: ansehen, hochladen,
 * löschen. Die Anhänge kommen als Prop aus listTransactions; nach jeder
 * Änderung werden die Finanz-Queries invalidiert.
 */
export default function TransactionAttachmentsDialog({
  transactionId,
  note,
  attachments,
  trigger,
}: {
  transactionId: number;
  note: string;
  attachments: TxAttachment[];
  trigger: ReactNode;
}) {
  const invalidate = useInvalidateFinance();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Die Datei ist zu groß (maximal 10 MB).');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/attachments?transactionId=${transactionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? 'Der Beleg konnte nicht hochgeladen werden.');
        return;
      }
      toast.success('Beleg hochgeladen.');
      invalidate();
    } catch {
      toast.error('Der Beleg konnte nicht hochgeladen werden.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Der Beleg konnte nicht gelöscht werden.');
        return;
      }
      toast.success('Beleg gelöscht.');
      invalidate();
    } catch {
      toast.error('Der Beleg konnte nicht gelöscht werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Belege</DialogTitle>
          <DialogDescription>
            {note ? `Belege zur Buchung „${note}".` : 'Belege zu dieser Buchung.'}{' '}
            Erlaubt: Bilder (JPEG, PNG, WebP, GIF) und PDF, maximal 10 MB.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {attachments.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Belege vorhanden.</p>
          )}
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border p-2">
              {a.mimeType.startsWith('image/') ? (
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt={a.originalName}
                    className="h-14 w-14 rounded object-cover"
                  />
                </a>
              ) : (
                <a
                  href={`/api/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-14 w-14 items-center justify-center rounded bg-muted"
                >
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {a.originalName}
                </a>
                <p className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Beleg löschen"
                disabled={busy}
                onClick={() => remove(a.id)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> {busy ? 'Bitte warten…' : 'Beleg hochladen'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
