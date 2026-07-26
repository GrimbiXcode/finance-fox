export * from "./errors";

/* --------------------------------- Währungen ------------------------------- */

/**
 * Die 20 häufigsten Währungen der Welt (inkl. Schweizer Franken).
 * Codes nach ISO 4217, Namen auf Deutsch.
 */
export const CURRENCIES = [
  { code: "EUR", name: "Euro" },
  { code: "USD", name: "US-Dollar" },
  { code: "CHF", name: "Schweizer Franken" },
  { code: "GBP", name: "Britisches Pfund" },
  { code: "JPY", name: "Japanischer Yen" },
  { code: "CNY", name: "Chinesischer Yuan" },
  { code: "CAD", name: "Kanadischer Dollar" },
  { code: "AUD", name: "Australischer Dollar" },
  { code: "HKD", name: "Hongkong-Dollar" },
  { code: "SGD", name: "Singapur-Dollar" },
  { code: "SEK", name: "Schwedische Krone" },
  { code: "NOK", name: "Norwegische Krone" },
  { code: "DKK", name: "Dänische Krone" },
  { code: "INR", name: "Indische Rupie" },
  { code: "BRL", name: "Brasilianischer Real" },
  { code: "MXN", name: "Mexikanischer Peso" },
  { code: "ZAR", name: "Südafrikanischer Rand" },
  { code: "KRW", name: "Südkoreanischer Won" },
  { code: "PLN", name: "Polnischer Zloty" },
  { code: "TRY", name: "Türkische Lira" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [
  CurrencyCode,
  ...CurrencyCode[],
];

export const DEFAULT_CURRENCY: CurrencyCode = "EUR";
