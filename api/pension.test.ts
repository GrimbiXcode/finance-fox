import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { getDb, initDb } from "./queries/connection";
import {
  categories,
  goalSources,
  recurring,
  savingsGoals,
  users,
} from "@db/schema";
import { buildSessionCookie } from "./lib/session";
import { computeNet, salaryForMonth } from "./lib/pension/netSalary";
import type { SessionUser, TrpcContext } from "./context";

const admin: SessionUser = {
  id: 1,
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  color: "#10b981",
};
const member: SessionUser = {
  id: 2,
  email: "member@example.com",
  name: "Mitglied",
  role: "member",
  color: "#6366f1",
};
// Dritter Benutzer ohne jegliche Vorsorge-Daten (für „kein Lohn"-Fälle)
const third: SessionUser = {
  id: 3,
  email: "dritter@example.com",
  name: "Dritter",
  role: "member",
  color: "#f59e0b",
};

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

// Anhänge landen im Test in einem Temp-Verzeichnis, nicht im Projekt
let tmpDir = "";
let app: (typeof import("./boot"))["default"];

let sharedAccountId = 0;
let adminPrivateAccountId = 0;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);

function uploadPension(
  cookie: string | null,
  entityType: string,
  entityId: number,
  opts: { body: Buffer; filename?: string; contentType?: string }
) {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "image/png",
  };
  if (cookie) headers.cookie = cookie;
  if (opts.filename) headers["x-filename"] = encodeURIComponent(opts.filename);
  return app.request(
    `/api/pension-attachments?entityType=${entityType}&entityId=${entityId}`,
    { method: "POST", headers, body: opts.body }
  );
}

