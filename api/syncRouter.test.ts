import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { rawClient, withTriggersSuspended } from "./lib/sync/store";
import { accountOwners, accounts, transactions, users } from "@db/schema";
import { saveAttachment } from "./lib/attachments";
import { readAttachmentFile } from "./lib/attachmentStore";
import type { SessionUser, TrpcContext } from "./context";
import { SYNC_PROTOCOL_VERSION } from "@contracts/offline";

/**
 * Abgleich über den echten Router — mit von Hand gebauten Push-Nutzlasten,
 * so wie sie ein Gerät schicken würde. Damit ist der Weg vom Trigger über
 * `pull` bis zum Drei-Wege-Vergleich in `push` abgedeckt, ohne dass es dafür
 * einen zweiten Prozess bräuchte.
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

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

let counter = 0;

async function insertAccount(ownerId: number | null): Promise<number> {
  counter += 1;
  const rows = await getDb()
    .insert(accounts)
    .values({
      name: `Konto ${counter}`,
      type: "checking",
      initialBalance: 0,
      createdAt: new Date(),
    })
    .returning({ id: accounts.id });
  const id = rows[0].id;
  if (ownerId !== null) {
    await getDb()
      .insert(accountOwners)
      .values({ accountId: id, userId: ownerId });
  }
  return id;
}

async function insertTransaction(accountId: number, note: string) {
  const rows = await getDb()
    .insert(transactions)
    .values({
      type: "expense",
      accountId,
      amount: 1000,
      userId: anna.id,
      date: "2026-03-12",
      note,
      createdAt: new Date(),
    })
    .returning({ id: transactions.id });
  return rows[0].id;
}

function logSize(): number {
  return Number(
    rawClient(getDb()).prepare("SELECT COUNT(*) AS n FROM sync_log").get()?.n ??
      0
  );
}

function serverRow(table: string, id: number) {
  return rawClient(getDb())
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id);
}

beforeAll(async () => {
  await initDb();
  ensureSchema();
  await getDb()
    .insert(users)
    .values([
      {
        id: anna.id,
        email: anna.email,
        name: anna.name,
        role: "admin",
        color: anna.color,
        passwordHash: "geheim",
        createdAt: new Date(),
      },
      {
        id: bruno.id,
        email: bruno.email,
        name: bruno.name,
        role: "member",
        color: bruno.color,
        passwordHash: "auch-geheim",
        createdAt: new Date(),
      },
    ]);
});

describe("Änderungs-Trigger", () => {
  it("protokolliert Anlegen, Ändern und Löschen", async () => {
    const before = logSize();
    const id = await insertAccount(null);
    await getDb()
      .update(accounts)
      .set({ name: "Umbenannt" })
      .where(eq(accounts.id, id));
    const marks = rawClient(getDb())
      .prepare(
        "SELECT op FROM sync_log WHERE entity = 'accounts' AND row_id = ? ORDER BY seq"
      )
      .all(String(id));
    expect(marks.map(m => m.op)).toEqual(["insert", "update"]);
    expect(logSize()).toBeGreaterThan(before);
  });

  it("schweigt, solange die Trigger ausgesetzt sind", async () => {
    const before = logSize();
    withTriggersSuspended(getDb(), () => {
      rawClient(getDb())
        .prepare(
          "INSERT INTO banks (name) VALUES ('Bank ohne Protokolleintrag')"
        )
        .run();
    });
    expect(logSize()).toBe(before);
  });

  it("schaltet die Trigger auch nach einem Fehler wieder ein", async () => {
    expect(() =>
      withTriggersSuspended(getDb(), () => {
        throw new Error("Absicht");
      })
    ).toThrow("Absicht");
    const before = logSize();
    rawClient(getDb())
      .prepare("INSERT INTO banks (name) VALUES ('Bank mit Protokolleintrag')")
      .run();
    expect(logSize()).toBe(before + 1);
  });
});

describe("claimDevice", () => {
  it("vergibt je Gerät einen eigenen, überschneidungsfreien ID-Block", async () => {
    const first = await callerFor(anna).sync.claimDevice({});
    const second = await callerFor(anna).sync.claimDevice({});
    expect(first.deviceId).not.toBe(second.deviceId);
    expect(Math.abs(first.idBlockStart - second.idBlockStart)).toBeGreaterThan(
      1_000_000
    );
    expect(first.idBlockStart).toBeGreaterThan(1_000_000_000_000);
  });

  it("liefert demselben Gerät denselben Block", async () => {
    const first = await callerFor(anna).sync.claimDevice({});
    const again = await callerFor(anna).sync.claimDevice({
      deviceId: first.deviceId,
    });
    expect(again.idBlockStart).toBe(first.idBlockStart);
  });

  it("gibt ein fremdes Gerät nicht heraus", async () => {
    const mine = await callerFor(anna).sync.claimDevice({});
    await expect(
      callerFor(bruno).sync.claimDevice({ deviceId: mine.deviceId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("pull", () => {
  it("liefert beim ersten Mal einen vollständigen Schnappschuss", async () => {
    const device = await callerFor(anna).sync.claimDevice({});
    const result = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    expect(result.full).toBe(true);
    const users = result.changes.find(c => c.entity === "users");
    expect(users?.upserts.length).toBeGreaterThan(0);
  });

  it("gibt niemals Passwort-Hashes oder TOTP-Geheimnisse heraus", async () => {
    const device = await callerFor(anna).sync.claimDevice({});
    const result = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    const rows = result.changes.find(c => c.entity === "users")?.upserts ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("password_hash");
      expect(row).not.toHaveProperty("totp_secret");
    }
  });

  it("überträgt danach nur noch Änderungen", async () => {
    const accountId = await insertAccount(null);
    const device = await callerFor(anna).sync.claimDevice({});
    const first = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    const txId = await insertTransaction(accountId, "Neu");
    const second = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: first.seq,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    expect(second.full).toBe(false);
    const txChange = second.changes.find(c => c.entity === "transactions");
    expect(txChange?.upserts.map(r => r.id)).toContain(txId);
    expect(second.changes.find(c => c.entity === "categories")).toBeUndefined();
  });

  it("meldet gelöschte Zeilen als entfernt", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Kurzlebig");
    const device = await callerFor(anna).sync.claimDevice({});
    const first = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    await getDb().delete(transactions).where(eq(transactions.id, txId));
    const second = await callerFor(anna).sync.pull({
      deviceId: device.deviceId,
      since: first.seq,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    const txChange = second.changes.find(c => c.entity === "transactions");
    expect(txChange?.removed).toContain(String(txId));
  });

  it("hält private Konten und deren Buchungen von fremden Geräten fern", async () => {
    const privateId = await insertAccount(anna.id);
    await insertTransaction(privateId, "Privat");
    const device = await callerFor(bruno).sync.claimDevice({});
    const result = await callerFor(bruno).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    const accountIds =
      result.changes
        .find(c => c.entity === "accounts")
        ?.upserts.map(r => r.id) ?? [];
    expect(accountIds).not.toContain(privateId);
    const notes =
      result.changes
        .find(c => c.entity === "transactions")
        ?.upserts.map(r => r.note) ?? [];
    expect(notes).not.toContain("Privat");
  });

  it("verlangt einen vollständigen Abgleich, wenn sich die Sichtbarkeit ändert", async () => {
    const shared = await insertAccount(null);
    const device = await callerFor(bruno).sync.claimDevice({});
    const first = await callerFor(bruno).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    // Konto wird privat — Brunos sichtbare Kontenmenge schrumpft, ohne dass
    // sich die Zeilen der betroffenen Buchungen selbst geändert hätten.
    await getDb()
      .insert(accountOwners)
      .values({ accountId: shared, userId: anna.id });
    const second = await callerFor(bruno).sync.pull({
      deviceId: device.deviceId,
      since: first.seq,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    expect(second.full).toBe(true);
  });

  it("weist eine veraltete App ab, statt falsch zu mischen", async () => {
    const device = await callerFor(anna).sync.claimDevice({});
    await expect(
      callerFor(anna).sync.pull({
        deviceId: device.deviceId,
        since: 0,
        protocolVersion: SYNC_PROTOCOL_VERSION - 1,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("push", () => {
  it("übernimmt eine offline geänderte Buchung", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Migros");
    const device = await callerFor(anna).sync.claimDevice({});
    const base = serverRow("transactions", txId)!;

    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "update",
          row: { ...base, note: "Coop" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("applied");
    expect(serverRow("transactions", txId)?.note).toBe("Coop");
  });

  it("führt verschiedene Felder ohne Rückfrage zusammen", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Migros");
    const device = await callerFor(anna).sync.claimDevice({});
    const base = serverRow("transactions", txId)!;

    // Zuhause wird der Betrag korrigiert …
    await getDb()
      .update(transactions)
      .set({ amount: 9999 })
      .where(eq(transactions.id, txId));
    // … unterwegs die Notiz.
    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "update",
          row: { ...base, note: "Coop" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("merged");
    expect(result.outcomes[0].mergedMine).toEqual(["note"]);
    const row = serverRow("transactions", txId);
    expect(row?.note).toBe("Coop");
    expect(row?.amount).toBe(9999);
  });

  it("meldet dasselbe Feld als Konflikt und ändert nichts", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Migros");
    const device = await callerFor(anna).sync.claimDevice({});
    const base = serverRow("transactions", txId)!;

    await getDb()
      .update(transactions)
      .set({ note: "Denner" })
      .where(eq(transactions.id, txId));
    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "update",
          row: { ...base, note: "Coop" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(result.outcomes[0].conflict?.kind).toBe("fields");
    expect(result.outcomes[0].conflict?.fields).toEqual(["note"]);
    expect(serverRow("transactions", txId)?.note).toBe("Denner");
  });

  it("meldet eine inzwischen gelöschte Zeile als Konflikt", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Weg");
    const device = await callerFor(anna).sync.claimDevice({});
    const base = serverRow("transactions", txId)!;
    await getDb().delete(transactions).where(eq(transactions.id, txId));

    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "update",
          row: { ...base, note: "Doch nicht" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(result.outcomes[0].conflict?.kind).toBe("deleted-remote");
  });

  it("löscht nicht, wenn die Zeile zwischenzeitlich geändert wurde", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Original");
    const device = await callerFor(anna).sync.claimDevice({});
    const base = serverRow("transactions", txId)!;
    await getDb()
      .update(transactions)
      .set({ note: "Doch behalten" })
      .where(eq(transactions.id, txId));

    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "delete",
          row: null,
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(result.outcomes[0].conflict?.kind).toBe("deleted-local");
    expect(serverRow("transactions", txId)).toBeTruthy();
  });

  it("lehnt Schreibzugriffe ohne Recht ab und begründet sie", async () => {
    const privateId = await insertAccount(anna.id);
    const txId = await insertTransaction(privateId, "Annas Sache");
    const base = serverRow("transactions", txId)!;
    const device = await callerFor(bruno).sync.claimDevice({});

    const result = await callerFor(bruno).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transactions",
          rowId: String(txId),
          op: "update",
          row: { ...base, note: "Fremdzugriff" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(result.outcomes[0].conflict?.kind).toBe("forbidden");
    expect(result.outcomes[0].conflict?.detail).toMatch(/Recht/);
    expect(serverRow("transactions", txId)?.note).toBe("Annas Sache");
  });

  it("übernimmt aus einem Push niemals Rolle oder Passwort-Hash", async () => {
    const device = await callerFor(bruno).sync.claimDevice({});
    // Die Basis so aufbauen, wie ein Gerät sie hat: aus dem Pull — also ohne
    // Passwort-Hash und TOTP-Geheimnis. Nähme man hier die rohe Serverzeile,
    // liefe der Test an genau dem Fehler vorbei, den er absichern soll.
    const pulled = await callerFor(bruno).sync.pull({
      deviceId: device.deviceId,
      since: 0,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
    const base = pulled.changes
      .find(c => c.entity === "users")!
      .upserts.find(row => row.id === bruno.id)!;
    const result = await callerFor(bruno).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "users",
          rowId: String(bruno.id),
          op: "update",
          row: {
            ...base,
            name: "Bruno neu",
            role: "admin",
            password_hash: "eingeschleust",
            active: 0,
          },
          base,
        },
      ],
    });
    // „applied", nicht „merged": Die Geheimnisse dürfen nicht als
    // Serveränderung durchgehen, sonst stünde nach jeder Profiländerung ein
    // Eintrag „password_hash" im Merge-Protokoll des Benutzers.
    expect(result.outcomes[0].status).toBe("applied");
    const row = serverRow("users", bruno.id);
    expect(row?.name).toBe("Bruno neu");
    expect(row?.role).toBe("member");
    expect(row?.password_hash).toBe("auch-geheim");
    expect(row?.active).toBe(1);
  });

  it("lässt fremde Benutzerzeilen nicht ändern", async () => {
    const device = await callerFor(bruno).sync.claimDevice({});
    const base = serverRow("users", anna.id)!;
    const result = await callerFor(bruno).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "users",
          rowId: String(anna.id),
          op: "update",
          row: { ...base, name: "Gekapert" },
          base,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("conflict");
    expect(serverRow("users", anna.id)?.name).toBe("Anna");

    /*
     * Die Absage schickt den Serverstand mit, damit das Gerät seine
     * abgelehnte Fassung korrigieren kann. Er muss dieselbe Behandlung
     * erfahren wie im Pull: Ein absichtlich unerlaubter Push wäre sonst der
     * bequemste Weg, an Passwort-Hash und TOTP-Geheimnis eines anderen
     * Haushaltsmitglieds zu kommen — die Engine schreibt `theirs` obendrein
     * in die lokale Replik.
     */
    const theirs = result.outcomes[0].conflict?.theirs;
    expect(theirs).toBeTruthy();
    expect(theirs).not.toHaveProperty("password_hash");
    expect(theirs).not.toHaveProperty("totp_secret");
    expect(theirs).toHaveProperty("name", "Anna");
  });

  it("nimmt ein offline angelegtes Konto samt Buchung an", async () => {
    // Der Fall, für den der ganze Offline-Betrieb da ist: unterwegs ein Konto
    // anlegen und gleich darauf buchen. Beides kommt im selben Paket, und die
    // Buchung bezieht ihr Recht auf ein Konto, das der Server noch nicht
    // kennt — die Rechteprüfung muss innerhalb des Pushs mitwachsen.
    const device = await callerFor(anna).sync.claimDevice({});
    const accountId = 1_001_000_000_100;
    const txId = 1_001_000_000_101;

    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "accounts",
          rowId: String(accountId),
          op: "insert",
          row: {
            id: accountId,
            name: "Offline-Konto",
            type: "checking",
            initial_balance: 0,
            created_at: Date.now(),
          },
          base: null,
        },
        {
          entity: "transactions",
          rowId: String(txId),
          op: "insert",
          row: {
            id: txId,
            type: "expense",
            account_id: accountId,
            amount: 2500,
            user_id: anna.id,
            date: "2026-03-20",
            note: "Unterwegs gebucht",
            created_at: Date.now(),
          },
          base: null,
        },
        {
          entity: "transaction_splits",
          rowId: String(txId + 1),
          op: "insert",
          row: {
            id: txId + 1,
            transaction_id: txId,
            user_id: anna.id,
            amount: 1250,
          },
          base: null,
        },
      ],
    });

    expect(result.outcomes.map(o => o.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(serverRow("accounts", accountId)?.name).toBe("Offline-Konto");
    expect(serverRow("transactions", txId)?.note).toBe("Unterwegs gebucht");
    expect(serverRow("transaction_splits", txId + 1)?.amount).toBe(1250);
  });

  it("löscht mit dem Anhang auch dessen Datei", async () => {
    const accountId = await insertAccount(null);
    const txId = await insertTransaction(accountId, "Mit Beleg");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const meta = await saveAttachment(
      getDb(),
      txId,
      bytes,
      "beleg.png",
      "image/png"
    );
    const stored = serverRow("transaction_attachments", meta.id)!
      .stored_name as string;
    expect(readAttachmentFile(stored)).not.toBeNull();

    const device = await callerFor(anna).sync.claimDevice({});
    await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "transaction_attachments",
          rowId: String(meta.id),
          op: "delete",
          row: null,
          base: serverRow("transaction_attachments", meta.id)!,
        },
      ],
    });
    expect(serverRow("transaction_attachments", meta.id)).toBeFalsy();
    // Die Datei liegt außerhalb der Datenbank — ohne diesen Schritt bliebe
    // sie für immer im Anhang-Verzeichnis liegen.
    expect(readAttachmentFile(stored)).toBeNull();
  });

  it("ignoriert unbekannte Tabellen", async () => {
    const device = await callerFor(anna).sync.claimDevice({});
    const result = await callerFor(anna).sync.push({
      deviceId: device.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      changes: [
        {
          entity: "auth_tokens",
          rowId: "1",
          op: "insert",
          row: { id: 1, token: "geschmuggelt" },
          base: null,
        },
      ],
    });
    expect(result.outcomes[0].status).toBe("skipped");
  });
});
