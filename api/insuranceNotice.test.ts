import { describe, expect, it } from "vitest";
import {
  addYears,
  computeNotice,
  subMonths,
  type NoticeInput,
} from "./lib/insurance/notice";

/** Fixes „heute" wie in mortgageSchedule.test.ts — keine Systemzeit-Abhängigkeit */
const TODAY = "2026-08-02";

function policy(over: Partial<NoticeInput> = {}): NoticeInput {
  return {
    status: "active",
    renewal: "auto",
    startDate: "2020-01-01",
    mainDueDate: "2026-12-31",
    endDate: null,
    noticePeriodMonths: 3,
    ...over,
  };
}

describe("Datums-Helfer mit Klemmung", () => {
  it("klemmt beim Monatsabzug auf den Monatsletzten", () => {
    expect(subMonths("2026-12-31", 3)).toBe("2026-09-30");
    expect(subMonths("2026-03-31", 1)).toBe("2026-02-28");
  });

  it("berücksichtigt Schaltjahre beim Monatsabzug", () => {
    expect(subMonths("2028-03-31", 1)).toBe("2028-02-29");
  });

  it("rechnet über Jahresgrenzen zurück", () => {
    expect(subMonths("2026-02-15", 3)).toBe("2025-11-15");
    expect(subMonths("2026-01-31", 13)).toBe("2024-12-31");
  });

  it("klemmt den Schalttag beim Jahresschritt", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("lässt subMonths mit 0 Monaten unverändert", () => {
    expect(subMonths("2026-12-31", 0)).toBe("2026-12-31");
  });
});

describe("Kündigungsfrist befristeter Verträge", () => {
  it("rechnet die Frist vom Vertragsende zurück", () => {
    const n = computeNotice(
      policy({ renewal: "fixed", mainDueDate: null, endDate: "2026-12-31" }),
      TODAY
    );
    expect(n.dueDate).toBe("2026-12-31");
    expect(n.cancelBy).toBe("2026-09-30");
    expect(n.cancelByDueDate).toBe("2026-12-31");
    expect(n.currentPeriodMissed).toBe(false);
    expect(n.recurring).toBe(false);
  });

  it("rollt eine verpasste Frist nicht vor — es gibt keine zweite Chance", () => {
    const n = computeNotice(
      policy({
        renewal: "fixed",
        mainDueDate: null,
        endDate: "2026-09-30",
        noticePeriodMonths: 3,
      }),
      TODAY
    );
    expect(n.dueDate).toBe("2026-09-30");
    expect(n.cancelBy).toBeNull();
    expect(n.currentPeriodMissed).toBe(true);
  });

  it("liefert ohne Vertragsende gar nichts", () => {
    const n = computeNotice(
      policy({ renewal: "fixed", mainDueDate: null, endDate: null }),
      TODAY
    );
    expect(n).toMatchObject({ dueDate: null, cancelBy: null });
  });
});

describe("Kündigungsfrist bei automatischer Verlängerung", () => {
  it("rollt den Hauptverfall über mehrere Jahre bis heute vor", () => {
    const n = computeNotice(policy({ mainDueDate: "2020-12-31" }), TODAY);
    expect(n.dueDate).toBe("2026-12-31");
    expect(n.cancelBy).toBe("2026-09-30");
    expect(n.recurring).toBe(true);
  });

  it("nimmt ohne Hauptverfall den Jahrestag des Vertragsbeginns", () => {
    // 2026-04-15 ist vorbei → nächster Termin ist 2027-04-15
    const n = computeNotice(
      policy({ mainDueDate: null, startDate: "2019-04-15" }),
      TODAY
    );
    expect(n.dueDate).toBe("2027-04-15");
    expect(n.cancelBy).toBe("2027-01-15");
  });

  it("zeigt bei verstrichener Frist auf den Folgejahres-Termin", () => {
    // Hauptverfall 2026-10-01, Frist 3 Monate → 2026-07-01 ist durch
    const n = computeNotice(
      policy({ mainDueDate: "2026-10-01", noticePeriodMonths: 3 }),
      TODAY
    );
    expect(n.dueDate).toBe("2026-10-01");
    expect(n.currentPeriodMissed).toBe(true);
    expect(n.cancelByDueDate).toBe("2027-10-01");
    expect(n.cancelBy).toBe("2027-07-01");
  });

  it("wertet einen Hauptverfall von heute als heutigen Termin", () => {
    const n = computeNotice(
      policy({ mainDueDate: TODAY, noticePeriodMonths: 0 }),
      TODAY
    );
    expect(n.dueDate).toBe(TODAY);
    expect(n.daysUntilDue).toBe(0);
  });

  it("macht ohne Kündigungsfrist den Termin selbst zur Frist", () => {
    const n = computeNotice(policy({ noticePeriodMonths: 0 }), TODAY);
    expect(n.cancelBy).toBe("2026-12-31");
    expect(n.cancelBy).toBe(n.dueDate);
  });

  it("liefert die Restlaufzeit in Tagen", () => {
    const n = computeNotice(policy({ mainDueDate: "2026-12-31" }), TODAY);
    expect(n.daysUntilCancel).toBe(59); // 2026-08-02 → 2026-09-30
    expect(n.daysUntilDue).toBe(151);
  });
});

describe("Status-Gates", () => {
  it("gibt Angeboten keine Fristen", () => {
    const n = computeNotice(policy({ status: "quote" }), TODAY);
    expect(n).toMatchObject({
      dueDate: null,
      cancelBy: null,
      currentPeriodMissed: false,
    });
  });

  it("gibt abgelaufenen Policen keine Fristen", () => {
    const n = computeNotice(policy({ status: "expired" }), TODAY);
    expect(n).toMatchObject({ dueDate: null, cancelBy: null });
  });

  it("zeigt bei gekündigten Policen nur noch den Endtermin", () => {
    const n = computeNotice(
      policy({ status: "cancelled", endDate: "2026-12-31" }),
      TODAY
    );
    expect(n.dueDate).toBe("2026-12-31");
    expect(n.cancelBy).toBeNull();
  });
});
