import { describe, expect, it } from "vitest";
import {
  analyzeGaps,
  type GapInput,
  type GapPolicy,
  type InsuranceGap,
} from "./lib/insurance/gaps";

const TODAY = "2026-08-02";
/** Erfassungszeitpunkt weit vor TODAY — nur für das Alter von Angeboten */
const LONG_AGO = new Date(2026, 0, 1).getTime();

const ANNA = { id: 1, name: "Anna" };
const BEN = { id: 2, name: "Ben" };

function policy(over: Partial<GapPolicy> = {}): GapPolicy {
  return {
    id: 1,
    name: "Police",
    branch: "hausrat",
    status: "active",
    premium: 12_000,
    renewal: "auto",
    startDate: "2020-01-01",
    mainDueDate: "2026-12-31",
    endDate: null,
    noticePeriodMonths: 3,
    coverageCount: 2,
    createdAt: LONG_AGO,
    ...over,
  };
}

function input(over: Partial<GapInput> = {}): GapInput {
  return {
    policies: [],
    persons: [ANNA, BEN],
    personLinks: [],
    context: { propertyCount: 0, propertyName: null },
    dismissedKeys: [],
    today: TODAY,
    ...over,
  };
}

/** Alle Hinweise (sichtbar + ausgeblendet) einer Art */
function kinds(gaps: InsuranceGap[]): string[] {
  return gaps.map(g => g.kind);
}

describe("Personenbezogene Sparten", () => {
  it("meldet jede Person ohne Krankenversicherung", () => {
    const { gaps } = analyzeGaps(input());
    const missing = gaps.filter(
      g => g.kind === "missing_person" && g.branch === "krankenkasse_grund"
    );
    expect(missing).toHaveLength(2);
    expect(missing.map(g => g.key)).toEqual([
      "branch:krankenkasse_grund:person:1",
      "branch:krankenkasse_grund:person:2",
    ]);
  });

  it("wertet eine Police ohne Personen-Links als Deckung für alle", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [policy({ branch: "krankenkasse_grund" })],
        personLinks: [],
      })
    );
    expect(
      gaps.filter(
        g => g.kind === "missing_person" && g.branch === "krankenkasse_grund"
      )
    ).toHaveLength(0);
  });

  it("deckt mit einer personenbezogenen Police nur diese Person", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [policy({ id: 7, branch: "krankenkasse_grund" })],
        personLinks: [{ policyId: 7, userId: ANNA.id }],
      })
    );
    const missing = gaps.filter(
      g => g.kind === "missing_person" && g.branch === "krankenkasse_grund"
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ personId: BEN.id, personName: "Ben" });
  });

  it("berücksichtigt deaktivierte Mitglieder nicht", () => {
    // Der Aufrufer übergibt nur aktive Personen — Ben fehlt hier bewusst.
    const { gaps } = analyzeGaps(input({ persons: [ANNA] }));
    expect(
      gaps.filter(
        g => g.kind === "missing_person" && g.branch === "krankenkasse_grund"
      )
    ).toHaveLength(1);
  });
});

describe("Haushaltsweite Sparten", () => {
  it("meldet fehlende Privathaftpflicht und Hausrat als Warnung", () => {
    const { gaps } = analyzeGaps(input());
    const household = gaps.filter(g => g.kind === "missing_household");
    expect(household.map(g => g.branch)).toEqual(
      expect.arrayContaining(["privathaftpflicht", "hausrat", "rechtsschutz"])
    );
    const haftpflicht = household.find(g => g.branch === "privathaftpflicht");
    expect(haftpflicht?.severity).toBe("warn");
    expect(
      household.find(g => g.branch === "rechtsschutz")?.severity
    ).toBe("info");
  });

  it("schweigt, sobald eine deckende Police existiert", () => {
    const { gaps } = analyzeGaps(
      input({ policies: [policy({ branch: "privathaftpflicht" })] })
    );
    expect(
      gaps.filter(
        g => g.kind === "missing_household" && g.branch === "privathaftpflicht"
      )
    ).toHaveLength(0);
  });

  it("lässt ein Angebot nie als Deckung gelten", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [policy({ branch: "privathaftpflicht", status: "quote" })],
      })
    );
    expect(
      gaps.filter(
        g => g.kind === "missing_household" && g.branch === "privathaftpflicht"
      )
    ).toHaveLength(1);
  });

  it("lässt eine abgelaufene Police nie als Deckung gelten", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [policy({ branch: "privathaftpflicht", status: "expired" })],
      })
    );
    expect(
      gaps.filter(
        g => g.kind === "missing_household" && g.branch === "privathaftpflicht"
      )
    ).toHaveLength(1);
  });
});

describe("Gekündigt ist nicht ungedeckt", () => {
  it("lässt eine gekündigte Police bis zum Endtermin decken", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({
            branch: "privathaftpflicht",
            status: "cancelled",
            endDate: "2027-06-30",
          }),
        ],
      })
    );
    expect(
      gaps.filter(
        g => g.kind === "missing_household" && g.branch === "privathaftpflicht"
      )
    ).toHaveLength(0);
  });

  it("meldet stattdessen die auslaufende Deckung ohne Nachfolge", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({
            branch: "privathaftpflicht",
            status: "cancelled",
            endDate: "2026-08-20",
          }),
        ],
      })
    );
    const ending = gaps.find(g => g.kind === "coverage_ending");
    expect(ending).toMatchObject({
      endDate: "2026-08-20",
      days: 18,
      severity: "warn",
      dismissible: false,
    });
  });

  it("schweigt, wenn eine Nachfolge-Police der Sparte existiert", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({
            id: 1,
            branch: "privathaftpflicht",
            status: "cancelled",
            endDate: "2026-08-20",
          }),
          policy({ id: 2, branch: "privathaftpflicht", endDate: null }),
        ],
      })
    );
    expect(kinds(gaps)).not.toContain("coverage_ending");
  });
});

