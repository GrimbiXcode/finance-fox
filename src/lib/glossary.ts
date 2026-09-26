/**
 * Fachbegriffe, kurz erklärt (A8) — Satz, Formel, Beispiel. Die Texte
 * stehen zentral, damit derselbe Begriff überall gleich erklärt wird.
 * Beispielbeträge ohne Währung und mit Leerzeichen als Tausendertrenner,
 * weil die Texte fest sind und nicht der Browser-Region folgen.
 */
export interface GlossaryEntry {
  term: string;
  text: string;
  formula?: string;
  example?: string;
}

export const GLOSSARY = {
  sparrate: {
    term: 'Sparrate',
    text: 'Was vom Einkommen eines Monats übrig bleibt — Einnahmen minus Ausgaben. Umbuchungen (z. B. aufs Sparkonto) zählen nicht, sie verschieben Geld nur.',
    formula: 'Einnahmen − Ausgaben',
    example: 'Einnahmen 6000, Ausgaben 4500 → Sparrate 1500 (25 % der Einnahmen)',
  },
  sparquote: {
    term: 'Sparquote',
    text: 'Die Sparrate als Anteil der Einnahmen. Monate ohne Einnahmen haben keine Sparquote.',
    formula: '(Einnahmen − Ausgaben) ÷ Einnahmen',
    example: '1500 ÷ 6000 = 25 %',
  },
  rollover: {
    term: 'Rollover (Budget-Übertrag)',
    text: 'Was von einem Monatsbudget übrig bleibt, erhöht das Budget des Folgemonats; eine Überschreitung verringert es (nie unter 0). Der Übertrag sammelt sich innerhalb des Kalenderjahres und beginnt im Januar neu.',
    example: 'Budget 400, im März 350 ausgegeben → im April 450 verfügbar',
  },
  belehnung: {
    term: 'Belehnung',
    text: 'Wie viel der Liegenschaft über Hypotheken finanziert ist. Banken finanzieren meist höchstens 80 %; der Teil über der 1. Hypothek (meist 66⅔ %) ist die 2. Hypothek und muss amortisiert werden.',
    formula: 'Restschuld ÷ Verkehrswert',
    example: '800 000 ÷ 1 000 000 = 80 %',
  },
  tragbarkeit: {
    term: 'Tragbarkeit',
    text: 'Ob die Wohnkosten zum Einkommen passen. Gerechnet wird mit einem kalkulatorischen Zins (oft 5 %) statt dem tatsächlichen — damit die Rechnung auch bei steigenden Zinsen hält — plus Unterhalt (ein Prozentsatz des Verkehrswerts) und der nötigen Amortisation.',
    formula: '(kalk. Zins + Unterhalt + nötige Amortisation) ÷ Bruttojahreseinkommen ≤ 33 %',
    example: '(40 000 + 10 000 + 10 000) ÷ 180 000 = 33 %',
  },
  pflichtAmortisation: {
    term: 'Pflicht-Amortisation',
    text: 'Die 2. Hypothek (der Teil über der Grenze der 1. Hypothek, meist 66⅔ % Belehnung) muss innert der eingestellten Frist — meist 15 Jahre, spätestens bis zur Pensionierung — abbezahlt werden: direkt oder indirekt über die Säule 3a.',
  },
  ersatzrate: {
    term: 'Ersatzrate',
    text: 'Wie viel des heutigen Einkommens die Renten im Alter ersetzen. Als Faustregel braucht man 60–80 %, um den Lebensstandard zu halten.',
    formula: 'Renten im Alter ÷ heutiges Nettoeinkommen',
  },
  rentenskala: {
    term: 'Rentenskala (AHV)',
    text: 'Die AHV-Rente hängt von den Beitragsjahren ab: Vollrente mit 44 Jahren (Skala 44/44), jedes fehlende Jahr kürzt sie um rund 1/44.',
    example: '42 Beitragsjahre → Skala 42/44 ≈ 95 % der Vollrente',
  },
  offenesZiel: {
    term: 'Offenes Ziel',
    text: 'Ein Sparziel ohne Zielbetrag — es sammelt nur, was zusammenkommt (z. B. „Notgroschen“). Ohne Zielbetrag gibt es keinen Prozentwert und keine Prognose.',
  },
  hauptverfall: {
    term: 'Hauptverfall',
    text: 'Der Stichtag, an dem sich eine Police verlängert, wenn sie nicht gekündigt wurde — meist einmal im Jahr.',
  },
  kuendigungsfrist: {
    term: 'Kündigungsfrist',
    text: 'Wie lange vor dem Hauptverfall die Kündigung beim Versicherer sein muss. Verpasst man sie, läuft die Police ein weiteres Jahr.',
    example: 'Hauptverfall 1.1., Frist 3 Monate → Kündigung bis 30.9.',
  },
  fixkosten: {
    term: 'Fixkosten',
    text: 'Ausgaben, die als Dauerbuchung regelmäßig anfallen (Miete, Versicherungen, Abos) — auf einen Monat umgerechnet. Sparen wirkt hier nur durch Kündigen oder Neuverhandeln.',
    formula: 'wöchentlich × 52 ÷ 12, vierteljährlich ÷ 3, halbjährlich ÷ 6, jährlich ÷ 12',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
