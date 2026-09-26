import type { KeyboardEvent } from 'react';

/**
 * Pfeiltasten für Segment-Schalter mit `role="radio"` (WAI-ARIA Radio
 * Group): links/oben wählt das vorige, rechts/unten das nächste Segment und
 * setzt den Fokus dorthin. Zusammen mit `tabIndex={checked ? 0 : -1}` ist
 * die Gruppe ein einziger Tab-Stopp.
 */
export function radioKeyDown<T>(e: KeyboardEvent<HTMLElement>, values: readonly T[], current: T, onChange: (v: T) => void) {
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (delta === 0) return;
  e.preventDefault();
  const index = values.indexOf(current);
  const next = (index + delta + values.length) % values.length;
  onChange(values[next]);
  const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
  buttons?.[next]?.focus();
}
