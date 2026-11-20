import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoadingBlock } from "@/components/kit";
import { HomeRedirect, Layout } from "@/components/Layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { toast, Toaster } from "@/lib/toast";
// Login is the entry point for every session, so it ships in the main bundle and renders without a lazy-load gap.
import { LoginPage } from "@/pages/Login";
import "./index.css";

// Route-level code splitting: each page (and the chart / animation libraries it pulls in) loads on demand.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const PortalPage = page(() => import("@/pages/Portal"), "PortalPage");
const DashboardPage = page(() => import("@/pages/Dashboard"), "DashboardPage");
const ReservationsPage = page(() => import("@/pages/Reservations"), "ReservationsPage");
const ReservationDetailPage = page(() => import("@/pages/ReservationDetail"), "ReservationDetailPage");
const GuestsPage = page(() => import("@/pages/Guests"), "GuestsPage");
const GuestDetailPage = page(() => import("@/pages/GuestDetail"), "GuestDetailPage");
const LoyaltyPage = page(() => import("@/pages/Loyalty"), "LoyaltyPage");
const LoyaltyDetailPage = page(() => import("@/pages/LoyaltyDetail"), "LoyaltyDetailPage");
const RefundsPage = page(() => import("@/pages/Refunds"), "RefundsPage");
const AdminPage = page(() => import("@/pages/Admin"), "AdminPage");

function shouldToast(error: unknown, meta?: Record<string, unknown>) {
  if (meta?.silent) return false;
  if (error instanceof ApiError && error.status === 401) return false; // handled by the auth provider
  return true;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => shouldToast(error, query.meta) && toast.fromError(error),
  }),
  mutationCache: new MutationCache({
    onError: (error, _v, _c, mutation) => shouldToast(error, mutation.meta) && toast.fromError(error),
  }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider delayDuration={200}>
          <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/portal"
              element={
                <Suspense fallback={<LoadingBlock />}>
                  <PortalPage />
                </Suspense>
              }
            />
            <Route element={<Layout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/reservations" element={<ReservationsPage />} />
              <Route path="/reservations/:id" element={<ReservationDetailPage />} />
              <Route path="/guests" element={<GuestsPage />} />
              <Route path="/guests/:id" element={<GuestDetailPage />} />
              <Route path="/loyalty" element={<LoyaltyPage />} />
              <Route path="/loyalty/:id" element={<LoyaltyDetailPage />} />
              <Route path="/refunds" element={<RefundsPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