describe("Cross-Modul: Wohneigentum", () => {
  it("schweigt ohne erfasste Liegenschaft", () => {
    const { gaps } = analyzeGaps(input());
    expect(kinds(gaps)).not.toContain("missing_building");
  });

  it("meldet die fehlende Gebäudeversicherung mit Objektnamen", () => {
    const { gaps } = analyzeGaps(
      input({ context: { propertyCount: 1, propertyName: "Haus Bergstrasse" } })
    );
    const gap = gaps.find(g => g.kind === "missing_building");
    expect(gap).toMatchObject({
      key: "branch:gebaeude",
      severity: "warn",
      propertyName: "Haus Bergstrasse",
      propertyCount: 1,
    });
  });

  it("schweigt bei vorhandener Gebäudepolice", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [policy({ branch: "gebaeude" })],
        context: { propertyCount: 1, propertyName: "Haus" },
      })
    );
    expect(kinds(gaps)).not.toContain("missing_building");
  });
});

describe("Fristen und Datenqualität", () => {
  it("erinnert an eine näher rückende Kündigungsfrist", () => {
    // Hauptverfall 2026-10-15, Frist 2 Monate → cancelBy 2026-08-15
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({ mainDueDate: "2026-10-15", noticePeriodMonths: 2 }),
        ],
      })
    );
    expect(gaps.find(g => g.kind === "notice_soon")).toMatchObject({
      cancelBy: "2026-08-15",
      days: 13,
      severity: "warn",
    });
  });

  it("meldet eine verstrichene Frist samt nächster Möglichkeit", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({ mainDueDate: "2026-10-01", noticePeriodMonths: 3 }),
        ],
      })
    );
    expect(gaps.find(g => g.kind === "notice_missed")).toMatchObject({
      dueDate: "2026-10-01",
      nextCancelBy: "2027-07-01",
    });
  });

  it("meldet befristete Policen ohne Vertragsende", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({ renewal: "fixed", mainDueDate: null, endDate: null }),
        ],
      })
    );
    expect(kinds(gaps)).toContain("no_end_date");
  });

  it("meldet fehlende Prämie und fehlende Deckungen", () => {
    const { gaps } = analyzeGaps(
      input({ policies: [policy({ premium: 0, coverageCount: 0 })] })
    );
    expect(kinds(gaps)).toEqual(
      expect.arrayContaining(["no_premium", "no_coverage"])
    );
  });

  it("meldet vergessene Angebote nach 60 Tagen", () => {
    const { gaps } = analyzeGaps(
      input({ policies: [policy({ status: "quote", createdAt: LONG_AGO })] })
    );
    expect(gaps.find(g => g.kind === "quote_pending")).toMatchObject({
      days: 213,
    });
  });

  it("schweigt bei frischen Angeboten", () => {
    const recent = new Date(2026, 6, 20).getTime(); // 2026-07-20
    const { gaps } = analyzeGaps(
      input({ policies: [policy({ status: "quote", createdAt: recent })] })
    );
    expect(kinds(gaps)).not.toContain("quote_pending");
  });

  it("prüft die Datenqualität nur bei aktiven Policen", () => {
    const { gaps } = analyzeGaps(
      input({
        policies: [
          policy({ status: "expired", premium: 0, coverageCount: 0 }),
        ],
      })
    );
    expect(kinds(gaps)).not.toContain("no_premium");
    expect(kinds(gaps)).not.toContain("no_coverage");
  });
});

describe("Ausblenden und Sortierung", () => {
  it("verschiebt ausgeblendete Hinweise, statt sie zu verlieren", () => {
    const full = analyzeGaps(input());
    const dismissedKey = "branch:privathaftpflicht";
    const after = analyzeGaps(input({ dismissedKeys: [dismissedKey] }));

    expect(after.gaps.map(g => g.key)).not.toContain(dismissedKey);
    expect(after.dismissed.map(g => g.key)).toContain(dismissedKey);
    expect(after.gaps.length + after.dismissed.length).toBe(full.gaps.length);
  });

  it("hält die Schlüssel beim Umbenennen einer Police stabil", () => {
    const before = analyzeGaps(
      input({ policies: [policy({ id: 4, premium: 0, name: "Alt" })] })
    );
    const after = analyzeGaps(
      input({ policies: [policy({ id: 4, premium: 0, name: "Neu" })] })
    );
    expect(after.gaps.map(g => g.key)).toEqual(before.gaps.map(g => g.key));
  });

  it("sortiert Warnungen vor Hinweise", () => {
    const { gaps } = analyzeGaps(input());
    const firstInfo = gaps.findIndex(g => g.severity === "info");
    const lastWarn = gaps.map(g => g.severity).lastIndexOf("warn");
    expect(lastWarn).toBeLessThan(firstInfo);
  });

  it("liefert bei gleicher Eingabe dieselbe Reihenfolge", () => {
    const a = analyzeGaps(input());
    const b = analyzeGaps(input());
    expect(a.gaps.map(g => g.key)).toEqual(b.gaps.map(g => g.key));
  });
});