/** Erster Tag des Folgemonats als YYYY-MM-DD (lokal) — wie im Router */
function firstOfNextMonth(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-fox-pension-"));
  process.env.ATTACHMENTS_DIR = tmpDir;
  // erst jetzt laden, damit initAttachmentsDir() das Temp-Verzeichnis nutzt
  ({ default: app } = await import("./boot"));
  await initDb();

  const db = getDb();
  await db.insert(users).values(
    [admin, member, third].map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      createdAt: new Date(),
    }))
  );

  const adminCaller = callerFor(admin);
  await adminCaller.finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "savings",
    initialBalance: 100000,
    private: false,
  });
  await adminCaller.finance.createAccount({
    name: "Admin-Privat",
    type: "savings",
    initialBalance: 50000,
    private: true,
  });
  const accs = await adminCaller.finance.listAccounts();
  sharedAccountId = accs.find(a => a.name === "Gemeinschaftskonto")!.id;
  adminPrivateAccountId = accs.find(a => a.name === "Admin-Privat")!.id;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Profil (getProfile/updateProfile)", () => {
  it("legt ein Profil an und aktualisiert es partiell", async () => {
    const caller = callerFor(admin);
    expect(await caller.pension.getProfile()).toBeNull();

    // Beim Anlegen ist das Geburtsdatum Pflicht
    await expect(
      caller.pension.updateProfile({ retirementAge: 64 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.pension.updateProfile({
      birthDate: "1990-05-17",
      retirementAge: 65,
    });
    const profile = await caller.pension.getProfile();
    expect(profile?.birthDate).toBe("1990-05-17");
    expect(profile?.retirementAge).toBe(65);
    expect(profile?.country).toBe("CH");

    await caller.pension.updateProfile({ retirementAge: 63 });
    expect((await caller.pension.getProfile())?.retirementAge).toBe(63);

    // Rentenalter ausserhalb 50–75 → BAD_REQUEST
    await expect(
      caller.pension.updateProfile({ retirementAge: 40 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("ist strikt privat — das Mitglied sieht kein fremdes Profil", async () => {
    expect(await callerFor(member).pension.getProfile()).toBeNull();
  });
});

describe("Löhne (salaries)", () => {
  let salaryId = 0;

  it("legt einen Lohn an und lehnt Duplikate mit CONFLICT ab", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addSalary({
      validFrom: "2020-01",
      grossMonthly: 800000,
      note: "Einstiegslohn",
    });
    salaryId = created.id;
    expect(salaryId).toBeGreaterThan(0);

    await expect(
      caller.pension.addSalary({ validFrom: "2020-01", grossMonthly: 1 })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Für diesen Monat ist bereits ein Lohn erfasst.",
    });

    const list = await caller.pension.listSalaries();
    expect(list).toHaveLength(1);
    expect(list[0].grossMonthly).toBe(800000);
  });

  it("aktualisiert partiell und prüft Duplikate beim Verschieben", async () => {
    const caller = callerFor(admin);
    await caller.pension.addSalary({
      validFrom: "2024-06",
      grossMonthly: 850000,
    });
    await caller.pension.updateSalary({ id: salaryId, grossMonthly: 810000 });
    const list = await caller.pension.listSalaries();
    expect(list.find(s => s.id === salaryId)?.grossMonthly).toBe(810000);

    await expect(
      caller.pension.updateSalary({ id: salaryId, validFrom: "2024-06" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("löscht mit Lösch-Eintrag in der Historie", async () => {
    const caller = callerFor(admin);
    const vorher = (await caller.pension.listChanges({ entity: "salary" }))
      .entries.length;
    await caller.pension.deleteSalary({
      id: salaryId,
      comment: "Alter Lohn bereinigt",
    });
    const changes = (await caller.pension.listChanges({ entity: "salary" }))
      .entries;
    expect(changes.length).toBe(vorher + 1);
    const deletion = changes[0];
    expect(deletion.comment).toBe("Alter Lohn bereinigt");
    // Löschung wird strukturiert pro Feld protokolliert (to: "gelöscht")
    const felder = deletion.changes.map(c => c.field);
    expect(felder).toContain("Gültig ab");
    expect(felder).toContain("Bruttolohn");
    expect(deletion.changes.every(c => c.to === "gelöscht")).toBe(true);
    const brutto = deletion.changes.find(c => c.field === "Bruttolohn");
    expect(brutto?.from).toBe(810000);
    expect(
      (await caller.pension.listSalaries()).find(s => s.id === salaryId)
    ).toBeUndefined();
  });

  it("ist strikt privat — Update/Delete fremder Einträge → NOT_FOUND", async () => {
    const fremde = await callerFor(admin).pension.listSalaries();
    const fremdeId = fremde[0].id;
    const memberCaller = callerFor(member);
    expect(await memberCaller.pension.listSalaries()).toHaveLength(0);
    await expect(
      memberCaller.pension.updateSalary({ id: fremdeId, grossMonthly: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      memberCaller.pension.deleteSalary({ id: fremdeId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Abzüge (deductions)", () => {
  it("legt Prozent- und Fixabzüge an und validiert die Werte", async () => {
    const caller = callerFor(admin);
    const pct = await caller.pension.addDeduction({
      name: "AHV/IV/EO",
      mode: "percent",
      value: 530,
    });
    const abs = await caller.pension.addDeduction({
      name: "KK-Prämie",
      mode: "absolute",
      value: 35000,
    });
    expect(pct.id).toBeGreaterThan(0);
    expect(abs.id).toBeGreaterThan(0);

    await expect(
      caller.pension.addDeduction({ name: "X", mode: "percent", value: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.pension.addDeduction({
        name: "X",
        mode: "percent",
        value: 10001,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.pension.addDeduction({ name: "X", mode: "absolute", value: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.pension.addDeduction({ name: "  ", mode: "absolute", value: 5 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validiert Modus/Wert-Kombination auch beim Update", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addDeduction({
      name: "PK-Anteil",
      mode: "absolute",
      value: 50000,
    });
    await expect(
      caller.pension.updateDeduction({
        id: created.id,
        mode: "percent",
        value: 20000,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // unverändert geblieben
    const row = (await caller.pension.listDeductions()).find(
      d => d.id === created.id
    )!;
    expect(row.mode).toBe("absolute");
    expect(row.value).toBe(50000);

    await caller.pension.updateDeduction({ id: created.id, active: false });
    expect(
      (await caller.pension.listDeductions()).find(d => d.id === created.id)
        ?.active
    ).toBe(false);
    await caller.pension.deleteDeduction({ id: created.id });
    expect(
      (await caller.pension.listDeductions()).find(d => d.id === created.id)
    ).toBeUndefined();
  });
});

describe("AHV (getAhv/updateAhv)", () => {
  it("legt AHV-Daten an (upsert) und aktualisiert sie", async () => {
    const caller = callerFor(admin);
    expect(await caller.pension.getAhv()).toBeNull();
    await caller.pension.updateAhv({
      ahvNumber: "756.1234.5678.90",
      contributionYears: 20,
    });
    const ahv = await caller.pension.getAhv();
    expect(ahv?.ahvNumber).toBe("756.1234.5678.90");
    expect(ahv?.contributionYears).toBe(20);

    await caller.pension.updateAhv({ expectedMonthlyPension: 200000 });
    const updated = await caller.pension.getAhv();
    expect(updated?.expectedMonthlyPension).toBe(200000);
    expect(updated?.contributionYears).toBe(20);
    // 1:1 — weiterhin genau eine Zeile
    expect((await caller.pension.getAhv())?.userId).toBe(admin.id);

    await expect(
      caller.pension.updateAhv({ contributionYears: 60 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("schreibt die AHV-Nummer nicht ins Audit-Log", async () => {
    const entries = await callerFor(admin).finance.listAuditLog({
      entity: "pension",
    });
    const ahvEntries = entries.filter(e => e.action.startsWith("pension.ahv"));
    expect(ahvEntries.length).toBeGreaterThan(0);
    for (const e of ahvEntries) {
      expect(e.detail).not.toContain("756");
    }
  });
});

describe("Säule 2 (funds)", () => {
  it("CRUD mit Defaults und Historie nur bei echter Änderung", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addFund({
      name: "PK Arbeitgeber",
      currentCapital: 2500000,
      yearlySavings: 1200000,
    });
    const fund = (await caller.pension.listFunds()).find(
      f => f.id === created.id
    )!;
    expect(fund.kind).toBe("pension_fund");
    expect(fund.conversionRateBp).toBe(680);

    const historieVorher = (
      await caller.pension.listChanges({ entity: "fund" })
    ).entries.length;
    // Update ohne echte Änderung → kein neuer Historien-Eintrag
    await caller.pension.updateFund({
      id: created.id,
      name: "PK Arbeitgeber",
      comment: "nur ein Kommentar",
    });
    expect(
      (await caller.pension.listChanges({ entity: "fund" })).entries.length
    ).toBe(historieVorher);

    await caller.pension.updateFund({
      id: created.id,
      interestRateBp: 125,
      comment: "Zinssatz 2026",
    });
    const changes = (await caller.pension.listChanges({ entity: "fund" }))
      .entries;
    expect(changes.length).toBe(historieVorher + 1);
    expect(changes[0].comment).toBe("Zinssatz 2026");
    expect(changes[0].changes).toEqual([
      { field: "Zinssatz (Bp)", from: 0, to: 125 },
    ]);
  });

  it("ist strikt privat — fremde Vorsorgekonten sind unsichtbar", async () => {
    const adminFunds = await callerFor(admin).pension.listFunds();
    const fremdeId = adminFunds[0].id;
    const memberCaller = callerFor(member);
    expect(await memberCaller.pension.listFunds()).toHaveLength(0);
    await expect(
      memberCaller.pension.updateFund({ id: fremdeId, name: "Hack" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      memberCaller.pension.deleteFund({ id: fremdeId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Säule 3a (pillar3)", () => {
  it("verknüpft ein Konto und liefert Sync-Saldo samt Sparziel-Verpflichtung", async () => {
    const caller = callerFor(admin);
    // Sparziel-Quelle direkt in der DB: 30'000 des Gemeinschaftskontos verplant
    const [goal] = await getDb()
      .insert(savingsGoals)
      .values({ name: "Eigenheim", targetAmount: 5000000, color: "#0ea5e9" })
      .returning({ id: savingsGoals.id });
    await getDb().insert(goalSources).values({
      goalId: goal.id,
      accountId: sharedAccountId,
      mode: "absolute",
      value: 30000,
      createdAt: new Date(),
    });

    const created = await caller.pension.addPillar3({
      name: "Viac 3a",
      institution: "Viac",
      yearlyDeposit: 705600,
      accountId: sharedAccountId,
    });
    const row = (await caller.pension.listPillar3()).find(
      p => p.id === created.id
    )!;
    expect(row.syncedBalance).toBe(100000);
    expect(row.goalCommitment).toBe(30000);
    expect(row.goalNames).toEqual(["Eigenheim"]);
  });

  it("erfordert „view“ auf dem verknüpften Konto", async () => {
    await expect(
      callerFor(member).pension.addPillar3({
        name: "Fremd",
        accountId: adminPrivateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Admin selbst darf verknüpfen
    const created = await callerFor(admin).pension.addPillar3({
      name: "Privat 3a",
      accountId: adminPrivateAccountId,
    });
    expect(created.id).toBeGreaterThan(0);
  });

  it("entfernt die Verknüpfung mit accountId null", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addPillar3({
      name: "Temp 3a",
      currentBalance: 5000,
      accountId: sharedAccountId,
    });
    await caller.pension.updatePillar3({ id: created.id, accountId: null });
    const row = (await caller.pension.listPillar3()).find(
      p => p.id === created.id
    )!;
    expect(row.accountId).toBeNull();
    expect(row.syncedBalance).toBeNull();
    expect(row.goalCommitment).toBeNull();
  });
});

describe("Netto-Berechnung (netSalary)", () => {
  it("findet den gültigen Lohn der Timeline (fix und monatlich)", () => {
    // „Fix": ein einziger Eintrag gilt ab seinem Monat dauerhaft
    expect(
      salaryForMonth(
        [{ validFrom: "2024-01", grossMonthly: 700000 }],
        "2026-05"
      )
    ).toBe(700000);
    // Monatliche Einträge: der letzte mit valid_from ≤ Monat zählt
    const timeline = [
      { validFrom: "2025-01", grossMonthly: 700000 },
      { validFrom: "2025-06", grossMonthly: 750000 },
      { validFrom: "2026-01", grossMonthly: 800000 },
    ];
    expect(salaryForMonth(timeline, "2025-05")).toBe(700000);
    expect(salaryForMonth(timeline, "2025-06")).toBe(750000);
    expect(salaryForMonth(timeline, "2030-12")).toBe(800000);
    // vor dem ersten Eintrag: kein Lohn
    expect(salaryForMonth(timeline, "2024-12")).toBeNull();
  });

  it("rechnet Prozent- und Fixabzüge, inaktive zählen nicht", () => {
    const deductions = [
      { mode: "percent" as const, value: 530, active: true }, // 5,30 %
      { mode: "absolute" as const, value: 35000, active: true },
      { mode: "absolute" as const, value: 999999, active: false },
    ];
    // 800000 − round(800000 × 530/10000) − 35000 = 800000 − 42400 − 35000
    expect(computeNet(800000, deductions)).toBe(722600);
    // Rundung: 333333 × 5,30 % = 17666,649 → 17667
    expect(
      computeNet(333333, [{ mode: "percent", value: 530, active: true }])
    ).toBe(315666);
  });
});

describe("transferNetSalary", () => {
  it("legt eine monatliche wiederkehrende Einnahme mit dem Netto an", async () => {
    const caller = callerFor(member);
    await caller.pension.addSalary({
      validFrom: "2020-01",
      grossMonthly: 800000,
    });
    await caller.pension.addDeduction({
      name: "AHV",
      mode: "percent",
      value: 530,
    });
    await caller.pension.addDeduction({
      name: "KK",
      mode: "absolute",
      value: 35000,
    });

    const result = await caller.pension.transferNetSalary({
      accountId: sharedAccountId,
    });
    expect(result.amount).toBe(722600);
    expect(result.nextDate).toBe(firstOfNextMonth());

    const rows = await getDb()
      .select()
      .from(recurring)
      .where(eq(recurring.id, result.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("income");
    expect(rows[0].interval).toBe("monthly");
    expect(rows[0].note).toBe("Nettolohn (Vorsorge)");
    expect(rows[0].active).toBe(true);
    expect(rows[0].userId).toBe(member.id);
    expect(rows[0].accountId).toBe(sharedAccountId);
  });

  it("prüft Kategorie und lehnt unbekannte ab", async () => {
    const [cat] = await getDb()
      .insert(categories)
      .values({ name: "Lohn", type: "income", color: "#10b981" })
      .returning({ id: categories.id });
    const caller = callerFor(member);
    const ok = await caller.pension.transferNetSalary({
      accountId: sharedAccountId,
      categoryId: cat.id,
    });
    const rows = await getDb()
      .select()
      .from(recurring)
      .where(eq(recurring.id, ok.id));
    expect(rows[0].categoryId).toBe(cat.id);

    await expect(
      caller.pension.transferNetSalary({
        accountId: sharedAccountId,
        categoryId: 999999,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Die angegebene Kategorie existiert nicht.",
    });
  });

  it("erfordert „edit“ auf dem Konto und einen hinterlegten Lohn", async () => {
    // Benutzer ohne Lohn → BAD_REQUEST (Gemeinschaftskonto: edit vorhanden)
    await expect(
      callerFor(third).pension.transferNetSalary({
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Mitglied hat einen Lohn, aber kein Zugriff auf das Privatkonto
    // des Admins → NOT_FOUND (kein Existenz-Leak)
    await expect(
      callerFor(member).pension.transferNetSalary({
        accountId: adminPrivateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Vorsorge-Anhänge (HTTP-Routen)", () => {
  let fundId = 0;

  beforeAll(async () => {
    const created = await callerFor(admin).pension.addFund({
      name: "PK Belege",
    });
    fundId = created.id;
  });

  it("speichert Datei und liefert Metadaten", async () => {
    const res = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      fundId,
      { body: PNG_BYTES, filename: "pk ausweis.png" }
    );
    expect(res.status).toBe(201);
    const meta = (await res.json()) as {
      id: number;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    };
    expect(meta.originalName).toBe("pk ausweis.png");
    expect(meta.mimeType).toBe("image/png");
    expect(meta.sizeBytes).toBe(PNG_BYTES.byteLength);
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
  });

  it("liefert den Anhang inline mit Originalnamen aus", async () => {
    const hochgeladen = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      fundId,
      { body: PNG_BYTES, filename: "download.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    const res = await app.request(`/api/pension-attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain(
      encodeURIComponent("download.png")
    );
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("verweigert Fremdzugriff mit 404 (Upload, Download, Löschen)", async () => {
    // Upload auf fremden Datensatz
    const upload = await uploadPension(
      buildSessionCookie(member.id, false),
      "fund",
      fundId,
      { body: PNG_BYTES }
    );
    expect(upload.status).toBe(404);

    const hochgeladen = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      fundId,
      { body: PNG_BYTES, filename: "privat.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    const download = await app.request(`/api/pension-attachments/${id}`, {
      headers: { cookie: buildSessionCookie(member.id, false) },
    });
    expect(download.status).toBe(404);
    const loeschen = await app.request(`/api/pension-attachments/${id}`, {
      method: "DELETE",
      headers: { cookie: buildSessionCookie(member.id, false) },
    });
    expect(loeschen.status).toBe(404);
    // der Besitzer darf weiterhin
    const alsBesitzer = await app.request(`/api/pension-attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(alsBesitzer.status).toBe(200);
  });

  it("listet Anhänge über pension.listAttachments (nur eigene)", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addFund({ name: "Listen-PK" });
    await uploadPension(buildSessionCookie(admin.id, false), "fund", created.id, {
      body: PNG_BYTES,
      filename: "reglement.png",
    });
    await uploadPension(buildSessionCookie(admin.id, false), "fund", created.id, {
      body: PNG_BYTES,
      filename: "auszug.png",
    });
    const liste = await caller.pension.listAttachments({
      entityType: "fund",
      entityId: created.id,
    });
    expect(liste).toHaveLength(2);
    expect(liste.map(a => a.originalName).sort()).toEqual([
      "auszug.png",
      "reglement.png",
    ]);
    // Fremde sehen nichts
    const fremd = await callerFor(member).pension.listAttachments({
      entityType: "fund",
      entityId: created.id,
    });
    expect(fremd).toHaveLength(0);
  });

  it("validiert entityType, Dateityp und Grösse", async () => {
    const falscherTyp = await uploadPension(
      buildSessionCookie(admin.id, false),
      "profil",
      fundId,
      { body: PNG_BYTES }
    );
    expect(falscherTyp.status).toBe(400);

    const mime = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      fundId,
      { body: Buffer.from("hallo"), contentType: "text/plain" }
    );
    expect(mime.status).toBe(400);

    const gross = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const zuGross = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      fundId,
      { body: gross, filename: "riesig.png" }
    );
    expect(zuGross.status).toBe(413);
  });

  it("löscht Anhänge kaskadierend beim Löschen des Vorsorgekontos", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addFund({ name: "Kaskaden-PK" });
    const hochgeladen = await uploadPension(
      buildSessionCookie(admin.id, false),
      "fund",
      created.id,
      { body: PNG_BYTES, filename: "kaskade.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    const dateienVorher = fs.readdirSync(tmpDir).length;

    await caller.pension.deleteFund({ id: created.id });

    const res = await app.request(`/api/pension-attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(404);
    expect(fs.readdirSync(tmpDir).length).toBe(dateienVorher - 1);
  });

  it("löscht Anhänge kaskadierend beim Löschen eines 3a-Kontos", async () => {
    const caller = callerFor(admin);
    const created = await caller.pension.addPillar3({ name: "Kaskaden-3a" });
    const hochgeladen = await uploadPension(
      buildSessionCookie(admin.id, false),
      "pillar3",
      created.id,
      { body: PNG_BYTES, filename: "3a.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    await caller.pension.deletePillar3({ id: created.id });
    const res = await app.request(`/api/pension-attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(404);
  });
});

describe("Historie (listChanges)", () => {
  it("filtert nach Entität und zeigt Einträge absteigend", async () => {
    const caller = callerFor(admin);
    const alle = (await caller.pension.listChanges({})).entries;
    expect(alle.length).toBeGreaterThan(0);
    const nurFunds = (await caller.pension.listChanges({ entity: "fund" }))
      .entries;
    expect(nurFunds.every(c => c.entity === "fund")).toBe(true);
    expect(nurFunds.length).toBeLessThan(alle.length);
    // absteigend: neueste zuerst
    for (let i = 1; i < alle.length; i++) {
      expect(alle[i - 1].id).toBeGreaterThan(alle[i].id);
    }
    // changes ist geparst (Array von {field, from, to})
    expect(Array.isArray(alle[0].changes)).toBe(true);
  });

  it("paginiert über den Offset-Cursor (total + nextCursor)", async () => {
    const caller = callerFor(admin);
    const ersteSeite = await caller.pension.listChanges({ limit: 2 });
    expect(ersteSeite.entries.length).toBe(2);
    expect(ersteSeite.total).toBeGreaterThan(2);
    expect(ersteSeite.nextCursor).toBe(2);
    const zweiteSeite = await caller.pension.listChanges({
      limit: 2,
      cursor: ersteSeite.nextCursor!,
    });
    expect(zweiteSeite.entries.length).toBeGreaterThan(0);
    // keine Überlappung zwischen den Seiten
    const idsSeite1 = new Set(ersteSeite.entries.map(e => e.id));
    expect(zweiteSeite.entries.every(e => !idsSeite1.has(e.id))).toBe(true);
    // letzte Seite: nextCursor null
    const letzteSeite = await caller.pension.listChanges({
      limit: 100,
      cursor: 0,
    });
    expect(letzteSeite.nextCursor).toBeNull();
    expect(letzteSeite.entries.length).toBe(letzteSeite.total);
  });

  it("ist strikt privat — das Mitglied sieht nur die eigene Historie", async () => {
    const memberChanges = (await callerFor(member).pension.listChanges({}))
      .entries;
    expect(memberChanges.every(c => c.userId === member.id)).toBe(true);
  });
});
