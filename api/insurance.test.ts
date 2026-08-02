import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import {
  auditLog,
  insuranceAttachments,
  insurancePolicies,
  users,
} from "@db/schema";
import { saveInsuranceAttachment } from "./lib/attachments";
import { notifyNoticeDeadlines } from "./lib/insurance/noticeReminder";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Versicherungs-Modul: CRUD, Deckungen, Kontorechte, Übernahme als
 * Dauerbuchung, Lückenanalyse und Erinnerung. Wie die Hypotheken ist das
 * Modul haushaltsweit — ein zweites Mitglied muss dieselben Policen sehen.
 */

// Anhänge in ein Temp-Verzeichnis, damit der Datei-Test nichts anfasst
process.env.ATTACHMENTS_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "ff-insurance-")
);

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

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let sharedAccountId = 0;
let adminPrivateAccountId = 0;

async function newPolicy(over: Record<string, unknown> = {}): Promise<number> {
  const res = await callerFor(admin).insurance.addPolicy({
    name: `Police ${Math.random().toString(36).slice(2, 8)}`,
    branch: "hausrat",
    startDate: "2024-01-01",
    premium: 24_000,
    premiumInterval: "yearly",
    ...over,
  });
  return res.id;
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  const db = getDb();
  await db.insert(users).values(
    [admin, member].map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      color: u.color,
      createdAt: new Date(),
    }))
  );
  await callerFor(admin).finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "checking",
    initialBalance: 5_000_000,
    private: false,
  });
  await callerFor(admin).finance.createAccount({
    name: "Admin-Privat",
    type: "savings",
    initialBalance: 1_000_000,
    private: true,
  });
  const accs = await callerFor(admin).finance.listAccounts();
  sharedAccountId = accs.find(a => a.name === "Gemeinschaftskonto")!.id;
  adminPrivateAccountId = accs.find(a => a.name === "Admin-Privat")!.id;
});

