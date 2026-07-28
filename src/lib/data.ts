import { trpc } from '@/providers/trpc';

/** Gemeinsamer Hook: lädt alle Finanzdaten des Haushalts */
export function useFinanceData() {
  const accounts = trpc.finance.listAccounts.useQuery();
  const accountTypes = trpc.finance.listAccountTypes.useQuery();
  const banks = trpc.finance.listBanks.useQuery();
  const categories = trpc.finance.listCategories.useQuery();
  const transactions = trpc.finance.listTransactions.useQuery();
  const budgets = trpc.finance.listBudgets.useQuery();
  const recurring = trpc.finance.listRecurring.useQuery();
  const goals = trpc.finance.listGoals.useQuery();
  const users = trpc.auth.listUsers.useQuery();

  const isLoading = accounts.isLoading || accountTypes.isLoading || banks.isLoading
    || categories.isLoading || transactions.isLoading
    || budgets.isLoading || recurring.isLoading || goals.isLoading || users.isLoading;

  return {
    accounts: accounts.data ?? [],
    accountTypes: accountTypes.data ?? [],
    banks: banks.data ?? [],
    categories: categories.data ?? [],
    transactions: transactions.data ?? [],
    budgets: budgets.data ?? [],
    recurring: recurring.data ?? [],
    goals: goals.data ?? [],
    users: users.data ?? [],
    isLoading,
  };
}

/** Invalidiert nach einer Mutation alle Finanz-Queries */
export function useInvalidateFinance() {
  const utils = trpc.useUtils();
  return () => {
    utils.finance.listAccounts.invalidate();
    utils.finance.listAccountTypes.invalidate();
    utils.finance.listBanks.invalidate();
    utils.finance.listTransactions.invalidate();
    utils.finance.listBudgets.invalidate();
    utils.finance.listBudgetStatus.invalidate();
    utils.finance.listRecurring.invalidate();
    utils.finance.listGoals.invalidate();
    utils.finance.listCategories.invalidate();
    utils.finance.getAppSettings.invalidate();
    utils.finance.yearComparison.invalidate();
    utils.forecast.balance.invalidate();
    utils.forecast.budgetForecast.invalidate();
    utils.forecast.goalForecast.invalidate();
  };
}
