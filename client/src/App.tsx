import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/layout/AppShell";
import { useUIStore } from "@/stores/ui";
import { useSettings } from "@/hooks/useSettings";
import { useMe, useCanSeeWealth } from "@/hooks/useAuth";
import { PinLock } from "@/features/settings/PinLock";

/*
 * Pages load on demand. Importing all 26 up front put every screen — plus
 * recharts, which most of them pull in — into the entry bundle, so opening the
 * login page downloaded the whole app. Each page is its own chunk now; the
 * Suspense boundaries below cover the fetch.
 */
const DashboardPage = lazy(() => import("@/routes/DashboardPage"));
const TransactionsPage = lazy(() => import("@/routes/TransactionsPage"));
const AccountsPage = lazy(() => import("@/routes/AccountsPage"));
const AccountDetailPage = lazy(() => import("@/routes/AccountDetailPage"));
const BudgetsPage = lazy(() => import("@/routes/BudgetsPage"));
const GoalsPage = lazy(() => import("@/routes/GoalsPage"));
const NetWorthPage = lazy(() => import("@/routes/NetWorthPage"));
const LoansPage = lazy(() => import("@/routes/LoansPage"));
const CreditsPage = lazy(() => import("@/routes/CreditsPage"));
const GoldPage = lazy(() => import("@/routes/GoldPage"));
const StocksPage = lazy(() => import("@/routes/StocksPage"));
const FundsPage = lazy(() => import("@/routes/FundsPage"));
const ReportsPage = lazy(() => import("@/routes/ReportsPage"));
const InsightsPage = lazy(() => import("@/routes/InsightsPage"));
const CalendarPage = lazy(() => import("@/routes/CalendarPage"));
const RecurringPage = lazy(() => import("@/routes/RecurringPage"));
const CategoriesPage = lazy(() => import("@/routes/CategoriesPage"));
const NotificationsPage = lazy(() => import("@/routes/NotificationsPage"));
const SettingsPage = lazy(() => import("@/routes/SettingsPage"));
const NotFoundPage = lazy(() => import("@/routes/NotFoundPage"));
const LoginPage = lazy(() => import("@/routes/LoginPage"));
const TwoFactorPage = lazy(() => import("@/routes/TwoFactorPage"));
const SignupPage = lazy(() => import("@/routes/SignupPage"));
const VerifyEmailPage = lazy(() => import("@/routes/VerifyEmailPage"));
const ForgotPasswordPage = lazy(() => import("@/routes/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/routes/ResetPasswordPage"));

/** Hydrate per-user settings (currency, PIN) once authenticated. */
function AuthedBootstrap() {
  const setCurrencyConfig = useUIStore((s) => s.setCurrencyConfig);
  const setLocked = useUIStore((s) => s.setLocked);
  const { data: settings } = useSettings();

  useEffect(() => {
    if (!settings) return;
    const cur = settings.currencies.find((c) => c.code === settings.baseCurrency);
    setCurrencyConfig({
      baseCurrency: settings.baseCurrency,
      symbol: cur?.symbol ?? "₹",
      locale: settings.locale,
    });
    if (settings.pinEnabled) setLocked(true);
    // Theme + language follow the account: apply the server-stored preferences on
    // load. Read the store imperatively so a local toggle (which refetches
    // settings) doesn't get reverted by this effect.
    const { theme, setTheme, language, setLanguage } = useUIStore.getState();
    if (settings.theme && settings.theme !== theme) setTheme(settings.theme);
    if (settings.language && settings.language !== language) setLanguage(settings.language);
  }, [settings, setCurrencyConfig, setLocked]);

  return null;
}

function FullScreenSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/** Gate the app on a session; redirect to /login when unauthenticated. */
function RequireAuth() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <FullScreenSplash />;
  if (!me) return <Navigate to="/login" replace />;
  // Signed in but email not confirmed → hold them at the verify screen.
  if (!me.emailVerified) return <Navigate to="/verify-email" replace />;
  return (
    <>
      <AuthedBootstrap />
      <PinLock />
      <Outlet />
    </>
  );
}

/** Block wealth-only routes (Net Worth) in the everyday user view. */
function RequireWealth() {
  const canSeeWealth = useCanSeeWealth();
  if (!canSeeWealth) return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * Suspense boundary for the signed-out pages, which render on their own with no
 * shell around them.
 */
function PublicRoutes() {
  return (
    <Suspense fallback={<FullScreenSplash />}>
      <Outlet />
    </Suspense>
  );
}

/**
 * Suspense boundary for the pages inside the shell. It sits *under* AppShell on
 * purpose: the sidebar, top bar and bottom nav stay mounted while a page chunk
 * loads, so only the content area shows the spinner.
 */
function ShellRoutes() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

export function App() {
  const applyTheme = useUIStore((s) => s.applyTheme);

  // apply theme on mount + react to OS theme changes (no auth needed)
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [applyTheme]);

  return (
    <TooltipProvider delayDuration={200}>
      <Routes>
        <Route element={<PublicRoutes />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/2fa" element={<TwoFactorPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route element={<ShellRoutes />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/accounts/:id" element={<AccountDetailPage />} />
              <Route path="/budgets" element={<BudgetsPage />} />
              <Route path="/goals" element={<GoalsPage />} />
              <Route element={<RequireWealth />}>
                <Route path="/net-worth" element={<NetWorthPage />} />
                {/* Stocks show position values and feed net worth, so they sit
                    behind the same lock (matched server-side on /api/stocks). */}
                <Route path="/stocks" element={<StocksPage />} />
                <Route path="/funds" element={<FundsPage />} />
              </Route>
              <Route path="/loans" element={<LoansPage />} />
              <Route path="/credits" element={<CreditsPage />} />
              <Route path="/gold" element={<GoldPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/recurring" element={<RecurringPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </TooltipProvider>
  );
}
