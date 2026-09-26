/**
 * Musterhaushalt für die Entwicklung: `npm run seed:demo`.
 *
 * Legt über die **tRPC-API** (nicht per SQL) einen realistischen Haushalt an:
 * zwei Personen, gemeinsame und private Konten, Kategorien mit
 * Unterkategorien, rund 14 Monate Buchungen mit Splits, Projekten und Tags,
 * Dauerbuchungen, Budgets, Sparziele, eine Liegenschaft mit Tranchen, Policen
 * mit Deckungen und ein Vorsorge-Profil. Über die API heißt: Rechte,
 * Audit-Log und Änderungsverläufe entstehen genau wie bei echter Bedienung,
 * und private Konten gehören der Person, die sie angelegt hat.
 *
 * Voraussetzung ist ein laufender Dev-Server mit Entwicklungs-Login:
 *
 *   npm run dev:agent        # Terminal 1
 *   npm run seed:demo        # Terminal 2
 *
 * Ohne `DEV_LOGIN=1` (und in Produktion) existiert `/api/dev/login` nicht —
 * dann bricht das Skript mit einem Hinweis ab. Es füllt nur eine Datenbank
 * **ohne Buchungen**; für einen Neustart `data/finance-fox.db` löschen und
 * den Dev-Server neu starten.
 *
 * Adresse: `SEED_URL` oder `http://localhost:$PORT` (Default 3000).
 */

const BASE =
  process.env.SEED_URL ?? `http://localhost:${process.env.PORT || 3000}`;

/* --------------------------------- API ---------------------------------- */

async function login(persona) {
  let res;
  try {
    res = await fetch(`${BASE}/api/dev/login?as=${persona}`, {
      redirect: "manual",
    });
  } catch {
    fail(
      `Kein Server unter ${BASE} erreichbar. Zuerst \`npm run dev:agent\` starten.`
    );
  }
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (res.status !== 302 || !cookie) {
    fail(
      `${BASE}/api/dev/login antwortet mit ${res.status}. Der Entwicklungs-Login ist ` +
        "nur mit `npm run dev:agent` (DEV_LOGIN=1, kein NODE_ENV=production) aktiv."
    );
  }
  return cookie;
}

function fail(message) {
  console.error(`\n  seed:demo abgebrochen: ${message}\n`);
  process.exit(1);
}

