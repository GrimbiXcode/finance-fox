import { trpc } from '@/providers/trpc';

/** Gemeinsamer Hook: lädt alle Finanzdaten des Haushalts */
export function useFinanceData() {
  const accounts = trpc.finance.listAccounts.useQuery();
  const accountTypes = trpc.finance.listAccountTypes.useQuery();
  const banks = trpc.finance.listBanks.useQuery();
  const categories = trpc.finance.listCategories.useQuery();
  const tags = trpc.finance.listTags.useQuery();
  const transactions = trpc.finance.listTransactions.useQuery();
  const budgets = trpc.finance.listBudgets.useQuery();
  const recurring = trpc.finance.listRecurring.useQuery();
  const goals = trpc.finance.listGoals.useQuery();
  const projects = trpc.finance.listProjects.useQuery();
  const splitTemplates = trpc.finance.listSplitTemplates.useQuery();
  const users = trpc.auth.listUsers.useQuery();

  const isLoading = accounts.isLoading || accountTypes.isLoading || banks.isLoading
    || categories.isLoading || tags.isLoading || transactions.isLoading
    || budgets.isLoading || recurring.isLoading || goals.isLoading
    || projects.isLoading || splitTemplates.isLoading || users.isLoading;

  return {
    accounts: accounts.data ?? [],
    accountTypes: accountTypes.data ?? [],
    banks: banks.data ?? [],
    categories: categories.data ?? [],
    tags: tags.data ?? [],
    transactions: transactions.data ?? [],
    budgets: budgets.data ?? [],
    recurring: recurring.data ?? [],
    goals: goals.data ?? [],
    projects: projects.data ?? [],
    splitTemplates: splitTemplates.data ?? [],
    users: users.data ?? [],
    isLoading,
  };
}

/**
 * Anzeigename eines Kontos in Auswahllisten: „Kontoname (Bankname)",
 * Konten ohne Bank bleiben beim reinen Namen.
 */
export function accountLabel(
  account: { name: string; bankId: number | null },
  banks: { id: number; name: string }[],
): string {
  if (account.bankId === null) return account.name;
  const bank = banks.find((b) => b.id === account.bankId);
  return bank ? `${account.name} (${bank.name})` : account.name;
}

/** Invalidiert nach einer Mutation alle Finanz-Queries */
export function useInvalidateFinance() {
  const utils = trpc.useUtils();
  return () => {
    utils.finance.listAccounts.invalidate();
    utils.finance.accountBalanceHistory.invalidate();
    utils.finance.listAccountTypes.invalidate();
    utils.finance.listBanks.invalidate();
    utils.finance.listTransactions.invalidate();
    utils.finance.listTransactionChanges.invalidate();
    utils.finance.listBudgets.invalidate();
    utils.finance.listBudgetStatus.invalidate();
    utils.finance.listRecurring.invalidate();
    utils.finance.listGoals.invalidate();
    utils.finance.listGoalContributions.invalidate();
    utils.finance.listCategories.invalidate();
    utils.finance.listTags.invalidate();
    utils.finance.listProjects.invalidate();
    utils.finance.listSplitTemplates.invalidate();
    utils.finance.getAppSettings.invalidate();
    utils.finance.yearComparison.invalidate();
    utils.forecast.balance.invalidate();
    utils.forecast.budgetForecast.invalidate();
    utils.forecast.goalForecast.invalidate();
    utils.forecast.table.invalidate();
    utils.forecast.accountBalance.invalidate();
    // Eine neue Buchung verschiebt auch die Nettovermögens-Zeile
    utils.mortgage.summary.invalidate();
    // Gelöschte Dauerbuchungen/Konten wirken auf die Policen-Badges
    utils.insurance.listPolicies.invalidate();
    utils.insurance.summary.invalidate();
  };
}

/** Invalidiert nach einer Mutation alle Hypotheken-Queries */
export function useInvalidateMortgage() {
  const utils = trpc.useUtils();
  return () => {
    utils.mortgage.listProperties.invalidate();
    utils.mortgage.listTranches.invalidate();
    utils.mortgage.listAmortizations.invalidate();
    utils.mortgage.forecast.invalidate();
    utils.mortgage.summary.invalidate();
    utils.mortgage.listChanges.invalidate();
    // Übernommene Dauerbuchungen und das Nettovermögen der Prognose
    utils.finance.listRecurring.invalidate();
    utils.forecast.balance.invalidate();
    // Eine neue Liegenschaft verschiebt die Gebäude-Lücke
    utils.insurance.gapAnalysis.invalidate();
    utils.insurance.summary.invalidate();
  };
}

/** Invalidiert nach einer Mutation alle Versicherungs-Queries */
export function useInvalidateInsurance() {
  const utils = trpc.useUtils();
  return () => {
    utils.insurance.listPolicies.invalidate();
    utils.insurance.listCoverages.invalidate();
    utils.insurance.listAttachments.invalidate();
    utils.insurance.listChanges.invalidate();
    utils.insurance.gapAnalysis.invalidate();
    utils.insurance.summary.invalidate();
    // Übernommene Prämien landen in den Dauerbuchungen und der Prognose
    utils.finance.listRecurring.invalidate();
    utils.forecast.balance.invalidate();
  };
}

/** Invalidiert nach einer Mutation alle Vorsorge-Queries (pension-Namespace) */
export function useInvalidatePension() {
  const utils = trpc.useUtils();
  return () => {
    utils.pension.getProfile.invalidate();
    utils.pension.listSalaries.invalidate();
    utils.pension.listDeductions.invalidate();
    utils.pension.getAhv.invalidate();
    utils.pension.listFunds.invalidate();
    utils.pension.listPillar3.invalidate();
    utils.pension.forecast.invalidate();
    utils.pension.listChanges.invalidate();
  };
}
