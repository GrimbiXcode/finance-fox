/**
 * Lädt die Eingaben der AHV-Berechnung aus der Datenbank und löst dabei die
 * Ehepartner-Verknüpfung auf.
 *
 * Hier liegt die einzige Stelle, an der das Vorsorge-Modul Daten einer
 * **anderen** Person liest — überall sonst gilt striktes `userId`-Scoping.
 * Die Zustimmung dafür ist der **gegenseitige** Verweis: Nur wenn beide
 * Profile aufeinander zeigen, gilt der Link. Einseitig gesetzt bleibt er
 * folgenlos, sonst könnte sich jemand die privaten Vorsorgedaten eines
 * anderen im Alleingang freischalten.
 *
 * Gelesen wird zudem nur, was Plafonierung und Einkommensteilung brauchen:
 * Geburtsdatum, Geschlecht, erstes IK-Jahr und die Jahreseinkommen. Niemals
 * AHV-Nummer, Notizen oder Anhänge.
 */

import { and, eq } from "drizzle-orm";
import {
  pensionAhv,
  pensionAhvYears,
  pensionProfiles,
  users,
} from "@db/schema";
import type { Db } from "../../queries/connection";
import {
  computeAhv,
  type AhvComputeInput,
  type AhvWithdrawalInput,
  type AhvYearInput,
} from "./ahvCh";
import { AHV_FULL_SCALE, ahvParametersFor } from "./ahvParameters";

type AhvRow = typeof pensionAhv.$inferSelect;
type ProfileRow = typeof pensionProfiles.$inferSelect;

/** Was-wäre-wenn-Übersteuerung des geplanten Rentenbezugs */
export interface AhvOverride {
  withdrawal?: AhvWithdrawalInput;
}

export interface LoadedAhv {
  input: AhvComputeInput;
  /** Ist eine beidseitig bestätigte Ehepartner-Verknüpfung wirksam? */
  partnerLinked: boolean;
  /** Verweis gesetzt, aber (noch) nicht erwidert */
  partnerPending: boolean;
}

/** Jahreszeilen einer Person in die Engine-Form bringen */
function toYearInputs(
  rows: (typeof pensionAhvYears.$inferSelect)[]
): AhvYearInput[] {
  return rows
    .map(r => ({
      year: r.year,
      income: r.income,
      status: r.status,
      parentingCredit: r.parentingCredit,
      careCredit: r.careCredit,
    }))
    .sort((a, b) => a.year - b.year);
}

/** Geplanter Bezug aus den gespeicherten Feldern */
function storedWithdrawal(ahv: AhvRow | undefined): AhvWithdrawalInput {
  return {
    mode: ahv?.withdrawalMode ?? "none",
    months: ahv?.withdrawalMonths ?? 0,
    sharePct: ahv?.withdrawalSharePct ?? 100,
  };
}

/**
 * Wirksamer Ehepartner: gegenseitiger Verweis **und** aktiver Benutzer.
 * Liefert zusätzlich `pending`, damit das UI „Verknüpfung noch nicht
 * bestätigt" anzeigen kann, statt stillschweigend nichts zu tun.
 */
async function resolvePartner(
  db: Db,
  profile: ProfileRow
): Promise<{ profile: ProfileRow | null; pending: boolean }> {
  if (profile.partnerUserId === null) return { profile: null, pending: false };
  const [partnerProfile, partnerUser] = await Promise.all([
    db.query.pensionProfiles.findFirst({
      where: eq(pensionProfiles.userId, profile.partnerUserId),
    }),
    db.query.users.findFirst({ where: eq(users.id, profile.partnerUserId) }),
  ]);
  const mutual = partnerProfile?.partnerUserId === profile.userId;
  if (!partnerProfile || !partnerUser?.active || !mutual) {
    return { profile: null, pending: true };
  }
  return { profile: partnerProfile, pending: false };
}

/**
 * Baut die Berechnungs-Eingabe für `computeAhv`. Liefert null, wenn kein
 * Vorsorgeprofil existiert — die AHV-Rechnung braucht mindestens ein
 * Geburtsdatum.
 */