function client(cookie) {
  const unwrap = async (proc, res) => {
    const body = await res.json();
    if (body.error) {
      const msg = body.error.json?.message ?? JSON.stringify(body.error);
      throw new Error(`${proc}: ${msg}`);
    }
    return body.result?.data?.json;
  };
  return {
    call: async (proc, input) =>
      unwrap(
        proc,
        await fetch(`${BASE}/api/trpc/${proc}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ json: input }),
        })
      ),
    query: async proc =>
      unwrap(
        proc,
        await fetch(`${BASE}/api/trpc/${proc}`, { headers: { cookie } })
      ),
  };
}

/* ------------------------------- Hilfen --------------------------------- */

const iso = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
today.setHours(12, 0, 0, 0);

// Deterministischer Zufall — jeder Lauf erzeugt denselben Haushalt
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

const PENCIL = [
  "#2F6FC4",
  "#D9692C",
  "#1E9B73",
  "#D99A12",
  "#D5688F",
  "#2E8B2E",
  "#6A4FB8",
  "#C9403C",
];

/* -------------------------------- Ablauf -------------------------------- */

const adminCookie = await login("admin");
const memberCookie = await login("member");
const admin = client(adminCookie);
const member = client(memberCookie);

const me = await admin.query("auth.me");
const users = await admin.query("auth.listUsers");
const ADMIN = me.id;
const MEMBER = users.find(u => u.email === "dev-member@localhost")?.id;
if (!MEMBER) fail("Dev-Mitglied fehlt — Dev-Server neu starten.");

const existing = await admin.query("finance.hasData");
if (existing.hasTransactions) {
  fail(
    "Die Datenbank enthält bereits Buchungen. seed:demo füllt nur eine leere " +
      "Datenbank — für einen Neustart data/finance-fox.db löschen und den " +
      "Dev-Server neu starten."
  );
}
console.log(`seed:demo → ${BASE}`);

// --- Banken & Kontotypen (vorhandene werden wiederverwendet)
async function ensureNamed(listProc, createProc, name) {
  const found = (await admin.query(listProc)).find(x => x.name === name);
  if (found) return found;
  await admin.call(createProc, { name });
  return (await admin.query(listProc)).find(x => x.name === name);
}
const bank = {};
for (const n of ["Raiffeisen", "ZKB", "Neon"]) {
  bank[n] = (
    await ensureNamed("finance.listBanks", "finance.createBank", n)
  ).id;
}
const typeKey = {};
for (const n of ["Säule 3a", "Depot"]) {
  typeKey[n] = (
    await ensureNamed(
      "finance.listAccountTypes",
      "finance.createAccountType",
      n
    )
  ).key;
}

// --- Konten: das Gemeinschaftskonto des Dev-Logins wird zum Haushaltskonto
const accountsBefore = await admin.query("finance.listAccounts");
const shared =
  accountsBefore.find(a => a.name === "Gemeinschaftskonto") ??
  accountsBefore.find(a => a.owners.length === 0);
if (shared) {
  await admin.call("finance.updateAccount", {
    id: shared.id,
    name: "Haushaltskonto",
    type: "checking",
    initialBalance: 4_320_55,
    bankId: bank.Raiffeisen,
    iban: "CH93 0076 2011 6238 5295 7",
  });
}
async function account(api, name, type, initialBalance, bankName, iban, priv) {
  const found = (await api.query("finance.listAccounts")).find(
    a => a.name === name
  );
  if (found) return found.id;
  await api.call("finance.createAccount", {
    name,
    type,
    initialBalance,
    bankId: bankName ? bank[bankName] : null,
    iban: iban ?? null,
    private: priv,
  });
  return (await api.query("finance.listAccounts")).find(a => a.name === name)
    .id;
}
const HH = shared
  ? shared.id
  : await account(
      admin,
      "Haushaltskonto",
      "checking",
      4_320_55,
      "Raiffeisen",
      null,
      false
    );
const SPAR = await account(
  admin,
  "Sparkonto Haushalt",
  "savings",
  12_500_00,
  "Raiffeisen",
  "CH56 0483 5012 3456 7800 9",
  false
);
const FERIEN = await account(
  admin,
  "Ferienkasse",
  "savings",
  2_150_00,
  "ZKB",
  null,
  false
);
const BAR = await account(
  admin,
  "Haushaltskasse (Bar)",
  "cash",
  180_00,
  null,
  null,
  false
);
const DEPOT = await account(
  admin,
  "Depot ETF",
  typeKey.Depot,
  28_400_00,
  "ZKB",
  null,
  false
);
const SAM = await account(
  admin,
  "Privatkonto Sam",
  "checking",
  3_210_40,
  "Neon",
  "CH12 3456 7890 1234 5678 9",
  true
);
const S3A = await account(
  admin,
  "Säule 3a Sam",
  typeKey["Säule 3a"],
  41_200_00,
  "Raiffeisen",
  null,
  true
);
const ALEX = await account(
  member,
  "Privatkonto Alex",
  "checking",
  1_870_15,
  "ZKB",
  null,
  true
);

// --- Kategorien (vorhandene gleichen Namens werden wiederverwendet)
const CATEGORY_TREE = {
  income: { Lohn: [], Nebeneinkünfte: [], Rückerstattungen: [] },
  expense: {
    Wohnen: ["Miete", "Nebenkosten", "Internet & TV", "Hausrat"],
    Lebensmittel: ["Supermarkt", "Bäckerei", "Markt"],
    Mobilität: ["ÖV", "Auto", "Velo"],
    Freizeit: ["Restaurant", "Kino & Kultur", "Sport", "Abos & Streaming"],
    Gesundheit: ["Krankenkasse", "Arzt & Apotheke"],
    Versicherungen: [],
    Kinder: ["Kita", "Kleidung Kinder"],
    Kleidung: [],
    Ferien: [],
    Geschenke: [],
    Sonstiges: [],
  },
};
let colorIdx = 0;
for (const [type, roots] of Object.entries(CATEGORY_TREE)) {
  for (const [root, children] of Object.entries(roots)) {
    let cats = await admin.query("finance.listCategories");
    let parent = cats.find(
      c => c.name === root && c.type === type && c.parentId === null
    );
    if (!parent) {
      await admin.call("finance.createCategory", {
        name: root,
        type,
        color: PENCIL[colorIdx % PENCIL.length],
      });
      cats = await admin.query("finance.listCategories");
      parent = cats.find(
        c => c.name === root && c.type === type && c.parentId === null
      );
    }
    colorIdx += 1;
    for (const child of children) {
      if (cats.some(c => c.name === child && c.parentId === parent.id))
        continue;
      await admin.call("finance.createCategory", {
        name: child,
        type,
        color: parent.color,
        parentId: parent.id,
      });
    }
  }
}
const categories = await admin.query("finance.listCategories");
const cat = name => {
  const found = categories.find(c => c.name === name);
  if (!found) throw new Error(`Kategorie „${name}" fehlt.`);
  return found.id;
};

// --- Tags & Projekte
for (const n of [
  "Steuern",
  "Rückerstattung offen",
  "Geschäftlich",
  "Garantie",
]) {
  await ensureNamed("finance.listTags", "finance.createTag", n).catch(() => {});
}
const tags = await admin.query("finance.listTags");
const tag = n => tags.find(t => t.name === n).id;
const projectsBefore = await admin.query("finance.listProjects");
for (const [name, color] of [
  ["Ferien Italien", "#D9692C"],
  ["Küchenumbau", "#6A4FB8"],
]) {
  if (!projectsBefore.some(p => p.name === name)) {
    await admin.call("finance.createProject", { name, color });
  }
}
const projects = await admin.query("finance.listProjects");
const project = n => projects.find(p => p.name === n).id;

// --- Buchungen über 14 Monate (Buchungen auf Alex' Privatkonto bucht Alex)
let txCount = 0;
const tx = async input => {
  const api =
    input.accountId === ALEX || input.toAccountId === ALEX ? member : admin;
  await api.call("finance.createTransaction", input);
  txCount += 1;
};
const start = new Date(today.getFullYear(), today.getMonth() - 13, 1, 12);
for (let m = 0; m < 14; m += 1) {
  const y = start.getFullYear();
  const mo = start.getMonth() + m;
  const at = day => new Date(y, mo, day, 12);
  const d = day => iso(at(day));
  const due = day => at(day) <= today;
  if (!due(1)) break;
  process.stdout.write(`  Buchungen ${d(1).slice(0, 7)}\r`);

  if (due(25)) {
    await tx({
      type: "income",
      accountId: HH,
      amount: 6_850_00,
      categoryId: cat("Lohn"),
      userId: ADMIN,
      date: d(25),
      note: "Lohn Sam",
    });
    await tx({
      type: "income",
      accountId: HH,
      amount: 4_120_00 + (m % 3 === 0 ? 350_00 : 0),
      categoryId: cat("Lohn"),
      userId: MEMBER,
      date: d(25),
      note: "Lohn Alex",
    });
  }
  if (due(1))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 2_180_00,
      categoryId: cat("Miete"),
      userId: ADMIN,
      date: d(1),
      note: "Miete",
    });
  if (due(3))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 892_40,
      categoryId: cat("Krankenkasse"),
      userId: ADMIN,
      date: d(3),
      note: "Krankenkasse Sam & Alex",
    });
  if (due(5))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 79_00,
      categoryId: cat("Internet & TV"),
      userId: MEMBER,
      date: d(5),
      note: "Swisscom",
    });
  if (due(6))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 1_450_00,
      categoryId: cat("Kita"),
      userId: ADMIN,
      date: d(6),
      note: "Kita Mia",
    });
  if (due(10))
    await tx({
      type: "expense",
      accountId: SAM,
      amount: 17_90,
      categoryId: cat("Abos & Streaming"),
      userId: ADMIN,
      date: d(10),
      note: "Netflix",
    });
  if (due(12))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 165_00 + between(-40, 60) * 100,
      categoryId: cat("Nebenkosten"),
      userId: ADMIN,
      date: d(12),
      note: "EWZ Strom",
    });
  if (m % 3 === 1 && due(15))
    await tx({
      type: "expense",
      accountId: HH,
      amount: 640_00,
      categoryId: cat("Versicherungen"),
      userId: ADMIN,
      date: d(15),
      note: "Autoversicherung Quartal",
    });
  if (due(2))
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: BAR,
      amount: 200_00,
      userId: pick([ADMIN, MEMBER]),
      date: d(2),
      note: "Bargeldbezug",
    });
  if (due(26)) {
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: SPAR,
      amount: 800_00,
      userId: ADMIN,
      date: d(26),
      note: "Sparen",
    });
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: FERIEN,
      amount: 300_00,
      userId: MEMBER,
      date: d(26),
      note: "Ferienkasse",
    });
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: SAM,
      amount: 900_00,
      userId: ADMIN,
      date: d(26),
      note: "Taschengeld Sam",
    });
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: ALEX,
      amount: 900_00,
      userId: MEMBER,
      date: d(26),
      note: "Taschengeld Alex",
    });
  }
  if (m % 2 === 0 && due(27))
    await tx({
      type: "transfer",
      accountId: HH,
      toAccountId: DEPOT,
      amount: 500_00,
      userId: ADMIN,
      date: d(27),
      note: "ETF Sparplan",
    });

  // Variable Ausgaben
  const days = new Date(y, mo + 1, 0).getDate();
  for (let day = 1; day <= days && due(day); day += 1) {
    const r = rnd();
    if (r < 0.45) {
      const cash = rnd() < 0.2;
      await tx({
        type: "expense",
        accountId: cash ? BAR : HH,
        amount: cash ? between(8_00, 45_00) : between(12_00, 140_00),
        categoryId: cat(
          pick(["Supermarkt", "Supermarkt", "Supermarkt", "Bäckerei", "Markt"])
        ),
        userId: pick([ADMIN, MEMBER]),
        date: d(day),
        note: pick([
          "Coop",
          "Migros",
          "Denner",
          "Bäckerei Steiner",
          "Wochenmarkt",
          "Aldi",
        ]),
      });
    }
    if (r > 0.82)
      await tx({
        type: "expense",
        accountId: pick([HH, SAM, ALEX]),
        amount: between(18_00, 96_00),
        categoryId: cat(pick(["Restaurant", "Kino & Kultur", "Sport"])),
        userId: pick([ADMIN, MEMBER]),
        date: d(day),
        note: pick([
          "Pizzeria Da Vito",
          "Kino Kosmos",
          "Hallenbad",
          "Thai Take-away",
          "Café Zähringer",
          "Museum",
        ]),
      });
    if (r > 0.93)
      await tx({
        type: "expense",
        accountId: HH,
        amount: between(3_20, 62_00),
        categoryId: cat(pick(["ÖV", "Auto", "Auto"])),
        userId: pick([ADMIN, MEMBER]),
        date: d(day),
        note: pick([
          "SBB Tageskarte",
          "Tanken",
          "Parkhaus",
          "Autobahnvignette",
        ]),
      });
    if (day % 11 === 0)
      await tx({
        type: "expense",
        accountId: HH,
        amount: between(15_00, 220_00),
        categoryId: cat(
          pick([
            "Arzt & Apotheke",
            "Kleidung",
            "Kleidung Kinder",
            "Geschenke",
            "Sonstiges",
            "Hausrat",
          ])
        ),
        userId: pick([ADMIN, MEMBER]),
        date: d(day),
        note: pick([
          "Apotheke",
          "H&M",
          "Geschenk Oma",
          "Baumarkt",
          "IKEA",
          "Zahnarzt",
        ]),
      });
  }
  // Geteilte Ausgaben aus Privatkonten — erzeugen offene Salden
  if (due(14))
    await tx({
      type: "expense",
      accountId: SAM,
      amount: 240_00,
      categoryId: cat("Restaurant"),
      userId: ADMIN,
      date: d(14),
      note: "Geburtstagsessen",
      splits: [
        { userId: ADMIN, amount: 120_00 },
        { userId: MEMBER, amount: 120_00 },
      ],
    });
  if (m % 2 === 1 && due(20))
    await tx({
      type: "expense",
      accountId: ALEX,
      amount: 186_50,
      categoryId: cat("Hausrat"),
      userId: MEMBER,
      date: d(20),
      note: "Putzmittel & Haushaltswaren",
      splits: [
        { userId: ADMIN, amount: 93_25 },
        { userId: MEMBER, amount: 93_25 },
      ],
    });
}
const daysAgo = n => iso(new Date(today.getTime() - n * 86_400_000));
await tx({
  type: "expense",
  accountId: HH,
  amount: 1_280_00,
  categoryId: cat("Ferien"),
  userId: ADMIN,
  date: daysAgo(70),
  note: "Ferienwohnung Toskana",
  projectId: project("Ferien Italien"),
  splits: [
    { userId: ADMIN, amount: 640_00 },
    { userId: MEMBER, amount: 640_00 },
  ],
});
await tx({
  type: "expense",
  accountId: ALEX,
  amount: 412_30,
  categoryId: cat("Ferien"),
  userId: MEMBER,
  date: daysAgo(66),
  note: "Autobahn & Tanken Italien",
  projectId: project("Ferien Italien"),
  splits: [
    { userId: ADMIN, amount: 206_15 },
    { userId: MEMBER, amount: 206_15 },
  ],
});
await tx({
  type: "expense",
  accountId: SAM,
  amount: 356_00,
  categoryId: cat("Restaurant"),
  userId: ADMIN,
  date: daysAgo(63),
  note: "Osteria & Gelato",
  projectId: project("Ferien Italien"),
  splits: [
    { userId: ADMIN, amount: 178_00 },
    { userId: MEMBER, amount: 178_00 },
  ],
});
// Italien ausgeglichen und abgeschlossen: Sam hat 1'636.00 bezahlt, Alex
// 412.30, getragen hat jede Person 1'024.15 — Alex überweist 611.85 in der
// Form, die „Verbuchen“ auf der Aufteilung anlegt (Ausgabe, die ganz die
// andere Person trägt)
await tx({
  type: "expense",
  accountId: ALEX,
  amount: 611_85,
  userId: MEMBER,
  date: daysAgo(58),
  note: "Ausgleich an Dev Admin",
  projectId: project("Ferien Italien"),
  splits: [{ userId: ADMIN, amount: 611_85 }],
});
await admin.call("finance.setProjectClosed", {
  id: project("Ferien Italien"),
  closed: true,
});
await tx({
  type: "expense",
  accountId: HH,
  amount: 4_890_00,
  categoryId: cat("Hausrat"),
  userId: ADMIN,
  date: daysAgo(40),
  note: "Küchengeräte",
  projectId: project("Küchenumbau"),
  tagIds: [tag("Garantie")],
});
await tx({
  type: "expense",
  accountId: HH,
  amount: 2_100_00,
  categoryId: cat("Hausrat"),
  userId: ADMIN,
  date: daysAgo(28),
  note: "Schreiner Anzahlung",
  projectId: project("Küchenumbau"),
});
await tx({
  type: "expense",
  accountId: SAM,
  amount: 89_90,
  categoryId: cat("Sonstiges"),
  userId: ADMIN,
  date: daysAgo(9),
  note: "Drucker-Toner (Firma zahlt zurück)",
  tagIds: [tag("Geschäftlich"), tag("Rückerstattung offen")],
});
await tx({
  type: "income",
  accountId: HH,
  amount: 612_00,
  categoryId: cat("Rückerstattungen"),
  userId: ADMIN,
  date: daysAgo(33),
  note: "Krankenkasse Rückerstattung",
  tagIds: [tag("Steuern")],
});
await tx({
  type: "income",
  accountId: ALEX,
  amount: 450_00,
  categoryId: cat("Nebeneinkünfte"),
  userId: MEMBER,
  date: daysAgo(15),
  note: "Flohmarkt-Verkauf",
});
console.log(`  ${txCount} Buchungen angelegt          `);

