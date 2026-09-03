import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { users } from "@db/schema";
import { rawClient } from "./lib/sync/store";
import { syncTable } from "./lib/sync/tables";
import type { SessionUser, TrpcContext } from "./context";
import { SYNC_PROTOCOL_VERSION } from "@contracts/offline";

/**
 * Vorsorgedaten sind privat — mit einer Ausnahme: Bei beidseitig bestätigter
 * Ehepartner-Verknüpfung braucht die AHV-Rechnung die Daten der anderen
 * Person (Einkommensteilung, Plafonierung). Damit das auch offline stimmt,
 * überträgt der Abgleich genau die dafür nötigen Spalten.
 *
 * Diese Datei sichert beide Seiten davon ab: dass nicht zu viel das Haus
 * verlässt, und dass nicht zu wenig ankommt.
 */

const anna: SessionUser = {
  id: 1,
  email: "anna@example.com",
  name: "Anna",
  role: "admin",
  color: "#10b981",
};
const bruno: SessionUser = {
  id: 2,
  email: "bruno@example.com",
  name: "Bruno",
  role: "member",
  color: "#6366f1",
};
/** Dritte Person ohne jede Verknüpfung */
const carla: SessionUser = {
  id: 3,
  email: "carla@example.com",
  name: "Carla",
  role: "member",
  color: "#f59e0b",
};

function callerFor(user: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

async function fillYears(
  user: SessionUser,
  from: number,
  to: number,
  income: number
) {
  const caller = callerFor(user);
  for (let year = from; year <= to; year++) {
    await caller.pension.upsertAhvYear({ year, income });
  }
}

/** Vollständiger Abgleich für ein frisches Gerät dieser Person */
async function pullFor(user: SessionUser) {
  const device = await callerFor(user).sync.claimDevice({});
  return callerFor(user).sync.pull({
    deviceId: device.deviceId,
    since: 0,
    protocolVersion: SYNC_PROTOCOL_VERSION,
  });
}

function rowsOf(
  result: Awaited<ReturnType<typeof pullFor>>,
  entity: string
): Record<string, unknown>[] {
  return result.changes.find(c => c.entity === entity)?.upserts ?? [];
}

async function link(from: SessionUser, to: SessionUser | null) {
  await callerFor(from).pension.setPartner({
    partnerUserId: to ? to.id : null,
  });
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  for (const u of [anna, bruno, carla]) {
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      active: true,
      createdAt: new Date(),
    });
  }
  await callerFor(anna).pension.updateProfile({ birthDate: "1965-03-10" });
  await callerFor(bruno).pension.updateProfile({
    birthDate: "1965-07-20",
    // Bewusst nicht der Schema-Default 65 — nur so fällt auf, wenn die
    // Spalte gar nicht mitreist.
    retirementAge: 63,
  });
  await callerFor(carla).pension.updateProfile({ birthDate: "1970-01-05" });

  // Bruno bekommt bewusst alles, was NICHT übertragen werden darf, gefüllt.
  await callerFor(anna).pension.updateAhv({
    gender: "female",
    firstIkYear: 1986,
    marriedFromYear: 1995,
  });
  await callerFor(bruno).pension.updateAhv({
    gender: "male",
    // 1983 hat einen Aufwertungsfaktor ≠ 1,000 (ab 1986 ist er 1,000 und
    // damit vom fehlenden Wert nicht zu unterscheiden).
    firstIkYear: 1983,
    ahvNumber: "756.1234.5678.97",
    notes: "Brunos private Notiz",
    civilStatus: "married",
    marriedFromYear: 1995,
    expectedMonthlyPension: 240_000,
    contributionYears: 40,
    // Teilvorbezug: Modus, Monate und Anteil wirken je einzeln auf die Rente
    withdrawalMode: "early",
    withdrawalMonths: 12,
    withdrawalSharePct: 50,
  });
  await fillYears(anna, 1990, 2029, 8_000_000);
  await fillYears(bruno, 1990, 2029, 9_000_000);

  /*
   * Brunos Beitragsgeschichte ist absichtlich **ungleichmässig**. Mit lauter
   * gleichen Erwerbsjahren wäre der Test unter seinem eigenen Anspruch
   * geblieben: Fiele eine Spalte aus der Übertragung, ergäbe der
   * Schema-Default („employed", „none", erstes IK-Jahr unbekannt) zufällig
   * dieselbe Rente, und das Loch bliebe unbemerkt. Jede der folgenden Zeilen
   * hängt deshalb an genau einer übertragenen Spalte.
   */
  for (const year of [1983, 1984, 1985]) {
    // Jugendjahre (18–20) — füllen später entstandene Lücken auf
    await callerFor(bruno).pension.upsertAhvYear({
      year,
      income: 3_000_000,
      status: "youth",
    });
  }
  // Beitragslücke: zählt nicht als Beitragsjahr (status)
  await callerFor(bruno).pension.upsertAhvYear({
    year: 1997,
    income: 0,
    status: "gap",
  });
  // Erziehungsgutschriften in den Kinderjahren (parenting_credit)
  await callerFor(bruno).pension.upsertAhvYear({
    year: 1998,
    income: 4_500_000,
    parentingCredit: "full",
  });
  await callerFor(bruno).pension.upsertAhvYear({
    year: 1999,
    income: 4_500_000,
    parentingCredit: "half",
  });
  // Betreuungsgutschriften für einen pflegebedürftigen Angehörigen
  for (const year of [2005, 2006]) {
    await callerFor(bruno).pension.upsertAhvYear({
      year,
      income: 9_000_000,
      careCredit: "full",
    });
  }
  await callerFor(bruno).pension.upsertAhvYear({
    year: 1995,
    income: 9_000_000,
    note: "Brunos Notiz am Jahr",
  });
});

