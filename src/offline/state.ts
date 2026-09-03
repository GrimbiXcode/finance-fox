import { idbDelete, idbGet, idbSet } from "./db/idb";
import type { OfflineIdentity } from "@contracts/offline";

/**
 * Der kleine Zustand des Offline-Teils, der nicht in der SQLite-Replik liegt:
 * angemeldeter Benutzer, Geräte-Anmeldung, Abgleichstand.
 */

/** Wie lange die lokale Identität ohne Kontakt zum Heimserver gilt */
const IDENTITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type StoredIdentity = { user: OfflineIdentity; validUntil: number };

/** Anmeldung des Geräts beim Server, inklusive seines ID-Blocks */
export type DeviceRegistration = {
  deviceId: string;
  idBlockStart: number;
  epoch: string;
};

/**
 * Identität merken. Kommt nach jedem erfolgreichen `auth.me` über das Netz
 * von der Seite — ein Service Worker kann das HttpOnly-Cookie nicht lesen.
 */
export async function saveIdentity(user: OfflineIdentity | null) {
  if (!user) {
    await idbDelete("state", "identity");
    return;
  }
  const stored: StoredIdentity = {
    user,
    validUntil: Date.now() + IDENTITY_MAX_AGE_MS,
  };
  await idbSet("state", "identity", stored);
}

/**
 * Gespeicherte Identität — oder null, wenn sie abgelaufen ist. Die Frist
 * entspricht der Lebensdauer des Session-Cookies: Danach verlangt die App
 * eine Anmeldung im Heimnetz, statt unbegrenzt Zugriff zu gewähren.
 */
export async function loadIdentity(): Promise<OfflineIdentity | null> {
  const stored = await idbGet<StoredIdentity>("state", "identity");
  if (!stored) return null;
  if (stored.validUntil < Date.now()) {
    await idbDelete("state", "identity");
    return null;
  }
  return stored.user;
}

export async function saveDevice(device: DeviceRegistration | null) {
  if (!device) {
    await idbDelete("state", "device");
    return;
  }
  await idbSet("state", "device", device);
}

export function loadDevice(): Promise<DeviceRegistration | undefined> {
  return idbGet<DeviceRegistration>("state", "device");
}

/** Stand des Änderungsprotokolls, den dieses Gerät bereits eingespielt hat */
export async function loadCursor(): Promise<number> {
  return (await idbGet<number>("state", "cursor")) ?? 0;
}

export function saveCursor(seq: number): Promise<void> {
  return idbSet("state", "cursor", seq);
}

/**
 * Erst nach dem ersten vollständigen Abgleich beantwortet der Service Worker
 * Anfragen aus der lokalen Replik. Vorher wäre die Datenbank leer, und die App
 * schlösse daraus fälschlich auf eine nötige Ersteinrichtung.
 */
export async function isBootstrapped(): Promise<boolean> {
  return (await idbGet<boolean>("state", "bootstrapped")) === true;
}

export function markBootstrapped(): Promise<void> {
  return idbSet("state", "bootstrapped", true);
}

export function clearBootstrapped(): Promise<void> {
  return idbDelete("state", "bootstrapped");
}

/** Zeitpunkt des letzten erfolgreichen Abgleichs (nur für die Anzeige) */
export function saveLastSync(at: number): Promise<void> {
  return idbSet("state", "lastSyncAt", at);
}

export async function loadLastSync(): Promise<number | null> {
  return (await idbGet<number>("state", "lastSyncAt")) ?? null;
}

/**
 * Wie viel Platz die Anhang-Dateien auf diesem Gerät belegen dürfen.
 * 0 heißt: Belege werden nicht auf Vorrat geladen (sie bleiben im Heimnetz
 * abrufbar). Default 200 MB — genug für die Belege mehrerer Jahre, ohne ein
 * Telefon vollzuschreiben.
 */
export const DEFAULT_BLOB_BUDGET = 200 * 1024 * 1024;

export async function loadBlobBudget(): Promise<number> {
  const stored = await idbGet<number>("state", "blobBudget");
  return typeof stored === "number" ? stored : DEFAULT_BLOB_BUDGET;
}

export function saveBlobBudget(bytes: number): Promise<void> {
  return idbSet("state", "blobBudget", bytes);
}