describe("Policen", () => {
  it("legt eine Police an und liefert abgeleitete Kennzahlen", async () => {
    const id = await newPolicy({
      name: "Hausrat Zürich",
      premium: 12_000,
      premiumInterval: "quarterly",
      deductible: 20_000,
    });
    const list = await callerFor(admin).insurance.listPolicies();
    const row = list.find(p => p.id === id)!;
    expect(row.name).toBe("Hausrat Zürich");
    expect(row.premiumMonthly).toBe(4_000); // 120.00 / 3 Monate
    expect(row.premiumYearly).toBe(48_000);
    expect(row.deductible).toBe(20_000);
    expect(row.personIds).toEqual([]);
    expect(row.coverageCount).toBe(0);
  });

  it("ist haushaltsweit sichtbar — auch für andere Mitglieder", async () => {
    const id = await newPolicy({ name: "Gemeinsame Police" });
    const list = await callerFor(member).insurance.listPolicies();
    expect(list.some(p => p.id === id)).toBe(true);
  });

  it("verlangt eine Anmeldung", async () => {
    await expect(
      callerFor(undefined).insurance.listPolicies()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("unterscheidet Selbstbehalt 0 von „nicht erfasst“", async () => {
    const withZero = await newPolicy({ deductible: 0 });
    const without = await newPolicy({});
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === withZero)!.deductible).toBe(0);
    expect(list.find(p => p.id === without)!.deductible).toBeNull();
  });

  it("weist ein Vertragsende vor dem Beginn zurück", async () => {
    await expect(
      callerFor(admin).insurance.addPolicy({
        name: "Kaputt",
        branch: "reise",
        startDate: "2026-05-01",
        endDate: "2026-04-01",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("löscht den Hauptverfall bei befristeten Verträgen", async () => {
    const id = await newPolicy({
      branch: "reise",
      renewal: "fixed",
      mainDueDate: "2026-12-31",
      endDate: "2026-12-31",
    });
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.mainDueDate).toBeNull();
  });

  it("berechnet die Kündigungsfrist für die Anzeige mit", async () => {
    const id = await newPolicy({
      mainDueDate: "2099-12-31",
      noticePeriodMonths: 3,
    });
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.notice.cancelBy).toBe("2099-09-30");
  });
});

describe("Versicherte Personen", () => {
  it("speichert die Zuordnung und ersetzt sie beim Update", async () => {
    const id = await newPolicy({ personIds: [admin.id] });
    let list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.personIds).toEqual([admin.id]);

    await callerFor(admin).insurance.updatePolicy({
      id,
      personIds: [admin.id, member.id],
    });
    list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.personIds).toEqual([
      admin.id,
      member.id,
    ]);

    // Leere Liste = gemeinsame Police
    await callerFor(admin).insurance.updatePolicy({ id, personIds: [] });
    list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.personIds).toEqual([]);
  });

  it("lässt die Zuordnung unverändert, wenn personIds fehlt", async () => {
    const id = await newPolicy({ personIds: [member.id] });
    await callerFor(admin).insurance.updatePolicy({ id, name: "Umbenannt" });
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.personIds).toEqual([member.id]);
  });

  it("weist unbekannte Personen zurück", async () => {
    await expect(
      callerFor(admin).insurance.addPolicy({
        name: "Geisterperson",
        branch: "hausrat",
        startDate: "2024-01-01",
        personIds: [9999],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("schreibt die Personen als Kurzform in die Historie", async () => {
    const id = await newPolicy({ name: "Historie-Police" });
    await callerFor(admin).insurance.updatePolicy({
      id,
      personIds: [admin.id],
    });
    const { entries } = await callerFor(admin).insurance.listChanges({
      entity: "policy",
    });
    const entry = entries.find(e => e.entityId === id)!;
    const field = entry.changes.find(c => c.field === "Versicherte Personen")!;
    expect(field.from).toBe("Gemeinsam");
    expect(field.to).toBe("Admin");
  });
});

describe("Deckungen", () => {
  it("legt Deckungen an und zählt sie auf der Police", async () => {
    const policyId = await newPolicy();
    await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Feuer & Elementar",
      sumInsured: 10_000_000,
    });
    await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Diebstahl zu Hause",
      sumInsured: 2_000_000,
      deductible: 20_000,
    });

    const coverages = await callerFor(member).insurance.listCoverages({
      policyId,
    });
    expect(coverages).toHaveLength(2);
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === policyId)!.coverageCount).toBe(2);
  });

  it("behält NULL als „unbegrenzt“ bei", async () => {
    const policyId = await newPolicy();
    const { id } = await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Heilungskosten Ausland",
      sumInsured: null,
    });
    const [row] = await callerFor(admin).insurance.listCoverages({ policyId });
    expect(row.id).toBe(id);
    expect(row.sumInsured).toBeNull();
  });

  it("schreibt „unbegrenzt“ statt „—“ in die Historie", async () => {
    const policyId = await newPolicy();
    const { id } = await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Assistance",
      sumInsured: 500_000,
    });
    await callerFor(admin).insurance.updateCoverage({ id, sumInsured: null });

    const { entries } = await callerFor(admin).insurance.listChanges({
      entity: "coverage",
    });
    const entry = entries.find(e => e.entityId === id)!;
    const field = entry.changes.find(c => c.field === "Deckungssumme")!;
    expect(field.from).toBe(500_000);
    expect(field.to).toBe("unbegrenzt");
  });

  it("löscht Deckungen", async () => {
    const policyId = await newPolicy();
    const { id } = await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Weg damit",
    });
    await callerFor(admin).insurance.deleteCoverage({ id });
    expect(
      await callerFor(admin).insurance.listCoverages({ policyId })
    ).toHaveLength(0);
  });
});