// --- Budgets (Monat und Jahr, eins mit Rollover)
for (const [name, amount, period, rollover] of [
  ["Lebensmittel", 1_100_00, "monthly", false],
  ["Freizeit", 450_00, "monthly", true],
  ["Mobilität", 350_00, "monthly", false],
  ["Kleidung", 150_00, "monthly", true],
  ["Ferien", 6_000_00, "yearly", false],
  ["Geschenke", 1_200_00, "yearly", false],
]) {
  await admin.call("finance.setBudget", {
    categoryId: cat(name),
    amount,
    period,
    rollover,
  });
}

// --- Dauerbuchungen (nächste Fälligkeit ab morgen)
const next = day => {
  const n = new Date(today.getFullYear(), today.getMonth(), day, 12);
  if (n <= today) n.setMonth(n.getMonth() + 1);
  return iso(n);
};
const rec = input =>
  (input.accountId === ALEX || input.toAccountId === ALEX
    ? member
    : admin
  ).call("finance.createRecurring", input);
await rec({
  type: "income",
  accountId: HH,
  amount: 6_850_00,
  categoryId: cat("Lohn"),
  userId: ADMIN,
  note: "Lohn Sam",
  interval: "monthly",
  nextDate: next(25),
});
await rec({
  type: "income",
  accountId: HH,
  amount: 4_120_00,
  categoryId: cat("Lohn"),
  userId: MEMBER,
  note: "Lohn Alex",
  interval: "monthly",
  nextDate: next(25),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 2_180_00,
  categoryId: cat("Miete"),
  userId: ADMIN,
  note: "Miete",
  interval: "monthly",
  nextDate: next(1),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 892_40,
  categoryId: cat("Krankenkasse"),
  userId: ADMIN,
  note: "Krankenkasse",
  interval: "monthly",
  nextDate: next(3),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 79_00,
  categoryId: cat("Internet & TV"),
  userId: MEMBER,
  note: "Swisscom",
  interval: "monthly",
  nextDate: next(5),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 1_450_00,
  categoryId: cat("Kita"),
  userId: ADMIN,
  note: "Kita Mia",
  interval: "monthly",
  nextDate: next(6),
});
await rec({
  type: "expense",
  accountId: SAM,
  amount: 17_90,
  categoryId: cat("Abos & Streaming"),
  userId: ADMIN,
  note: "Netflix",
  interval: "monthly",
  nextDate: next(10),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 640_00,
  categoryId: cat("Versicherungen"),
  userId: ADMIN,
  note: "Autoversicherung",
  interval: "quarterly",
  nextDate: next(15),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 1_980_00,
  categoryId: cat("Versicherungen"),
  userId: ADMIN,
  note: "Hausrat & Haftpflicht",
  interval: "yearly",
  nextDate: iso(new Date(today.getFullYear() + 1, 0, 15, 12)),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: BAR,
  amount: 200_00,
  userId: ADMIN,
  note: "Bargeldbezug",
  interval: "monthly",
  nextDate: next(2),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: SPAR,
  amount: 800_00,
  userId: ADMIN,
  note: "Sparen",
  interval: "monthly",
  nextDate: next(26),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: FERIEN,
  amount: 300_00,
  userId: MEMBER,
  note: "Ferienkasse",
  interval: "monthly",
  nextDate: next(26),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: SAM,
  amount: 900_00,
  userId: ADMIN,
  note: "Taschengeld Sam",
  interval: "monthly",
  nextDate: next(26),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: ALEX,
  amount: 900_00,
  userId: MEMBER,
  note: "Taschengeld Alex",
  interval: "monthly",
  nextDate: next(26),
});
await rec({
  type: "transfer",
  accountId: HH,
  toAccountId: DEPOT,
  amount: 500_00,
  userId: ADMIN,
  note: "ETF Sparplan",
  interval: "monthly",
  nextDate: next(27),
});
await rec({
  type: "transfer",
  accountId: SAM,
  toAccountId: S3A,
  amount: 588_00,
  userId: ADMIN,
  note: "Säule 3a Einzahlung",
  interval: "monthly",
  nextDate: next(28),
});
await rec({
  type: "expense",
  accountId: HH,
  amount: 45_00,
  categoryId: cat("Sport"),
  userId: MEMBER,
  note: "Fitnessabo",
  interval: "monthly",
  nextDate: next(2),
});
const fitness = (await admin.query("finance.listRecurring")).find(
  r => r.note === "Fitnessabo"
);
if (fitness?.active)
  await admin.call("finance.toggleRecurring", { id: fitness.id });