describe("Vorsorgedaten der verknüpften Person", () => {
  it("überträgt ohne Verknüpfung nichts Fremdes", async () => {
    await link(anna, null);
    await link(bruno, null);
    const pulled = await pullFor(anna);
    for (const entity of [
      "pension_profiles",
      "pension_ahv",
      "pension_ahv_years",
    ]) {
      const foreign = rowsOf(pulled, entity).filter(r => r.user_id !== anna.id);
      expect(foreign, entity).toEqual([]);
    }
  });

  it("überträgt bei einseitiger Verknüpfung nichts — die Zustimmung fehlt", async () => {
    await link(anna, bruno);
    await link(bruno, null);
    const pulled = await pullFor(anna);
    const foreign = rowsOf(pulled, "pension_ahv_years").filter(
      r => r.user_id !== anna.id
    );
    expect(foreign).toEqual([]);
    // Und die Oberfläche sagt korrekt „noch nicht bestätigt".
    const detail = await callerFor(anna).pension.ahvDetail({});
    expect(detail.partnerLinked).toBe(false);
    expect(detail.partnerPending).toBe(true);
  });

  it("überträgt bei beidseitiger Verknüpfung die Zeilen der anderen Person", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const pulled = await pullFor(anna);
    const partnerYears = rowsOf(pulled, "pension_ahv_years").filter(
      r => r.user_id === bruno.id
    );
    expect(partnerYears.length).toBeGreaterThan(0);
    expect(
      rowsOf(pulled, "pension_profiles").some(r => r.user_id === bruno.id)
    ).toBe(true);
    expect(
      rowsOf(pulled, "pension_ahv").some(r => r.user_id === bruno.id)
    ).toBe(true);
  });

  it("lässt dabei AHV-Nummer, Notizen und Ehedaten im Heimnetz", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const pulled = await pullFor(anna);

    const partnerAhv = rowsOf(pulled, "pension_ahv").find(
      r => r.user_id === bruno.id
    )!;
    for (const column of [
      "ahv_number",
      "notes",
      "civil_status",
      "married_from_year",
      "married_until_year",
      "expected_monthly_pension",
      "contribution_years",
    ]) {
      expect(partnerAhv, column).not.toHaveProperty(column);
    }
    // Was die Rechnung braucht, ist da:
    expect(partnerAhv.gender).toBe("male");
    expect(partnerAhv.withdrawal_mode).toBe("early");
    expect(partnerAhv.withdrawal_months).toBe(12);
    expect(partnerAhv.withdrawal_share_pct).toBe(50);

    const partnerYear = rowsOf(pulled, "pension_ahv_years").find(
      r => r.user_id === bruno.id && r.year === 1995
    )!;
    expect(partnerYear).not.toHaveProperty("note");
    expect(partnerYear.income).toBe(9_000_000);
  });

  /**
   * Die Spaltenliste ist der eigentliche Datenschutz-Entscheid dieser
   * Funktion, deshalb steht sie hier **ausgeschrieben** und nicht als Schleife
   * über die Registry — sonst prüfte der Test die Registry gegen sich selbst.
   * Verglichen wird der ganze Schlüsselsatz: So fällt beides auf, eine
   * stillschweigend hinzugefügte Spalte ebenso wie eine entfernte.
   */
  it("überträgt exakt die vereinbarten Spalten — nicht mehr, nicht weniger", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const pulled = await pullFor(anna);

    const keysOf = (entity: string) => {
      const row = rowsOf(pulled, entity).find(r => r.user_id === bruno.id)!;
      expect(row, entity).toBeTruthy();
      return Object.keys(row).sort();
    };

    expect(keysOf("pension_profiles")).toEqual([
      "birth_date",
      "created_at",
      "id",
      "partner_user_id",
      "user_id",
    ]);
    expect(keysOf("pension_ahv")).toEqual([
      "first_ik_year",
      "gender",
      "id",
      "user_id",
      "withdrawal_mode",
      "withdrawal_months",
      "withdrawal_share_pct",
    ]);
    expect(keysOf("pension_ahv_years")).toEqual([
      "care_credit",
      "id",
      "income",
      "parenting_credit",
      "status",
      "user_id",
      "year",
    ]);

    /*
     * Brunos Pensionierungsalter steht auf 63, nicht auf dem Schema-Default
     * 65 — es bleibt trotzdem im Heimnetz, weil die AHV-Rechnung es nicht
     * liest. In der Replik steht dafür 65. Genau deshalb darf für eine
     * Partnerzeile keine nicht aufgeführte Spalte gelesen werden.
     */
    const partnerProfile = rowsOf(pulled, "pension_profiles").find(
      r => r.user_id === bruno.id
    )!;
    expect(partnerProfile.partner_user_id).toBe(anna.id);
  });

  it("überträgt die eigenen Zeilen weiterhin vollständig", async () => {
    const pulled = await pullFor(anna);
    const own = rowsOf(pulled, "pension_ahv").find(r => r.user_id === anna.id)!;
    expect(own).toHaveProperty("ahv_number");
    expect(own).toHaveProperty("notes");
    expect(own.married_from_year).toBe(1995);
  });

  it("hält Unbeteiligte draußen", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const pulled = await pullFor(carla);
    for (const entity of [
      "pension_profiles",
      "pension_ahv",
      "pension_ahv_years",
    ]) {
      const foreign = rowsOf(pulled, entity).filter(
        r => r.user_id !== carla.id
      );
      expect(foreign, entity).toEqual([]);
    }
  });

  it("überträgt nichts, wenn die verknüpfte Person deaktiviert ist", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    await getDb()
      .update(users)
      .set({ active: false })
      .where(eq(users.id, bruno.id));
    try {
      const pulled = await pullFor(anna);
      const foreign = rowsOf(pulled, "pension_ahv_years").filter(
        r => r.user_id === bruno.id
      );
      expect(foreign).toEqual([]);
    } finally {
      await getDb()
        .update(users)
        .set({ active: true })
        .where(eq(users.id, bruno.id));
    }
  });

  it("verlangt einen vollständigen Abgleich, wenn die Verknüpfung gelöst wird", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const device = await callerFor(anna).sync.claimDevice({});
    const first = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });

    // Bruno löst die Verknüpfung. Seine Vorsorgezeilen ändern sich dadurch
    // nicht und stehen deshalb in keinem Änderungsprotokoll — nur der
    // vollständige Abgleich holt sie vom Gerät herunter.
    await link(bruno, null);
    const second = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: first.seq,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    expect(second.full).toBe(true);
    const foreign = rowsOf(second, "pension_ahv_years").filter(
      r => r.user_id === bruno.id
    );
    expect(foreign).toEqual([]);
  });

  it("lässt fremde Vorsorgezeilen nicht zurückschreiben", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const device = await callerFor(anna).sync.claimDevice({});
    const brunosAhv = rawClient(getDb())
      .prepare("SELECT * FROM pension_ahv WHERE user_id = ?")
      .get(bruno.id)!;

    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "pension_ahv",
          rowId: String(brunosAhv.id),
          op: "update",
          row: { ...brunosAhv, gender: "female" },
          base: brunosAhv,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(result.outcomes[0].conflict?.kind).toBe("forbidden");
    const after = rawClient(getDb())
      .prepare("SELECT gender FROM pension_ahv WHERE user_id = ?")
      .get(bruno.id);
    expect(after?.gender).toBe("male");

    /*
     * Und die Absage selbst darf nicht zur Hintertür werden: Die Antwort
     * enthält den Serverstand, damit das Gerät seine abgelehnte Fassung
     * korrigieren kann — er muss dieselbe Projektion durchlaufen wie im Pull.
     * Ohne das käme über einen absichtlich unerlaubten Push genau das zurück,
     * was der Abgleich zurückhält.
     */
    const theirs = result.outcomes[0].conflict?.theirs;
    expect(theirs).toBeTruthy();
    expect(theirs).not.toHaveProperty("ahv_number");
    expect(theirs).not.toHaveProperty("notes");
    expect(theirs).not.toHaveProperty("expected_monthly_pension");
    expect(theirs).toHaveProperty("gender", "male");
  });
});

