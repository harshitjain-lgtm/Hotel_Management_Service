import {
  BedDouble,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Clock3,
  CreditCard,
  ExternalLink,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Suspense, useState } from "react";
import { Link, Navigate, NavLink, Outlet } from "react-router-dom";
import GradientText from "@/components/reactbits/GradientText";
import ShinyText from "@/components/reactbits/ShinyText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { API_URL, getDemoClock, getDeviceId, resetDeviceId, setDemoClock } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { StepUpProvider } from "@/lib/stepup";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CONTROL_LABELS } from "./badges";
import { initials, Label, LoadingBlock } from "./kit";
import { useProperties } from "./shared";

export const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "reservations.read" },
  { to: "/reservations", label: "Reservations", icon: BedDouble, perm: "reservations.read" },
  { to: "/guests", label: "Guests", icon: Users, perm: "guests.read" },
  { to: "/loyalty", label: "Loyalty", icon: Gift, perm: "loyalty.read" },
  { to: "/refunds", label: "Refund approvals", icon: CreditCard, perm: "refund.approve" },
  { to: "/admin", label: "Policy Center", icon: ShieldCheck, perm: "admin.manage" },
];

const COLLAPSE_KEY = "staydesk.sidebar_collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#e0607e,#8b5cf6_55%,#1e88e5)] text-lg font-bold text-white shadow-[0_8px_18px_-8px_rgb(139_92_246/0.7)]">
        S
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <GradientText colors={["#e0607e", "#8b5cf6", "#1e88e5", "#8b5cf6"]} animationSpeed={10} className="text-[22px] font-semibold tracking-tight">
            StayDesk
          </GradientText>
          <p className="text-[11px] text-ink-3">Aranya Hotels</p>
        </div>
      )}
    </Link>
  );
}

