import {
  computeChSchedule,
  type MortgageScheduleInput,
  type MortgageScheduleResult,
} from "./scheduleCh";

/**
 * Factory für die länderabhängige Hypotheken-Berechnung — dasselbe Muster
 * wie bei der Vorsorge (`lib/pension/index.ts`), damit weitere Ländermodelle
 * ergänzt werden können, ohne den Router anzufassen. Derzeit nur Schweiz.
 */
export interface MortgageCalculator {
  schedule(input: MortgageScheduleInput): MortgageScheduleResult;
}

/** Wirft bei einem Land ohne implementierte Berechnung */
export function getMortgageCalculator(country: string): MortgageCalculator {
  if (country === "CH") return { schedule: computeChSchedule };
  throw new Error(
    `Für das Land „${country}“ ist keine Hypotheken-Berechnung verfügbar.`
  );
}

export type { MortgageScheduleInput, MortgageScheduleResult };
