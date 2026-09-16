import { HATCHES } from "@/lib/chartTheme";

/**
 * Schraffur-Definitionen für recharts-Flächen. Als `{chartDefs()}` direkt in
 * das Chart setzen – bewusst ein Funktionsaufruf, keine Komponente: recharts
 * reicht nur rohe SVG-Elemente als Kinder durch und verwirft eigene
 * Komponenten stillschweigend. Auf der Fläche dann `fill={hatch('positive')}`.
 */
export function chartDefs() {
  return (
    <defs>
      {HATCHES.map(([name, color, angle]) => (
        <pattern
          key={name}
          id={`hatch-${name}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${angle})`}
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="1" />
        </pattern>
      ))}
    </defs>
  );
}
