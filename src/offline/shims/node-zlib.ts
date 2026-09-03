/**
 * Ersatz für `node:zlib` in der lokalen Replik.
 *
 * Einziger Nutzer ist der XLSX-Writer (`api/lib/xlsx.ts`), der die ZIP-Einträge
 * einer Excel-Mappe komprimiert. Der Berichts-Export läuft bewusst nur im
 * Heimnetz — im Browser gibt es keine *synchrone* Deflate-Funktion
 * (`CompressionStream` ist asynchron), und ein halb funktionierender Export
 * wäre schlechter als eine klare Ansage.
 */
export function deflateRawSync(): never {
  throw new Error(
    "Der Berichts-Export steht offline nicht zur Verfügung — " +
      "er läuft nur im Heimnetz."
  );
}

export default { deflateRawSync };
