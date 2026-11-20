import { BedDouble, CircleDot, Clock3, CreditCard, Gift, LogOut, Settings2, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { Navigate, NavLink, Outlet } from "react-router-dom";
import { API_URL, getDemoClock, getDeviceId, resetDeviceId, setDemoClock } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { StepUpProvider } from "@/lib/stepup";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, LoadingBlock } from "./ui";

export const NAV = [
  { to: "/reservations", label: "Reservations", icon: BedDouble, perm: "reservations.read" },
  { to: "/guests", label: "Guests", icon: Users, perm: "guests.read" },
  { to: "/loyalty", label: "Loyalty", icon: Gift, perm: "loyalty.read" },
  { to: "/refunds", label: "Refund approvals", icon: CreditCard, perm: "refund.approve" },
  { to: "/admin", label: "Policy Center", icon: ShieldCheck, perm: "admin.manage" },
];

function DemoSettings() {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(getDemoClock());
  const [device, setDevice] = useState(getDeviceId());
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" title="Demo settings" onClick={() => setOpen((o) => !o)}>
        <Settings2 className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Demo settings</p>
            <p className="mt-0.5 text-xs text-slate-500">Only honoured by the backend when DEMO_MODE=true.</p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Demo clock (staff local time, HH:MM)</label>
                <div className="flex gap-2">
                  <Input type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    onClick={() => {
                      setDemoClock(clock);
                      toast.info(clock ? `Demo clock set to ${clock}` : "Demo clock cleared");
                    }}
                  >
                    Apply
                  </Button>
                </div>
                {clock && (
                  <button
                    className="mt-1 text-xs text-indigo-600 hover:underline"
                    onClick={() => {
                      setClock("");
                      setDemoClock("");
                      toast.info("Demo clock cleared");
                    }}
                  >
                    Clear (use real time)
                  </button>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">This browser's device ID</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700">{device}</code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDevice(resetDeviceId());
                      toast.warning("New device ID generated", "The next login will look like a new, unrecognised device.");
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">API: {API_URL}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Layout() {
  const { token, me, meLoading, logout, can } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (meLoading || !me) return <LoadingBlock label="Loading your workspace…" />;
  const staff = me.staff;
  const disabledControls = Object.entries(me.policies).filter(([, on]) => !on).length;

  return (
    <StepUpProvider>
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</div>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-slate-900">StayDesk</p>
                <p className="text-[11px] text-slate-500">Aranya Hotels</p>
              </div>
            </div>
            <nav className="flex items-center gap-1">
              {NAV.filter((n) => can(n.perm)).map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {disabledControls > 0 && can("admin.manage") && (
                <NavLink to="/admin">
                  <Badge color="amber">{disabledControls} control{disabledControls > 1 ? "s" : ""} off</Badge>
                </NavLink>
              )}
              <div className="hidden items-center gap-2 text-right md:flex">
                <div className="leading-tight">
                  <p className="text-sm font-medium text-slate-900">{staff.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {staff.role_label} · <span className="font-mono">{staff.id}</span>
                  </p>
                </div>
              </div>
              <div className="hidden flex-col items-end gap-0.5 lg:flex">
                <div className="flex gap-1">
                  {staff.property_scope.map((p) => (
                    <Badge key={p} color={p === staff.home_property ? "indigo" : "slate"}>
                      {p}
                    </Badge>
                  ))}
                </div>
                <span
                  className={cn("flex items-center gap-1 text-[11px]", staff.on_shift ? "text-emerald-600" : "text-amber-600")}
                  title={`Shift ${staff.shift} IST`}
                >
                  {staff.on_shift ? <CircleDot className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                  {staff.on_shift ? "On shift" : "Off shift"} · {staff.shift}
                </span>
              </div>
              <DemoSettings />
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-6">
          <Outlet />
        </main>
      </div>
    </StepUpProvider>
  );
}

export function HomeRedirect() {
  const { can, me } = useAuth();
  if (!me) return <LoadingBlock />;
  const first = NAV.find((n) => can(n.perm));
  return <Navigate to={first?.to ?? "/reservations"} replace />;
}
