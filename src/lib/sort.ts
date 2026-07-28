import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, type LucideIcon } from 'lucide-react';
import { getUserLocale } from '@/lib/finance';

export type SortDirection = 'asc' | 'desc';

/** Schlüssel-Getter pro sortierbarer Spalte: Zahl (numerisch) oder Text (locale-bewusst) */
export type SortGetters<K extends string, T> = Record<K, (row: T) => string | number>;

/** Vergleicht zwei Sortierwerte: Zahlen numerisch, Texte locale-bewusst */
const compareValues = (a: string | number, b: string | number): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), getUserLocale());
};

/**
 * Clientseitige Tabellen-Sortierung per Klick auf einen Spaltenkopf:
 * Der erste Klick auf eine Spalte sortiert aufsteigend, ein erneuter Klick
 * auf dieselbe Spalte absteigend; der Klick auf eine andere Spalte startet
 * dort wieder aufsteigend. Ohne aktive Sortierung bleibt die Reihenfolge
 * der übergebenen Liste erhalten (Default = Backend-Reihenfolge).
 */
export function useTableSort<K extends string, T>(getters: SortGetters<K, T>) {
  const [sort, setSort] = useState<{ key: K; dir: SortDirection } | null>(null);

  /** Klick auf einen Spaltenkopf: gleiche Spalte wechselt die Richtung, andere startet aufsteigend */
  const toggleSort = (key: K) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );

  /** (Gefilterte) Liste sortiert zurückgeben — das Original bleibt unberührt */
  const sorted = (rows: T[]): T[] => {
    if (!sort) return rows;
    const get = getters[sort.key];
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => factor * compareValues(get(a), get(b)));
  };

  /** Pfeil-Icon für einen Spaltenkopf: aktiv auf-/absteigend, sonst neutral */
  const iconFor = (key: K): LucideIcon =>
    sort?.key === key ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  /** true, wenn die Spalte die aktuell aktive Sortierspalte ist */
  const isActive = (key: K) => sort?.key === key;

  return { toggleSort, sorted, iconFor, isActive };
}