describe("Kontorechte", () => {
  it("lehnt ein fremdes Privatkonto als Belastungskonto ab", async () => {
    await expect(
      callerFor(member).insurance.addPolicy({
        name: "Fremdes Konto",
        branch: "hausrat",
        startDate: "2024-01-01",
        accountId: adminPrivateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lässt Admins private Konten referenzieren (Verwaltungsübersicht)", async () => {
    // accessLevelFor gibt Admins „view" auf fremde Privatkonten — für eine
    // reine Referenz genügt das, wie beim 3a-Link und der Amortisation.
    const id = await newPolicy({ accountId: adminPrivateAccountId });
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.accountName).toBe("Admin-Privat");
  });

  it("verlangt für die Übernahme als Dauerbuchung Bearbeiten-Rechte", async () => {
    const id = await newPolicy({ premium: 5_000 });
    await expect(
      callerFor(member).insurance.transferPremiumToRecurring({
        policyId: id,
        accountId: adminPrivateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("erlaubt das Gemeinschaftskonto", async () => {
    const id = await newPolicy({ accountId: sharedAccountId });
    const list = await callerFor(member).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.accountName).toBe("Gemeinschaftskonto");
  });
});

describe("Löschen räumt auf", () => {
  it("entfernt Deckungen, Personen und Dokumente samt Datei", async () => {
    const policyId = await newPolicy({ personIds: [admin.id] });
    await callerFor(admin).insurance.addCoverage({
      policyId,
      label: "Irgendwas",
    });
    const meta = await saveInsuranceAttachment(
      getDb(),
      policyId,
      new Uint8Array([1, 2, 3]),
      "police.pdf",
      "application/pdf"
    );
    const db = getDb();
    const stored = (await db.query.insuranceAttachments.findFirst({
      where: eq(insuranceAttachments.id, meta.id),
    }))!.storedName;
    const filePath = path.join(process.env.ATTACHMENTS_DIR!, stored);
    expect(fs.existsSync(filePath)).toBe(true);

    await callerFor(admin).insurance.deletePolicy({ id: policyId });

    expect(
      await callerFor(admin).insurance.listCoverages({ policyId })
    ).toHaveLength(0);
    expect(
      await callerFor(admin).insurance.listAttachments({ policyId })
    ).toHaveLength(0);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});

describe("Übernahme als Dauerbuchung", () => {
  it("legt die Dauerbuchung an und setzt den Rückverweis", async () => {
    const id = await newPolicy({
      name: "Prämien-Police",
      premium: 30_000,
      premiumInterval: "quarterly",
    });
    const res = await callerFor(admin).insurance.transferPremiumToRecurring({
      policyId: id,
      accountId: sharedAccountId,
    });
    expect(res.amount).toBe(30_000);
    expect(res.interval).toBe("quarterly");

    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.premiumRecurringId).toBe(res.id);
  });

  it("verweigert eine zweite Übernahme", async () => {
    const id = await newPolicy({ premium: 10_000 });
    await callerFor(admin).insurance.transferPremiumToRecurring({
      policyId: id,
      accountId: sharedAccountId,
    });
    await expect(
      callerFor(admin).insurance.transferPremiumToRecurring({
        policyId: id,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("heilt sich, wenn die Dauerbuchung gelöscht wurde", async () => {
    const id = await newPolicy({ premium: 10_000 });
    const first = await callerFor(admin).insurance.transferPremiumToRecurring({
      policyId: id,
      accountId: sharedAccountId,
    });
    await callerFor(admin).finance.deleteRecurring({ id: first.id });

    // Kein Badge mehr …
    const list = await callerFor(admin).insurance.listPolicies();
    expect(list.find(p => p.id === id)!.premiumRecurringId).toBeNull();
    // … und die Übernahme ist wieder möglich
    const second = await callerFor(admin).insurance.transferPremiumToRecurring({
      policyId: id,
      accountId: sharedAccountId,
    });
    expect(second.id).not.toBe(first.id);
  });

  it("lehnt Angebote ab", async () => {
    const id = await newPolicy({ status: "quote", premium: 10_000 });
    await expect(
      callerFor(admin).insurance.transferPremiumToRecurring({
        policyId: id,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lehnt Policen ohne Prämie ab", async () => {
    const id = await newPolicy({ premium: 0 });
    await expect(
      callerFor(admin).insurance.transferPremiumToRecurring({
        policyId: id,
        accountId: sharedAccountId,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("überträgt das Vertragsende auf die Dauerbuchung", async () => {
    const id = await newPolicy({
      renewal: "fixed",
      endDate: "2099-06-30",
      premium: 5_000,
    });
    const res = await callerFor(admin).insurance.transferPremiumToRecurring({
      policyId: id,
      accountId: sharedAccountId,
    });
    const recurringRows = await callerFor(admin).finance.listRecurring();
    expect(recurringRows.find(r => r.id === res.id)!.endDate).toBe("2099-06-30");
  });
});

describe("Übersicht", () => {
  it("schließt Angebote aus den Prämiensummen aus", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);

    await newPolicy({ premium: 12_000, premiumInterval: "monthly" });
    await newPolicy({
      premium: 100_000,
      premiumInterval: "monthly",
      status: "quote",
    });

    const summary = await callerFor(member).insurance.summary();
    expect(summary.count).toBe(2);
    expect(summary.activeCount).toBe(1);
    expect(summary.quoteCount).toBe(1);
    expect(summary.premiumMonthly).toBe(12_000);
    expect(summary.premiumYearly).toBe(144_000);
  });
});

describe("Lückenanalyse", () => {
  it("meldet Lücken haushaltsweit und lässt sie ausblenden", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);

    const before = await callerFor(member).insurance.gapAnalysis();
    expect(before.personCount).toBe(2);
    const haftpflicht = before.gaps.find(
      g => g.kind === "missing_household" && g.branch === "privathaftpflicht"
    )!;
    expect(haftpflicht.key).toBe("branch:privathaftpflicht");

    await callerFor(admin).insurance.dismissGap({
      key: haftpflicht.key,
      note: "Über die Hausratspolice mitgedeckt",
    });

    const after = await callerFor(member).insurance.gapAnalysis();
    expect(after.gaps.map(g => g.key)).not.toContain(haftpflicht.key);
    expect(after.dismissed.map(g => g.key)).toContain(haftpflicht.key);

    await callerFor(admin).insurance.restoreGap({ key: haftpflicht.key });
    const restored = await callerFor(member).insurance.gapAnalysis();
    expect(restored.gaps.map(g => g.key)).toContain(haftpflicht.key);
  });

  it("liefert Begründung, Autor und Zeitpunkt zum ausgeblendeten Hinweis", async () => {
    const key = "branch:hausrat";
    await callerFor(admin).insurance.dismissGap({
      key,
      note: "Über die Wohngebäudepolice mitgedeckt",
    });

    const result = await callerFor(member).insurance.gapAnalysis();
    const entry = result.dismissed.find(g => g.key === key)!;
    expect(entry.dismissal).toMatchObject({
      note: "Über die Wohngebäudepolice mitgedeckt",
      userName: "Admin",
      userColor: "#10b981",
    });
    expect(entry.dismissal!.createdAt).toBeInstanceOf(Date);

    await callerFor(admin).insurance.restoreGap({ key });
  });

  it("schreibt Aus- und Einblenden in die Änderungshistorie", async () => {
    const key = "branch:rechtsschutz";
    await callerFor(admin).insurance.dismissGap({
      key,
      note: "Über den Verband abgedeckt",
    });

    let history = await callerFor(member).insurance.listChanges({
      entity: "gap",
    });
    const dismissEntry = history.entries[0];
    // Der Hinweis-Name steht als Feld-Label im Diff
    expect(dismissEntry.changes).toEqual(
      expect.arrayContaining([
        {
          field: "Fehlende Rechtsschutz",
          from: "eingeblendet",
          to: "ausgeblendet",
        },
        { field: "Begründung", from: null, to: "Über den Verband abgedeckt" },
      ])
    );
    expect(dismissEntry.userName).toBe("Admin");

    await callerFor(member).insurance.restoreGap({ key });
    history = await callerFor(admin).insurance.listChanges({ entity: "gap" });
    expect(history.entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "Fehlende Rechtsschutz", from: "ausgeblendet", to: "eingeblendet" },
      ])
    );
    expect(history.entries[0].userName).toBe("Mitglied");
    // Beim Einblenden verschwindet die Begründung — als „—", nicht als Leerwert
    expect(history.entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "Begründung", from: "Über den Verband abgedeckt", to: null },
      ])
    );
  });

  it("erzeugt ohne Begründung keine leere Begründungs-Zeile", async () => {
    const key = "branch:privathaftpflicht";
    await callerFor(admin).insurance.dismissGap({ key });
    const history = await callerFor(admin).insurance.listChanges({
      entity: "gap",
      limit: 1,
    });
    expect(history.entries[0].changes.map(c => c.field)).not.toContain(
      "Begründung"
    );
    await callerFor(admin).insurance.restoreGap({ key });
  });

  it("benennt personenbezogene und policenbezogene Hinweise lesbar", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);
    const policyId = await newPolicy({ name: "Ohne Deckungen" });

    await callerFor(admin).insurance.dismissGap({
      key: `branch:krankenkasse_grund:person:${member.id}`,
    });
    await callerFor(admin).insurance.dismissGap({
      key: `policy:${policyId}:no_coverage`,
    });

    const history = await callerFor(admin).insurance.listChanges({
      entity: "gap",
      limit: 2,
    });
    const labels = history.entries.flatMap(e => e.changes.map(c => c.field));
    expect(labels).toContain(
      "Fehlende Krankenversicherung (Grund) (Mitglied)"
    );
    expect(labels).toContain('Fehlende Deckungen — „Ohne Deckungen“');
  });

  it("meldet die fehlende Gebäudeversicherung, sobald eine Liegenschaft existiert", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);

    const before = await callerFor(admin).insurance.gapAnalysis();
    expect(before.gaps.map(g => g.kind)).not.toContain("missing_building");

    await callerFor(admin).mortgage.addProperty({
      name: "Haus Bergstrasse",
      marketValue: 80_000_000,
    });

    const after = await callerFor(member).insurance.gapAnalysis();
    const gap = after.gaps.find(g => g.kind === "missing_building");
    expect(gap).toMatchObject({
      key: "branch:gebaeude",
      severity: "warn",
      dismissible: true,
      propertyName: "Haus Bergstrasse",
    });

    // …und lässt sich ausblenden
    await callerFor(admin).insurance.dismissGap({ key: "branch:gebaeude" });
    const dismissed = await callerFor(admin).insurance.gapAnalysis();
    expect(dismissed.gaps.map(g => g.key)).not.toContain("branch:gebaeude");
    expect(dismissed.dismissed.map(g => g.key)).toContain("branch:gebaeude");
    await callerFor(admin).insurance.restoreGap({ key: "branch:gebaeude" });
  });

  it("bleibt bei doppeltem Ausblenden stabil", async () => {
    const key = "branch:rechtsschutz";
    await callerFor(admin).insurance.dismissGap({ key });
    await expect(
      callerFor(member).insurance.dismissGap({ key })
    ).resolves.toMatchObject({ ok: true });
    await callerFor(admin).insurance.restoreGap({ key });
  });
});

describe("Historie und Audit-Log", () => {
  it("paginiert den Änderungsverlauf", async () => {
    const page = await callerFor(admin).insurance.listChanges({ limit: 2 });
    expect(page.entries.length).toBeLessThanOrEqual(2);
    expect(page.total).toBeGreaterThan(0);
    expect(page.entries[0].userName).toBe("Admin");
    if (page.total > 2) expect(page.nextCursor).toBe(2);
  });

  it("schreibt keinen Historien-Eintrag ohne echte Änderung", async () => {
    const id = await newPolicy({ name: "Unverändert" });
    const before = await callerFor(admin).insurance.listChanges({
      entity: "policy",
    });
    await callerFor(admin).insurance.updatePolicy({ id, name: "Unverändert" });
    const after = await callerFor(admin).insurance.listChanges({
      entity: "policy",
    });
    expect(after.total).toBe(before.total);
  });

  it("hält die Policennummer aus dem Audit-Log heraus", async () => {
    await newPolicy({ name: "Geheim", policyNumber: "POL-123456789" });
    const rows = await getDb()
      .select({ detail: auditLog.detail })
      .from(auditLog)
      .where(eq(auditLog.entity, "insurance"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.detail).not.toContain("POL-123456789");
    }
  });
});

describe("Erinnerung an Kündigungsfristen", () => {
  it("meldet je Schwelle einmal — und im Folgejahr erneut", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);
    // Hauptverfall 31.12., Frist 3 Monate → cancelBy 30.09.
    await newPolicy({
      name: "Fristen-Police",
      mainDueDate: "2026-12-31",
      noticePeriodMonths: 3,
    });

    // 30 Tage vor dem 30.09.2026
    const inWindow = new Date(2026, 7, 31, 12);
    expect(await notifyNoticeDeadlines(db, inWindow)).toBe(1);
    // Zweiter Lauf am selben Tag: der Marker verhindert die Wiederholung
    expect(await notifyNoticeDeadlines(db, inWindow)).toBe(0);

    // Im Folgejahr ist es ein neuer Termin — die Erinnerung muss wieder
    // feuern. Genau das verhindert ein Marker ohne Datum.
    const nextYear = new Date(2027, 7, 31, 12);
    expect(await notifyNoticeDeadlines(db, nextYear)).toBe(1);
  });

  it("schweigt bei Angeboten", async () => {
    const db = getDb();
    await db.delete(insurancePolicies);
    await newPolicy({
      status: "quote",
      mainDueDate: "2026-12-31",
      noticePeriodMonths: 3,
    });
    expect(await notifyNoticeDeadlines(db, new Date(2026, 7, 31, 12))).toBe(0);
  });
});
