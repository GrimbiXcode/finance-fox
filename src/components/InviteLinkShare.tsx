import { useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * Einladungslink weitergeben (H7): kopieren, über den Teilen-Dialog des
 * Geräts senden (falls es einen gibt) oder als QR-Code zeigen — für die
 * Einrichtung am Küchentisch, Handy vor den Bildschirm. Der QR-Code entsteht
 * lokal (`qrcode`), der Link verlässt das Gerät nur, wenn man ihn teilt.
 */
export default function InviteLinkShare({ link, name }: { link: string; name?: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link kopiert.');
    } catch {
      toast.error('Kopieren nicht möglich — bitte den Link markieren und kopieren.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({
        title: 'Einladung zu Finance Fox',
        text: name ? `Hallo ${name}, hier ist deine Einladung zu unserem Haushaltsbuch:` : 'Einladung zu unserem Haushaltsbuch:',
        url: link,
      });
    } catch {
      // Abgebrochen — nichts zu tun
    }
  };
  const showQr = async () => {
    if (qr) {
      setQr(null);
      return;
    }
    try {
      setQr(await QRCode.toDataURL(link, { margin: 1, width: 220 }));
    } catch {
      toast.error('QR-Code konnte nicht erzeugt werden.');
    }
  };

  return (
    <div className="space-y-3">
      <code className="block break-all rounded bg-muted px-3 py-2 text-xs">{link}</code>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="outline" onClick={copy}>
          <Copy className="mr-2 h-4 w-4" /> Kopieren
        </Button>
        {canShare && (
          <Button variant="outline" onClick={share}>
            <Share2 className="mr-2 h-4 w-4" /> Teilen
          </Button>
        )}
        <Button variant="outline" onClick={showQr} aria-expanded={qr !== null}>
          <QrCode className="mr-2 h-4 w-4" /> {qr ? 'QR ausblenden' : 'QR-Code'}
        </Button>
      </div>
      {qr && (
        <div className="flex flex-col items-center gap-1">
          <img src={qr} alt="QR-Code des Einladungslinks" className="h-56 w-56 rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">Mit der Kamera des anderen Handys scannen.</p>
        </div>
      )}
    </div>
  );
}
