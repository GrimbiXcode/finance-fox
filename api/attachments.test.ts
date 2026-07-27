import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appRouter } from "./router";
import { users } from "@db/schema";
import { buildSessionCookie } from "./lib/session";
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

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    user,
  };
  return appRouter.createCaller(ctx);
}

// Attachments landen im Test in einem Temp-Verzeichnis, nicht im Projekt
let tmpDir = "";
let app: (typeof import("./boot"))["default"];

let sharedAccountId = 0;
let privateAccountId = 0;
let sharedTxId = 0;
let privateTxId = 0;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);

function upload(
  cookie: string | null,
  txId: number,
  opts: { body: Buffer; filename?: string; contentType?: string }
) {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "image/png",
  };
  if (cookie) headers.cookie = cookie;
  if (opts.filename) headers["x-filename"] = encodeURIComponent(opts.filename);
  return app.request(`/api/attachments?transactionId=${txId}`, {
    method: "POST",
    headers,
    body: opts.body,
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-fox-attachments-"));
  process.env.ATTACHMENTS_DIR = tmpDir;
  // erst jetzt laden, damit initAttachmentsDir() das Temp-Verzeichnis nutzt
  ({ default: app } = await import("./boot"));

  const { getDb } = await import("./queries/connection");
  const db = getDb();
  // Nutzer echt in der DB: die HTTP-Routen lösen das Session-Cookie
  // gegen die users-Tabelle auf.
  await db.insert(users).values([
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin",
      color: admin.color,
      createdAt: new Date(),
    },
    {
      id: member.id,
      email: member.email,
      name: member.name,
      role: "member",
      color: member.color,
      createdAt: new Date(),
    },
  ]);

  const adminCaller = callerFor(admin);
  await adminCaller.finance.createAccount({
    name: "Gemeinschaftskonto",
    type: "checking",
    initialBalance: 0,
    private: false,
  });
  await adminCaller.finance.createAccount({
    name: "Privatkonto",
    type: "checking",
    initialBalance: 0,
    private: true,
  });
  const accs = await adminCaller.finance.listAccounts();
  sharedAccountId = accs.find(a => a.name === "Gemeinschaftskonto")!.id;
  privateAccountId = accs.find(a => a.name === "Privatkonto")!.id;

  await adminCaller.finance.createTransaction({
    type: "expense",
    accountId: sharedAccountId,
    amount: 1234,
    userId: admin.id,
    date: "2026-01-15",
    note: "Einkauf",
  });
  // Nur auf dem privaten Konto — für das Mitglied unsichtbar
  await adminCaller.finance.createTransaction({
    type: "expense",
    accountId: privateAccountId,
    amount: 999,
    userId: admin.id,
    date: "2026-01-10",
    note: "Geheim",
  });
  const txs = await adminCaller.finance.listTransactions();
  sharedTxId = txs.find(t => t.note === "Einkauf")!.id;
  privateTxId = txs.find(t => t.note === "Geheim")!.id;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Beleg-Upload (POST /api/attachments)", () => {
  it("speichert Datei und liefert Metadaten", async () => {
    const res = await upload(
      buildSessionCookie(admin.id, false),
      sharedTxId,
      { body: PNG_BYTES, filename: "quittung januar.png" }
    );
    expect(res.status).toBe(201);
    const meta = (await res.json()) as {
      id: number;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    };
    expect(meta.id).toBeGreaterThan(0);
    expect(meta.originalName).toBe("quittung januar.png");
    expect(meta.mimeType).toBe("image/png");
    expect(meta.sizeBytes).toBe(PNG_BYTES.byteLength);
    // Datei liegt im Attachments-Verzeichnis (Zufallsname mit Endung)
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
    expect(fs.readFileSync(path.join(tmpDir, files[0]))).toEqual(PNG_BYTES);
  });

  it("liefert die Metadaten in listTransactions mit", async () => {
    const txs = await callerFor(admin).finance.listTransactions();
    const tx = txs.find(t => t.id === sharedTxId)!;
    expect(tx.attachments).toHaveLength(1);
    expect(tx.attachments[0].originalName).toBe("quittung januar.png");
    const ohneBeleg = txs.find(t => t.id === privateTxId)!;
    expect(ohneBeleg.attachments).toHaveLength(0);
  });

  it("verweigert Upload ohne Session", async () => {
    const res = await upload(null, sharedTxId, { body: PNG_BYTES });
    expect(res.status).toBe(401);
  });

  it("verweigert Upload auf fremdes Privatkonto (404 statt 403)", async () => {
    const res = await upload(
      buildSessionCookie(member.id, false),
      privateTxId,
      { body: PNG_BYTES }
    );
    expect(res.status).toBe(404);
  });

  it("erlaubt Mitgliedern den Upload aufs Gemeinschaftskonto", async () => {
    const res = await upload(
      buildSessionCookie(member.id, false),
      sharedTxId,
      { body: PNG_BYTES, filename: "mitglied.pdf", contentType: "application/pdf" }
    );
    expect(res.status).toBe(201);
  });

  it("lehnt nicht erlaubte Dateitypen ab", async () => {
    const res = await upload(
      buildSessionCookie(admin.id, false),
      sharedTxId,
      { body: Buffer.from("hallo"), filename: "notiz.txt", contentType: "text/plain" }
    );
    expect(res.status).toBe(400);
    const fehler = (await res.json()) as { error: string };
    expect(fehler.error).toContain("PDF");
  });

  it("lehnt Dateien über 10 MB ab", async () => {
    const gross = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await upload(
      buildSessionCookie(admin.id, false),
      sharedTxId,
      { body: gross, filename: "riesig.png" }
    );
    expect(res.status).toBe(413);
    const fehler = (await res.json()) as { error: string };
    expect(fehler.error).toContain("10 MB");
  });
});

