import {
  computeChForecast,
  type ChForecastInput,
  type PensionForecastResult,
} from "./forecastCh";

/**
 * Factory für die länderabhängige Vorsorge-Prognose — das Modul bleibt so
 * für spätere Länder erweiterbar (derzeit nur Schweiz, 3-Säulen-Prinzip).
 */
export interface PensionCalculator {
  forecast(input: ChForecastInput): PensionForecastResult;
}

/** Wirft bei einem Land ohne implementierte Prognose-Engine */
export function getPensionCalculator(country: string): PensionCalculator {
  if (country === "CH") return { forecast: computeChForecast };
  throw new Error(
    `Für das Land „${country}“ ist keine Vorsorge-Prognose verfügbar.`
  );
}
