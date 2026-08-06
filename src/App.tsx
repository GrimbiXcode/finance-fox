import { Routes, Route, Navigate } from 'react-router'
import { TRPCProvider } from '@/providers/trpc'
import { AuthProvider, useAuth } from '@/providers/auth'
import { Toaster } from '@/components/ui/sonner'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import Transactions from '@/pages/Transactions'
import Accounts from '@/pages/Accounts'
import MoneyFlow from '@/pages/MoneyFlow'
import Budgets from '@/pages/Budgets'
import Splitting from '@/pages/Splitting'
import Recurring from '@/pages/Recurring'
import Goals from '@/pages/Goals'
import Pension from '@/pages/Pension'
import Mortgages from '@/pages/Mortgages'
import Insurances from '@/pages/Insurances'
import Forecasts from '@/pages/Forecasts'
import YearReview from '@/pages/YearReview'
import Report from '@/pages/Report'
import Settings from '@/pages/Settings'
import UsersPage from '@/pages/Users'
import Login from '@/pages/Login'
import Setup from '@/pages/Setup'
import SetPassword from '@/pages/SetPassword'
import { PiggyBank } from 'lucide-react'

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <PiggyBank className="h-10 w-10 animate-pulse text-emerald-600" />
        <span className="text-sm">Finance Fox wird geladen…</span>
      </div>
    </div>
  )
}

function Root() {
  const { user, needsSetup } = useAuth()
  const hash = window.location.hash

  // Einladungs-/Reset-Links sind immer erreichbar
  if (hash.startsWith('#/einladung/')) return <SetPassword purpose="invite" />
  if (hash.startsWith('#/reset/')) return <SetPassword purpose="reset" />

  if (user === undefined || needsSetup === undefined) return <Loading />
  if (needsSetup) return <Setup />
  if (!user) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transaktionen" element={<Transactions />} />
        <Route path="/konten" element={<Accounts />} />
        <Route path="/geldfluss" element={<MoneyFlow />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/aufteilung" element={<Splitting />} />
        <Route path="/wiederkehrend" element={<Recurring />} />
        <Route path="/sparziele" element={<Goals />} />
        <Route path="/vorsorge" element={<Pension />} />
        <Route path="/hypotheken" element={<Mortgages />} />
        <Route path="/versicherungen" element={<Insurances />} />
        <Route path="/prognosen" element={<Forecasts />} />
        <Route path="/auswertung" element={<YearReview />} />
        <Route path="/bericht" element={<Report />} />
        <Route path="/personen" element={<UsersPage />} />
        <Route path="/einstellungen" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <TRPCProvider>
      <AuthProvider>
        <Root />
        <Toaster richColors position="bottom-right" />
      </AuthProvider>
    </TRPCProvider>
  )
}
