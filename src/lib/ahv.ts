import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../api/router';
import { formatBp, formatCents } from '@/lib/finance';

type AhvDetail = inferRouterOutputs<AppRouter>['pension']['ahvDetail'];
export type AhvWarning = AhvDetail['warnings'][number];

/**
 * Die Hinweise der AHV-Engine kommen als strukturierte Daten vom Server;
 * erst hier werden daraus deutsche Sätze — nur so lassen sich Beträge und
 * Prozente locale-konform formatieren. Gleiches Muster wie `warningText` in
 * `pages/Mortgages.tsx` und `gapText` in `pages/Insurances.tsx`.
 */
export function ahvWarningText(warning: AhvWarning): string {
  switch (warning.kind) {
    case 'contributionGaps':
      return `${warning.missingYears} fehlende Beitragsjahre kürzen die Rente um rund ${formatBp(warning.lostShareBp)} %. Beiträge lassen sich nur fünf Jahre rückwirkend nachzahlen.`;
    case 'noYears':
      return 'Es sind noch keine Beitragsjahre erfasst — die Rente wird mit der Mindestrente gerechnet.';
    case 'noFirstIkYear':
      return 'Ohne erstes IK-Jahr wird die Einkommenssumme nicht aufgewertet. Bei Berufsstart vor 1986 fällt die Rente dadurch zu tief aus.';
    case 'transitionGeneration':
      return `Für Frauen des Jahrgangs ${warning.birthYear} (Übergangsgeneration) gelten günstigere Kürzungssätze beim Vorbezug und ein Rentenzuschlag. Beide hängen vom individuellen Einkommen ab und sind nicht veröffentlicht — hier wird mit den Standardsätzen gerechnet.`;
    case 'cappedByCouple':
      return `Als Ehepaar plafoniert: ${formatCents(warning.uncapped)} gekürzt auf ${formatCents(warning.capped)}. Zusammen dürfen beide Renten 150 % der Maximalrente nicht übersteigen.`;
    case 'belowMinimum':
      return 'Das massgebende Einkommen liegt unter der Grenze für die Mindestrente — es gilt die Mindestrente.';
    case 'noSplittingData':
      return 'Ohne Ehejahre wird keine Einkommensteilung gerechnet. Trage „verheiratet seit" bei den AHV-Angaben ein.';
    case 'earlyWithdrawalNoChildPension':
      return 'Während des Vorbezugs werden keine Kinderrenten ausgerichtet.';
  }
}

/** Warnungen, die als Problem (nicht als Hinweis) gelten */
export function isAhvAlert(warning: AhvWarning): boolean {
  return warning.kind === 'contributionGaps' || warning.kind === 'cappedByCouple';
}