describe("Plafonierung des Ehepaars", () => {
  /**
   * Beide Lücken, die der Plan benannt hat: dass der **Bezugsplan** der
   * anderen Person auf die eigene Rente durchschlägt (deshalb reisen
   * `withdrawal_*` mit), und dass die Gesamtprognose die plafonierte und
   * nicht die ungekürzte Zahl ausweist.
   */
  it("rechnet den Bezugsplan der verknüpften Person in die eigene Rente ein", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const withEarly = await callerFor(anna).pension.ahvDetail({});

    // Bruno schiebt auf statt vorzubeziehen: seine Rente steigt, der
    // gemeinsame Deckel verteilt sich neu — Annas Anteil sinkt.
    await callerFor(bruno).pension.updateAhv({
      withdrawalMode: "deferral",
      withdrawalMonths: 24,
      withdrawalSharePct: 100,
    });
    try {
      const withDeferral = await callerFor(anna).pension.ahvDetail({});
      expect(withDeferral.monthlyPension).toBeLessThan(
        withEarly.monthlyPension
      );
      // Ungekürzt ist Annas Rente unverändert — nur der Deckel wirkt.
      expect(withDeferral.adjustedPensionMonthly).toBe(
        withEarly.adjustedPensionMonthly
      );
    } finally {
      await callerFor(bruno).pension.updateAhv({
        withdrawalMode: "early",
        withdrawalMonths: 12,
        withdrawalSharePct: 50,
      });
    }
  });

  it("weist in der Gesamtprognose die plafonierte Rente aus", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    const detail = await callerFor(anna).pension.ahvDetail({});
    const capped = detail.warnings.find(w => w.kind === "cappedByCouple");
    expect(capped).toBeTruthy();
    expect(detail.monthlyPension).toBeLessThan(detail.adjustedPensionMonthly);

    const forecast = await callerFor(anna).pension.forecast({});
    expect(forecast.ahv.monthlyPension).toBe(detail.monthlyPension);
    expect(forecast.ahv.estimated).toBe(true);
  });
});

