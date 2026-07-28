import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { ensureSchema } from "./lib/migrate";
import { getDb, initDb } from "./queries/connection";
import { parseCamt053 } from "./lib/camt";
import { users } from "@db/schema";
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

/** camt.053.001.02 mit Default-Namespace: DBIT mit Entity + CRDT mit CDATA */
const CAMT_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <Stmt>
      <Ntry>
        <Amt Ccy="CHF">79.90</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2026-02-02</Dt></BookgDt>
        <ValDt><Dt>2026-02-02</Dt></ValDt>
        <AcctSvcrRef>REF-2026-001</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              <Cdtr><Nm>Migros &amp; Co</Nm></Cdtr>
            </RltdPties>
            <RmtInf><Ustrd>Einkauf Supermarkt</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">2500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2026-02-01</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Pty><Nm>Arbeitgeber AG</Nm></Pty></Dbtr></RltdPties>
          <RmtInf>
            <Ustrd><![CDATA[Lohn Januar 2026]]></Ustrd>
            <Ustrd>Monatslohn</Ustrd>
          </RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

/** Namespace-Variante MIT Präfix (neuere camt.053-Version), Entities im Text */
const CAMT_PREFIXED = `<?xml version="1.0" encoding="UTF-8"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
<ns:BkToCstmrStmt><ns:Stmt><ns:Ntry>
<ns:Amt Ccy="EUR">12.50</ns:Amt>
<ns:CdtDbtInd>DBIT</ns:CdtDbtInd>
<ns:BookgDt><ns:Dt>2026-03-01</ns:Dt></ns:BookgDt>
<ns:NtryDtls><ns:TxDtls>
<ns:RltdPties><ns:Cdtr><ns:Nm>Strom &lt;Werk&gt; AG</ns:Nm></ns:Cdtr></ns:RltdPties>
<ns:RmtInf><ns:Ustrd>Rechnung &quot;Jan&quot;</ns:Ustrd></ns:RmtInf>
</ns:TxDtls></ns:NtryDtls>
</ns:Ntry></ns:Stmt></ns:BkToCstmrStmt>
</ns:Document>`;

describe("parseCamt053", () => {
  it("liest Betrag, Vorzeichen, Datum, Referenz, Partei und Verwendungszweck", () => {
    const { entries, errors } = parseCamt053(CAMT_BASIC);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(2);

    // DBIT: negativer Betrag, Partei = Zahlungsempfänger (Cdtr)
    expect(entries[0]).toEqual({
      date: "2026-02-02",
      amountCents: -7990,
      reference: "REF-2026-001",
      party: "Migros & Co", // &amp; decodiert
      note: "Einkauf Supermarkt",
    });

    // CRDT: positiver Betrag, Partei = Auftraggeber (Dbtr),
    // CDATA aufgelöst, mehrere Ustrd zusammengeführt
    expect(entries[1]).toEqual({
      date: "2026-02-01",
      amountCents: 250000,
      reference: undefined,
      party: "Arbeitgeber AG",
      note: "Lohn Januar 2026 Monatslohn",
    });
  });

  it("arbeitet namespace-agnostisch (Präfix-Variante) und decodiert Entities", () => {
    const { entries, errors } = parseCamt053(CAMT_PREFIXED);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      date: "2026-03-01",
      amountCents: -1250,
      reference: undefined,
      party: "Strom <Werk> AG",
      note: 'Rechnung "Jan"',
    });
  });

  it("meldet Nicht-CAMT-XML als klaren Fehler", () => {
    const { entries, errors } = parseCamt053(
      `<Document><Foo>irgendwas</Foo></Document>`
    );
    expect(entries).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("camt.053");
  });

  it("überspringt fehlerhafte Buchungen mit Positionshinweis", () => {
    const xml = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Ntry><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-01-01</Dt></BookgDt></Ntry>
<Ntry><Amt Ccy="CHF">10.00</Amt><BookgDt><Dt>2026-01-02</Dt></BookgDt></Ntry>
<Ntry><Amt Ccy="CHF">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-13-40</Dt></BookgDt></Ntry>
<Ntry><Amt Ccy="CHF">5.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-01-03</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const { entries, errors } = parseCamt053(xml);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe("2026-01-03");
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Buchung 1");
    expect(errors[0]).toContain("Betrag");
    expect(errors[1]).toContain("Buchung 2");
    expect(errors[1]).toContain("CdtDbtInd");
    expect(errors[2]).toContain("Buchung 3");
    expect(errors[2]).toContain("Buchungsdatum");
  });
});

describe("finance.importCamt", () => {
  let sharedAccountId = 0;
  let privateAccountId = 0;

  beforeAll(async () => {
    await initDb();
    ensureSchema();
    const db = getDb();
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
  });

  it("importiert Gutschriften als Einnahmen und Belastungen als Ausgaben", async () => {
    const result = await callerFor(admin).finance.importCamt({
      xml: CAMT_BASIC,
      accountId: sharedAccountId,
    });
    expect(result).toEqual({ imported: 2, duplicates: 0, errors: [] });

    const txs = await callerFor(admin).finance.listTransactions();
    const expense = txs.find(t => t.date === "2026-02-02");
    expect(expense).toMatchObject({
      type: "expense",
      amount: 7990,
      categoryId: null,
      userId: admin.id,
      note: "Migros & Co — Einkauf Supermarkt",
    });
    const income = txs.find(t => t.date === "2026-02-01");
    expect(income).toMatchObject({
      type: "income",
      amount: 250000,
      categoryId: null,
      userId: admin.id,
      note: "Arbeitgeber AG — Lohn Januar 2026 Monatslohn",
    });
  });

  it("überspringt Dubletten beim zweiten Import derselben Datei", async () => {
    const before = await callerFor(admin).finance.listTransactions();
    const result = await callerFor(admin).finance.importCamt({
      xml: CAMT_BASIC,
      accountId: sharedAccountId,
    });
    expect(result).toEqual({ imported: 0, duplicates: 2, errors: [] });
    const after = await callerFor(admin).finance.listTransactions();
    expect(after).toHaveLength(before.length);
  });

  it("meldet Nicht-CAMT-XML über das Fehler-Array ohne Import", async () => {
    const result = await callerFor(admin).finance.importCamt({
      xml: "<html><body>kein Kontoauszug</body></html>",
      accountId: sharedAccountId,
    });
    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("camt.053");
  });

  it("verweigert den Import ohne Edit-Recht auf das Konto", async () => {
    await expect(
      callerFor(member).finance.importCamt({
        xml: CAMT_BASIC,
        accountId: privateAccountId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