export async function loadAhvInput(
  db: Db,
  userId: number,
  override?: AhvOverride
): Promise<LoadedAhv | null> {
  const profile = await db.query.pensionProfiles.findFirst({
    where: eq(pensionProfiles.userId, userId),
  });
  if (!profile) return null;

  const [ahv, yearRows] = await Promise.all([
    db.query.pensionAhv.findFirst({ where: eq(pensionAhv.userId, userId) }),
    db.select().from(pensionAhvYears).where(eq(pensionAhvYears.userId, userId)),
  ]);

  const { profile: partnerProfile, pending } = await resolvePartner(
    db,
    profile
  );

  let splitting: AhvComputeInput["splitting"] = null;
  let partnerPensionMonthly: number | null = null;

  if (partnerProfile) {
    const [partnerAhv, partnerYears] = await Promise.all([
      db.query.pensionAhv.findFirst({
        where: eq(pensionAhv.userId, partnerProfile.userId),
      }),
      db
        .select()
        .from(pensionAhvYears)
        .where(eq(pensionAhvYears.userId, partnerProfile.userId)),
    ]);

    // Kalenderjahre der Ehe — Grundlage der Einkommensteilung (Merkblatt 3.01
    // Ziffer 18). Ohne Von-Jahr wird nicht gesplittet.
    if (ahv?.marriedFromYear) {
      const until = ahv.marriedUntilYear ?? new Date().getFullYear() + 60;
      const marriageYears: number[] = [];
      for (let y = ahv.marriedFromYear; y <= until; y++) marriageYears.push(y);
      splitting = {
        marriageYears,
        partnerIncomes: Object.fromEntries(
          partnerYears.map(r => [r.year, r.income])
        ),
      };
    }

    // Rente des Partners **ungekürzt** rechnen, sonst plafonierten sich
    // beide Seiten gegenseitig immer weiter herunter.
    const partnerResult = computeAhv({
      birthDate: partnerProfile.birthDate,
      gender: partnerAhv?.gender ?? "male",
      firstIkYear: partnerAhv?.firstIkYear ?? null,
      years: toYearInputs(partnerYears),
      withdrawal: storedWithdrawal(partnerAhv),
      splitting: splitting
        ? {
            marriageYears: splitting.marriageYears,
            partnerIncomes: Object.fromEntries(
              yearRows.map(r => [r.year, r.income])
            ),
          }
        : null,
      partnerPensionMonthly: null,
    });
    partnerPensionMonthly = partnerResult.monthlyPension;
  }

  return {
    input: {
      birthDate: profile.birthDate,
      gender: ahv?.gender ?? "male",
      firstIkYear: ahv?.firstIkYear ?? null,
      years: toYearInputs(yearRows),
      withdrawal: override?.withdrawal ?? storedWithdrawal(ahv),
      splitting,
      partnerPensionMonthly,
    },
    partnerLinked: partnerProfile !== null,
    partnerPending: pending,
  };
}

/**
 * Monatliche AHV-Rente für die Gesamtprognose (`pension.forecast`), in
 * absteigender Genauigkeit:
 *
 * 1. **Amtliche Rentenvorausberechnung** (`expectedMonthlyPension`) — wer das
 *    Formular 318.282 bestellt hat, hat die genauere Zahl als jede Rechnung.
 * 2. **Jahreszeilen** → volle Rentenformel nach Merkblatt 3.01.
 * 3. **Nur Beitragsjahre erfasst** → die alte lineare Näherung. Sie ist
 *    fachlich grob, bleibt aber als Rückfall bestehen: Bestandsdaten aus der
 *    Zeit vor der Jahres-Timeline dürfen nicht still auf null fallen, denn
 *    eine verschwundene AHV-Rente fiele in der Gesamtprognose sofort auf und
 *    sähe wie ein Datenverlust aus.
 */
export async function ahvMonthlyPensionFor(
  db: Db,
  userId: number
): Promise<{ monthlyPension: number; estimated: boolean } | null> {
  const ahv = await db.query.pensionAhv.findFirst({
    where: eq(pensionAhv.userId, userId),
  });
  if (ahv?.expectedMonthlyPension != null) {
    return { monthlyPension: ahv.expectedMonthlyPension, estimated: false };
  }
  const loaded = await loadAhvInput(db, userId);
  if (loaded && loaded.input.years.length > 0) {
    return {
      monthlyPension: computeAhv(loaded.input).monthlyPension,
      estimated: true,
    };
  }
  if (ahv?.contributionYears != null) {
    const params = ahvParametersFor(new Date().getFullYear());
    return {
      monthlyPension: Math.round(
        (params.maxPensionMonthly * ahv.contributionYears) / AHV_FULL_SCALE
      ),
      estimated: true,
    };
  }
  return null;
}

/** Eine Jahreszeile einer Person (für die CRUD-Endpunkte) */
export async function findAhvYear(db: Db, userId: number, year: number) {
  return db.query.pensionAhvYears.findFirst({
    where: and(
      eq(pensionAhvYears.userId, userId),
      eq(pensionAhvYears.year, year)
    ),
  });
}