describe("Projektion reicht für die Rechnung", () => {
  /**
   * Der wichtigste Test dieser Datei. Die übertragenen Spalten sind eine
   * Auswahl — fehlt darin etwas, das `computeAhv` braucht, rechnet das Gerät
   * still anders als der Server. Deshalb hier die Gegenprobe: dieselbe
   * Rechnung einmal mit den vollständigen Zeilen der anderen Person und
   * einmal mit genau dem, was auf dem Gerät ankommt.
   *
   * Eine einzige der übertragenen Spalten kann diese Gegenprobe nicht
   * abdecken: `gender`. Die Rechnung liest es sehr wohl, aber Bruno ist
   * männlich und das ist zugleich der Rückfallwert (`ahv?.gender ?? "male"`)
   * — die fehlende Spalte ergäbe hier zufällig dasselbe. Bei einer Frau der
   * Übergangsgeneration wäre es das Referenzalter und damit die ganze
   * Beitragsdauer. Sie hängt deshalb am Spalten-Test darüber, der die
   * Schlüsselsätze ausgeschrieben vergleicht.
   */
  it("liefert mit projizierten Partnerzeilen dasselbe Ergebnis", async () => {
    await link(anna, bruno);
    await link(bruno, anna);
    // Beide Vergleichswerte **vor** dem Eingriff holen — sonst verglichen
    // sich unten zwei Läufe über denselben (bereits projizierten) Stand und
    // die Gegenprobe wäre für jede Spaltenliste erfüllt.
    const before = await callerFor(anna).pension.ahvDetail({});
    const forecastBefore = await callerFor(anna).pension.forecast({});
    expect(before.partnerLinked).toBe(true);
    // Nur aussagekräftig, wenn die Partnerdaten das Ergebnis überhaupt
    // verändern — sonst wäre die Gegenprobe unten trivial erfüllt.
    expect(before.warnings.map(w => w.kind)).toContain("cappedByCouple");

    const raw = rawClient(getDb());
    const backup = {
      profile: raw
        .prepare("SELECT * FROM pension_profiles WHERE user_id = ?")
        .get(bruno.id)!,
      ahv: raw
        .prepare("SELECT * FROM pension_ahv WHERE user_id = ?")
        .get(bruno.id)!,
      years: raw
        .prepare("SELECT * FROM pension_ahv_years WHERE user_id = ?")
        .all(bruno.id),
    };

    // Ab hier ist Brunos Datenbestand zerlegt. Der Eingriff gehört deshalb
    // mit in den `try`: Wirft er selbst — etwa weil eine Spalte umbenannt
    // wurde und das INSERT scheitert —, liefe `finally` sonst nie und alle
    // folgenden Tests sähen einen halb zerstörten Bestand.
    try {
      // Brunos Zeilen auf das reduzieren, was ein Gerät bekommt: alles, was
      // nicht in `partnerColumns` steht, fällt auf den Schema-Default zurück.
      replaceWithProjection("pension_profiles", [backup.profile]);
      replaceWithProjection("pension_ahv", [backup.ahv]);
      replaceWithProjection("pension_ahv_years", backup.years);

      const after = await callerFor(anna).pension.ahvDetail({});
      expect(after.monthlyPension).toBe(before.monthlyPension);
      expect(after.partnerLinked).toBe(true);
      expect(after.warnings).toEqual(before.warnings);
      expect(after.income).toEqual(before.income);
      expect(after.duration).toEqual(before.duration);
      // Auch die Gesamtprognose läuft über dieselbe Rechnung.
      const forecastAfter = await callerFor(anna).pension.forecast({});
      expect(forecastAfter.ahv).toEqual(forecastBefore.ahv);
    } finally {
      restore("pension_profiles", [backup.profile]);
      restore("pension_ahv", [backup.ahv]);
      restore("pension_ahv_years", backup.years);
    }
  });
});

/** Zeilen durch ihre Projektion ersetzen (löschen + nur erlaubte Spalten neu) */
function replaceWithProjection(
  entity: string,
  rows: Record<string, unknown>[]
) {
  const table = syncTable(entity)!;
  const scope = table.scope;
  if (scope.kind !== "userOrPartner")
    throw new Error(`${entity} ist nicht userOrPartner`);
  const raw = rawClient(getDb());
  for (const row of rows) {
    raw.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(row.id);
    const columns = scope.partnerColumns.filter(c => c in row);
    raw
      .prepare(
        `INSERT INTO ${entity} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map(c => row[c]));
  }
}

function restore(entity: string, rows: Record<string, unknown>[]) {
  const raw = rawClient(getDb());
  for (const row of rows) {
    const columns = Object.keys(row);
    raw.prepare(`DELETE FROM ${entity} WHERE id = ?`).run(row.id);
    raw
      .prepare(
        `INSERT INTO ${entity} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map(c => row[c]));
  }
}
