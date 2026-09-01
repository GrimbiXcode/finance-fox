/**
 * Schmale Hülle um IndexedDB — der einzige dauerhafte Speicher, den ein
 * Service Worker hat.
 *
 * Bewusst ohne Bibliothek: gebraucht werden get/set/delete auf zwei
 * Objektspeichern, das sind ein paar Dutzend Zeilen. Eine Abhängigkeit dafür
 * passt nicht zum Projekt (PDF-, XLSX- und TOTP-Writer sind hier ebenfalls
 * von Hand geschrieben).
 */

const DB_NAME = "finance-fox-offline";
const DB_VERSION = 1;

/** `state`: alles Kleinteilige (DB-Abbild, Identität, Sync-Stand) */
/** `blobs`: Anhang-Dateien, nach `storedName` abgelegt */
export type IdbStore = "state" | "blobs";

const STORES: IdbStore[] = ["state", "blobs"];

let connection: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function run<T>(
  store: IdbStore,
  mode: IDBTransactionMode,
  body: (objectStore: IDBObjectStore) => IDBRequest
): Promise<T> {
  return open().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = body(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export function idbGet<T>(
  store: IdbStore,
  key: string
): Promise<T | undefined> {
  return run<T | undefined>(store, "readonly", s => s.get(key));
}

export function idbSet(
  store: IdbStore,
  key: string,
  value: unknown
): Promise<void> {
  return run<void>(store, "readwrite", s => s.put(value, key));
}

export function idbDelete(store: IdbStore, key: string): Promise<void> {
  return run<void>(store, "readwrite", s => s.delete(key));
}

export function idbKeys(store: IdbStore): Promise<string[]> {
  return run<string[]>(store, "readonly", s => s.getAllKeys());
}

/** Alles verwerfen — Notbremse „Offline-Daten zurücksetzen" */
export async function idbClearAll(): Promise<void> {
  const db = await open();
  await Promise.all(
    STORES.map(
      store =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, "readwrite");
          const request = tx.objectStore(store).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        })
    )
  );
}