describe("Beleg-Download (GET /api/attachments/:id)", () => {
  let attachmentId = 0;

  beforeAll(async () => {
    const txs = await callerFor(admin).finance.listTransactions();
    attachmentId = txs.find(t => t.id === sharedTxId)!.attachments[0].id;
  });

  it("liefert Bytes, Content-Type und Original-Dateinamen", async () => {
    const res = await app.request(`/api/attachments/${attachmentId}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain(
      encodeURIComponent("quittung januar.png")
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes).toEqual(PNG_BYTES);
  });

  it("verweigert den Download ohne Session", async () => {
    const res = await app.request(`/api/attachments/${attachmentId}`);
    expect(res.status).toBe(401);
  });

  it("gibt 404 für unbekannte IDs", async () => {
    const res = await app.request("/api/attachments/9999", {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(404);
  });

  it("lässt Mitglieder Belege fremder Privatkonten nicht laden", async () => {
    const res = await upload(
      buildSessionCookie(admin.id, false),
      privateTxId,
      { body: PNG_BYTES, filename: "geheim.png" }
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const alsMitglied = await app.request(`/api/attachments/${id}`, {
      headers: { cookie: buildSessionCookie(member.id, false) },
    });
    expect(alsMitglied.status).toBe(404);
    // der Admin darf weiterhin (readonly-Reichtum reicht für view)
    const alsAdmin = await app.request(`/api/attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(alsAdmin.status).toBe(200);
  });
});

describe("Beleg-Löschen (DELETE /api/attachments/:id)", () => {
  it("löscht Zeile und Datei", async () => {
    const dateienVorher = fs.readdirSync(tmpDir).length;
    const hochgeladen = await upload(
      buildSessionCookie(admin.id, false),
      sharedTxId,
      { body: PNG_BYTES, filename: "weg.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    expect(fs.readdirSync(tmpDir).length).toBe(dateienVorher + 1);
    const res = await app.request(`/api/attachments/${id}`, {
      method: "DELETE",
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(200);
    // danach weder per API noch im Dateisystem vorhanden
    const danach = await app.request(`/api/attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(danach.status).toBe(404);
    expect(fs.readdirSync(tmpDir).length).toBe(dateienVorher);
  });

  it("verweigert das Löschen ohne Session", async () => {
    const txs = await callerFor(admin).finance.listTransactions();
    const id = txs.find(t => t.id === sharedTxId)!.attachments[0].id;
    const res = await app.request(`/api/attachments/${id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("Kaskade", () => {
  it("deleteTransaction entfernt Beleg-Zeilen und Dateien", async () => {
    // eigene Buchung mit eigenem Beleg, damit andere Tests unberührt bleiben
    await callerFor(admin).finance.createTransaction({
      type: "expense",
      accountId: sharedAccountId,
      amount: 500,
      userId: admin.id,
      date: "2026-02-01",
      note: "Kaskaden-Test",
    });
    const txs = await callerFor(admin).finance.listTransactions();
    const txId = txs.find(t => t.note === "Kaskaden-Test")!.id;
    const hochgeladen = await upload(
      buildSessionCookie(admin.id, false),
      txId,
      { body: PNG_BYTES, filename: "kaskade.png" }
    );
    const { id } = (await hochgeladen.json()) as { id: number };
    const dateienVorher = fs.readdirSync(tmpDir).length;

    await callerFor(admin).finance.deleteTransaction({ id: txId });

    const res = await app.request(`/api/attachments/${id}`, {
      headers: { cookie: buildSessionCookie(admin.id, false) },
    });
    expect(res.status).toBe(404);
    expect(fs.readdirSync(tmpDir).length).toBe(dateienVorher - 1);
  });
});
