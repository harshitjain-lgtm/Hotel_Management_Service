import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomeRedirect, Layout } from "@/components/Layout";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { toast, Toaster } from "@/lib/toast";
import { AdminPage } from "@/pages/Admin";
import { GuestDetailPage } from "@/pages/GuestDetail";
import { GuestsPage } from "@/pages/Guests";
import { LoginPage } from "@/pages/Login";
import { LoyaltyDetailPage } from "@/pages/LoyaltyDetail";
import { LoyaltyPage } from "@/pages/Loyalty";
import { PortalPage } from "@/pages/Portal";
import { RefundsPage } from "@/pages/Refunds";
import { ReservationDetailPage } from "@/pages/ReservationDetail";
import { ReservationsPage } from "@/pages/Reservations";
import "./index.css";

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
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/portal" element={<PortalPage />} />
            <Route element={<Layout />}>
              <Route index element={<HomeRedirect />} />
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
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