// --- Sparziele mit Konto-Verknüpfung
const goalsBefore = await admin.query("finance.listGoals");
const goalDefs = [
  {
    name: "Ferien Japan",
    targetAmount: 9_000_00,
    color: "#D9692C",
    deadline: iso(new Date(today.getFullYear() + 1, 6, 1, 12)),
    source: { accountId: FERIEN, mode: "full" },
  },
  {
    name: "Notgroschen",
    targetAmount: 30_000_00,
    color: "#1E9B73",
    source: { accountId: SPAR, mode: "full" },
  },
  {
    name: "Neues Velo",
    targetAmount: 3_500_00,
    color: "#2F6FC4",
    deadline: iso(new Date(today.getFullYear(), today.getMonth() + 5, 1, 12)),
    source: { accountId: SAM, mode: "absolute", value: 1_200_00 },
  },
  {
    name: "Langfristig anlegen",
    color: "#6A4FB8",
    source: { accountId: DEPOT, mode: "full" },
  },
];
for (const { source, ...goal } of goalDefs) {
  if (goalsBefore.some(g => g.name === goal.name)) continue;
  await admin.call("finance.createGoal", goal);
  const created = (await admin.query("finance.listGoals")).find(
    g => g.name === goal.name
  );
  await admin.call("finance.addGoalSource", { goalId: created.id, ...source });
}