function NavItems({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="space-y-1.5">
      {NAV.filter((n) => can(n.perm)).map(({ to, label, icon: Icon }) => {
        const link = (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "relative flex h-11 items-center gap-3 rounded-xl text-sm font-medium transition-colors",
                collapsed ? "justify-center px-0" : "px-4",
                isActive
                  ? cn(
                      "bg-sidebar-accent text-primary after:absolute after:top-1.5 after:bottom-1.5 after:w-[3px] after:rounded-l-full after:bg-primary",
                      collapsed ? "after:-right-3" : "after:-right-4",
                    )
                  : "text-sidebar-foreground hover:bg-[#f4f8fd] hover:text-ink",
              )
            }
          >
            <Icon className="size-[19px] shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        );
        return collapsed ? (
          <Tooltip key={to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}

function StaySecCard({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary" title="Protected by StaySec">
          <ShieldCheck className="size-5" />
        </div>
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(140deg,#e8f2fd,#f3f0ff)] p-4">
      <div className="absolute -top-6 -right-6 size-20 rounded-full bg-white/50" />
      <div className="relative flex size-9 items-center justify-center rounded-xl bg-white text-primary shadow-sm">
        <ShieldCheck className="size-5" />
      </div>
      <p className="relative mt-3 text-sm font-semibold">
        <ShinyText text="Protected by StaySec" color="#1d2939" shineColor="#8fc4f5" speed={3.2} />
      </p>
      <p className="relative mt-1 text-xs leading-relaxed text-ink-2">Every read and change is audited and monitored in real time.</p>
    </div>
  );
}

function DemoSettings() {
  const [clock, setClock] = useState(getDemoClock());
  const [device, setDevice] = useState(getDeviceId());
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Demo settings">
              <Settings2 className="size-[18px]" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Demo settings</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 rounded-2xl p-4">
        <p className="text-sm font-semibold text-ink">Demo settings</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Only honoured by the backend when DEMO_MODE=true.</p>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Demo clock (staff local time, HH:MM)</Label>
            <div className="flex gap-2">
              <Input type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
              <Button
                variant="soft"
                className="h-10"
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
                className="mt-1.5 cursor-pointer text-xs text-primary hover:underline"
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
            <Label>This browser's device ID</Label>
            <div className="flex items-center gap-2">
              <code className="h-10 flex-1 truncate rounded-lg bg-muted px-3 font-mono text-xs leading-10 text-ink-2">{device}</code>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  setDevice(resetDeviceId());
                  toast.warning("New device ID generated", "The next login will look like a new, unrecognised device.");
                }}
              >
                Reset
              </Button>
            </div>
          </div>
          <p className="truncate text-[11px] text-ink-3">API: {API_URL}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PropertyScope() {
  const { me } = useAuth();
  const { data: properties } = useProperties();
  if (!me) return null;
  const staff = me.staff;
  const byId = new Map(properties?.map((p) => [p.id, p]));
  const home = byId.get(staff.home_property);
  const multi = staff.property_scope.length > 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-input bg-white py-1.5 pr-3 pl-1.5 text-left shadow-xs transition-colors hover:border-[#c5d4e6]">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#1e88e5,#5c63c7)] text-white">
            <Building2 className="size-4" />
          </div>
          <div className="hidden leading-tight sm:block">
            <p className="max-w-40 truncate text-[13px] font-medium text-ink">{multi ? `${staff.property_scope.length} properties` : (home?.name ?? staff.home_property)}</p>
            <p className="text-[11px] text-ink-3">{multi ? "Regional scope" : (home?.city ?? "Home property")}</p>
          </div>
          <ChevronDown className="size-4 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Properties in your scope</DropdownMenuLabel>
        {staff.property_scope.map((id) => {
          const p = byId.get(id);
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-lg px-2 py-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-xs font-semibold text-primary">{id}</div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm text-ink">{p?.name ?? id}</p>
                <p className="text-[11px] text-ink-3">{p ? `${p.city} · ${p.rooms} rooms` : "—"}</p>
              </div>
              {id === staff.home_property && <Badge tone="blue">Home</Badge>}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ControlsBell() {
  const { me, can } = useAuth();
  if (!me) return null;
  const off = Object.entries(me.policies).filter(([, on]) => !on).map(([k]) => k);
  const admin = can("admin.manage");
  const alert = admin && off.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={alert ? `${off.length} security controls disabled` : "Notifications"}>
          <Bell className="size-[18px]" />
          {alert && <span className="absolute top-2 right-2 size-2 rounded-full bg-gold ring-2 ring-canvas" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Security controls</DropdownMenuLabel>
        {off.length === 0 ? (
          <div className="flex items-center gap-2.5 px-2 py-2.5 text-sm text-ink-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-success-soft text-success">
              <Check className="size-4" />
            </div>
            All controls are enforced.
          </div>
        ) : (
          <>
            {off.map((k) => (
              <div key={k} className="flex items-center gap-2.5 px-2 py-2 text-sm text-ink-2">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
                  <ShieldAlert className="size-4" />
                </div>
                <span className="min-w-0 flex-1 truncate">{CONTROL_LABELS[k] ?? k}</span>
                <Badge tone="amber">Off</Badge>
              </div>
            ))}
            {admin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="cursor-pointer text-primary">
                    Open Policy Center <ExternalLink className="ml-auto size-3.5" />
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  if (!me) return null;
  const s = me.staff;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex cursor-pointer items-center gap-2 rounded-full p-0.5 pr-1.5 transition-colors hover:bg-white" aria-label="Account menu">
          <div className="relative">
            <div className="flex size-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1e88e5,#8b5cf6)] text-sm font-semibold text-white">{initials(s.name)}</div>
            <span className={cn("absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-canvas", s.on_shift ? "bg-success" : "bg-gold")} />
          </div>
          <ChevronDown className="size-4 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl p-1.5">
        <div className="flex items-center gap-3 px-2 py-2.5">
          <div className="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1e88e5,#8b5cf6)] text-sm font-semibold text-white">{initials(s.name)}</div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
            <p className="truncate text-xs text-muted-foreground">{s.role_label}</p>
            <p className="font-mono text-[11px] text-ink-3">{s.id}</p>
          </div>
        </div>
        <div className="mx-2 mb-1.5 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-xs">
          {s.on_shift ? <CircleDot className="size-3.5 text-success" /> : <Clock3 className="size-3.5 text-warning" />}
          <span className={s.on_shift ? "text-success" : "text-warning"}>{s.on_shift ? "On shift" : "Off shift"}</span>
          <span className="ml-auto text-ink-3">{s.shift} IST</span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="cursor-pointer text-danger focus:bg-danger-soft focus:text-danger">
          <LogOut className="size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout() {
  const { token, me, meLoading } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!token) return <Navigate to="/login" replace />;
  if (meLoading || !me) return <LoadingBlock label="Loading your workspace…" />;

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable: keep in memory only */
      }
      return !c;
    });
  };

  return (
    <StepUpProvider>
      <div className="flex min-h-full">
        {/* desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 lg:flex",
            collapsed ? "w-[84px]" : "w-[264px]",
          )}
        >
          <div className={cn("flex h-24 items-center", collapsed ? "justify-center px-3" : "px-7")}>
            <Logo collapsed={collapsed} />
          </div>
          <button
            onClick={toggle}
            className="absolute top-[38px] -right-3.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border border-border bg-white text-ink-3 shadow-sm transition-colors hover:text-primary"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
          </button>
          <div className={cn("scrollbar-thin flex-1 overflow-y-auto py-2", collapsed ? "px-3" : "px-4")}>
            <NavItems collapsed={collapsed} />
          </div>
          <div className={cn("pb-6", collapsed ? "px-3" : "px-5")}>
            <StaySecCard collapsed={collapsed} />
          </div>
        </aside>

        {/* mobile sidebar */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[280px] bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">StayDesk sections</SheetDescription>
            <div className="flex h-full flex-col">
              <div className="flex h-24 items-center px-6">
                <Logo />
              </div>
              <div className="flex-1 overflow-y-auto px-4">
                <NavItems onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="p-5">
                <StaySecCard />
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 bg-canvas/85 backdrop-blur-md">
            <div className="mx-auto flex h-[76px] max-w-[1480px] items-center gap-3 px-4 sm:px-6 lg:px-9">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
              <div className="lg:hidden">
                <Logo collapsed />
              </div>
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
                <PropertyScope />
                <ControlsBell />
                <DemoSettings />
                <UserMenu />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pt-2 pb-10 sm:px-6 lg:px-9">
            <Suspense fallback={<LoadingBlock rows={6} />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
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
