/**
 * Dateidownloads im Browser — gemeinsamer Helfer für alle Exporte
 * (Bericht als PDF/Excel, Datenbank-Backup, CSV-Export).
 */

/**
 * Blob als Datei speichern.
 *
 * Zwei Details entscheiden darüber, ob der Download in Chromium-Browsern
 * (Chrome, Arc, Edge) sauber abschließt:
 *
 * 1. Der Anker muss im Dokument hängen. Ein Klick auf ein losgelöstes
 *    Element startet den Download zwar meist, ist aber nicht zuverlässig.
 * 2. Die Objekt-URL darf **nicht** direkt nach dem Klick freigegeben
 *    werden. Der Browser lädt den Blob asynchron in seinen Download-Manager;
 *    ein sofortiges `revokeObjectURL` zieht ihm die Datenquelle unter den
 *    Füßen weg. Typisches Symptom: Die Datei ist vollständig geladen
 *    (Soll‑ = Ist-Größe), der Download bleibt aber ewig „in Arbeit".
 *
 * Deshalb: Anker einhängen, klicken, wieder entfernen — und die Objekt-URL
 * erst deutlich später freigeben. Der Speicher wird spätestens beim
 * Verlassen der Seite ohnehin frei, das späte Freigeben kostet also nichts.
 */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Endungen, die Chromium aus einem **unsicheren Kontext** nicht speichert.
 * Die Sperre hängt an der Dateiendung, nicht am Content-Type: `.db` und
 * `.csv` (Backup, CSV-Export) laufen durch, `.pdf` und `.xlsx` nicht.
 */
const BLOCKED_OVER_HTTP = ["pdf", "xlsx", "docx", "zip"];

/**
 * Warnung, wenn dieser Download im Browser stumm hängen bleiben wird.
 *
 * Chrome, Arc und Edge speichern bestimmte Dateitypen nur aus einem sicheren
 * Kontext (HTTPS oder `localhost`). Läuft die App über HTTP im Heimnetz —
 * der Normalfall bei einer selbstgehosteten Installation ohne Zertifikat —,
 * startet der Download zwar, wird vollständig geladen und **schliesst nie
 * ab**; in der Konsole steht dann „was loaded over an insecure connection".
 * Das ist app-seitig nicht behebbar: Jeder Weg, eine Datei zu speichern,
 * läuft über denselben Download-Mechanismus. Statt den Nutzer im Dunkeln zu
 * lassen, benennen wir die Ursache und den Ausweg.
 *
 * NULL = kein Grund zur Warnung (sichere Verbindung oder harmlose Endung).
 */
export function insecureDownloadHint(
  filename: string
): { title: string; description: string } | null {
  if (window.isSecureContext) return null;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!BLOCKED_OVER_HTTP.includes(extension)) return null;
  return {
    title: "Der Download bleibt in Chrome, Arc und Edge womöglich hängen",
    description:
      "Diese Browser speichern PDF- und Excel-Dateien nur über eine " +
      "gesicherte Verbindung; die App läuft hier über HTTP. Abhilfe: in den " +
      "Website-Einstellungen des Browsers „Unsichere Inhalte“ zulassen — " +
      "oder die App über HTTPS bzw. localhost aufrufen. Safari und Firefox " +
      "sind nicht betroffen.",
  };
}

/**
 * Dateiname aus dem `Content-Disposition`-Header einer Antwort lesen;
 * ohne verwertbaren Header greift der Fallback. `filename*` (RFC 5987,
 * UTF-8-kodiert) hat Vorrang vor dem einfachen `filename`.
 */
export function filenameFromResponse(res: Response, fallback: string): string {
  const header = res.headers.get("Content-Disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Kaputte Prozent-Kodierung: auf das einfache filename zurückfallen
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1].trim() || fallback;
}