// --- Liegenschaft mit zwei Tranchen
if ((await admin.query("mortgage.listProperties")).length === 0) {
  await admin.call("mortgage.addProperty", {
    name: "Reihenhaus Sonnenweg 12",
    address: "Sonnenweg 12, 8600 Dübendorf",
    usage: "owner_occupied",
    purchasePrice: 1_050_000_00,
    purchaseDate: "2021-04-01",
    marketValue: 1_180_000_00,
    valueDate: iso(new Date(today.getFullYear(), 0, 15, 12)),
    householdIncome: 158_000_00,
  });
  const propertyId = (await admin.query("mortgage.listProperties"))[0].id;
  const balanceDate = iso(new Date(today.getFullYear(), 0, 1, 12));
  await admin.call("mortgage.addTranche", {
    propertyId,
    name: "Festhypothek 10 Jahre",
    kind: "fixed",
    principal: 520_000_00,
    balanceDate,
    interestRateBp: 121,
    bankId: bank.Raiffeisen,
    startDate: "2021-04-01",
    maturityDate: "2031-03-31",
    paymentInterval: "quarterly",
  });
  await admin.call("mortgage.addTranche", {
    propertyId,
    name: "SARON-Tranche",
    kind: "saron",
    principal: 220_000_00,
    balanceDate,
    interestRateBp: 45,
    marginBp: 80,
    bankId: bank.Raiffeisen,
    startDate: "2021-04-01",
    maturityDate: iso(
      new Date(today.getFullYear(), today.getMonth() + 2, 28, 12)
    ),
    paymentInterval: "quarterly",
  });
}

// --- Versicherungen mit Deckungen
if ((await admin.query("insurance.listPolicies")).length === 0) {
  const mainDue = iso(new Date(today.getFullYear() + 1, 0, 1, 12));
  const policies = [
    {
      name: "Grundversicherung Sam",
      branch: "krankenkasse_grund",
      insurer: "CSS",
      premium: 412_60,
      premiumInterval: "monthly",
      deductible: 2_500_00,
      startDate: "2019-01-01",
      mainDueDate: mainDue,
      noticePeriodMonths: 1,
      accountId: HH,
      personIds: [ADMIN],
    },
    {
      name: "Grundversicherung Alex",
      branch: "krankenkasse_grund",
      insurer: "Helsana",
      premium: 398_20,
      premiumInterval: "monthly",
      deductible: 300_00,
      startDate: "2020-01-01",
      mainDueDate: mainDue,
      noticePeriodMonths: 1,
      accountId: HH,
      personIds: [MEMBER],
    },
    {
      name: "Hausrat & Privathaftpflicht",
      branch: "hausrat",
      insurer: "Mobiliar",
      policyNumber: "MOB-4471-22",
      premium: 1_980_00,
      premiumInterval: "yearly",
      deductible: 200_00,
      startDate: "2021-05-01",
      mainDueDate: iso(new Date(today.getFullYear() + 1, 0, 15, 12)),
      noticePeriodMonths: 3,
      accountId: HH,
      personIds: [],
      coverages: [
        { label: "Hausrat (Neuwert)", sumInsured: 120_000_00 },
        { label: "Privathaftpflicht", sumInsured: 10_000_000_00 },
        { label: "Glasbruch", sumInsured: null, deductible: 0 },
      ],
    },
    {
      name: "Auto Vollkasko",
      branch: "motorfahrzeug",
      insurer: "AXA",
      premium: 640_00,
      premiumInterval: "quarterly",
      deductible: 1_000_00,
      startDate: "2023-03-01",
      mainDueDate: iso(
        new Date(today.getFullYear(), today.getMonth() + 3, 1, 12)
      ),
      noticePeriodMonths: 3,
      accountId: HH,
      personIds: [],
      coverages: [
        { label: "Haftpflicht", sumInsured: 100_000_000_00 },
        { label: "Vollkasko", sumInsured: null, deductible: 1_000_00 },
        { label: "Parkschaden", sumInsured: 1_000_00, deductible: 0 },
      ],
    },
    {
      name: "Rechtsschutz (Angebot)",
      branch: "rechtsschutz",
      insurer: "Protekta",
      status: "quote",
      premium: 290_00,
      premiumInterval: "yearly",
      startDate: iso(today),
      personIds: [],
    },
  ];
  for (const { coverages = [], ...policy } of policies) {
    await admin.call("insurance.addPolicy", policy);
    const created = (await admin.query("insurance.listPolicies")).find(
      p => p.name === policy.name
    );
    for (const coverage of coverages) {
      await admin.call("insurance.addCoverage", {
        policyId: created.id,
        ...coverage,
      });
    }
  }
}

// --- Vorsorge-Profil (privat, nur für Dev Admin)
if (!(await admin.query("pension.getProfile"))) {
  await admin.call("pension.updateProfile", {
    birthDate: "1987-06-14",
    retirementAge: 65,
  });
}

console.log(
  "  fertig — anmelden mit /api/dev/login (Admin) bzw. /api/dev/login?as=member"
);
