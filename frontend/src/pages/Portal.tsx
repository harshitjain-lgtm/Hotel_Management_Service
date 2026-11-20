import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CircleCheck, Gift, LogOut, Mail, ShieldAlert, Snowflake, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatedNumber, AreaTrend } from "@/components/charts";
import { Field, IconChip, LoadingBlock, Reveal } from "@/components/kit";
import GradientText from "@/components/reactbits/GradientText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError, describeError } from "@/lib/api";
import { balanceSeries, earnedRedeemed } from "@/lib/loyalty";
import type { LoyaltyAccountDetail } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const TOKEN_KEY = "staydesk.portal_token";

const DENIAL_COPY: Record<string, string> = {
  cooling_off: "For your security, redemptions and transfers are paused for 24 hours after your contact details change.",
  account_frozen: "Your account has been frozen by our security team. Please contact Aranya Rewards support.",
  insufficient_points: "You don't have enough points for this.",
};

const TIER_CARD: Record<string, string> = {
  Platinum: "bg-[linear-gradient(135deg,#5c63c7,#8b5cf6_60%,#b794f6)]",
  Gold: "bg-[linear-gradient(135deg,#d98f06,#efa00b_55%,#f6c453)]",
  Silver: "bg-[linear-gradient(135deg,#64748b,#8a96a8_60%,#b8c2d0)]",
};

function denialText(err: unknown) {
  if (err instanceof ApiError) {
    const code = err.detail?.code || err.detail?.error;
    if (code && DENIAL_COPY[code]) return DENIAL_COPY[code];
  }
  return describeError(err).description ?? "Request failed";
}

function PortalLogin({ onToken }: { onToken: (t: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string }>("/portal/login", { method: "POST", body: { email, password }, auth: "none" });
      onToken(res.access_token);
    } catch (err) {
      setError(denialText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-10 w-full max-w-[420px] sm:mt-16">
      <Card className="shadow-lift">
        <CardContent className="p-8">
          <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-gold-soft text-gold">
            <Gift className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Member sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Access your Aranya Rewards points and benefits.</p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label="Email">
              <Input autoFocus type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
            </Field>
            {error && (
              <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-[#a33131]" role="alert">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  title,
  icon,
  tone,
  children,
  onSubmit,
  busy,
  disabled,
  cta,
  error,
}: {
  title: string;
  icon: LucideIcon;
  tone: "blue" | "amber" | "violet";
  children: ReactNode;
  onSubmit: () => void;
  busy: boolean;
  disabled: boolean;
  cta: string;
  error: string | null;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-3">
          <IconChip icon={icon} tone={tone} size="sm" />
          <CardTitle>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {children}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-[#f8cfcf] bg-danger-soft px-3 py-2 text-sm text-[#a33131]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}
        <Button className="mt-auto w-full" onClick={onSubmit} loading={busy} disabled={disabled}>
          {cta}
        </Button>
      </CardContent>
    </Card>
  );
}

function PortalDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["portal-me", token],
    queryFn: () => api<LoyaltyAccountDetail>("/portal/me", { auth: "guest", guestToken: token }),
    meta: { silent: true },
  });
  const [newEmail, setNewEmail] = useState("");
  const [redeemPts, setRedeemPts] = useState("");
  const [reward, setReward] = useState("Free night voucher");
  const [toAccount, setToAccount] = useState("");
  const [transferPts, setTransferPts] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const useAction = (key: string, fn: () => Promise<unknown>, done: string) =>
    useMutation({
      mutationFn: fn,
      meta: { silent: true },
      onMutate: () => {
        setErrors((e) => ({ ...e, [key]: null }));
        setNotice(null);
      },
      onSuccess: () => {
        setNotice(done);
        qc.invalidateQueries({ queryKey: ["portal-me", token] });
      },
      onError: (err) => setErrors((e) => ({ ...e, [key]: denialText(err) })),
    });

  const changeEmail = useAction(
    "email",
    () => api("/portal/change-email", { method: "POST", body: { new_email: newEmail }, auth: "guest", guestToken: token }),
    "Email updated.",
  );
  const redeem = useAction(
    "redeem",
    () => api("/portal/redeem", { method: "POST", body: { points: Number(redeemPts), description: reward }, auth: "guest", guestToken: token }),
    "Points redeemed — enjoy your reward!",
  );
  const transfer = useAction(
    "transfer",
    () =>
      api("/portal/transfer", {
        method: "POST",
        body: { to_account_id: toAccount.trim(), points: Number(transferPts) },
        auth: "guest",
        guestToken: token,
      }),
    "Points transferred.",
  );

  if (me.isLoading) return <LoadingBlock label="Loading your account…" />;
  if (!me.data)
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Session expired.{" "}
        <button className="cursor-pointer font-medium text-primary hover:underline" onClick={onLogout}>
          Sign in again
        </button>
      </div>
    );
  const a = me.data;
  const series = balanceSeries(a.points, a.transactions);
  const { earned, spent } = earnedRedeemed(a.transactions);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className={cn("relative overflow-hidden rounded-3xl p-7 text-white shadow-lift lg:col-span-2", TIER_CARD[a.tier] ?? TIER_CARD.Silver)}>
          <div className="absolute -top-12 -right-12 size-44 rounded-full bg-white/15" />
          <div className="absolute -bottom-20 -left-10 size-52 rounded-full bg-white/10" />
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-sm text-white/80">Welcome back</p>
              <h1 className="text-2xl font-semibold">{a.guest_name}</h1>
            </div>
            <Badge className="bg-white/20 text-white ring-white/30">{a.tier}</Badge>
          </div>
          <p className="relative mt-10 text-sm text-white/80">Points balance</p>
          <p className="relative text-5xl font-semibold">
            <AnimatedNumber value={a.points} />
          </p>
          <div className="relative mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-white/85">
            <span className="flex items-center gap-1.5">
              <Mail className="size-4" /> {a.portal_email}
            </span>
            <span className="font-mono text-xs">{a.id}</span>
          </div>
          {a.contact_changed_at && <p className="relative mt-1 text-xs text-white/70">Contact changed {fmtDateTime(a.contact_changed_at)}</p>}
        </div>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Your points over time</CardTitle>
              <CardDescription>Balance after each recent activity</CardDescription>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-ink-2">
                Earned <span className="font-semibold text-success">+{earned.toLocaleString("en-IN")}</span>
              </span>
              <span className="text-ink-2">
                Used <span className="font-semibold text-orange">−{spent.toLocaleString("en-IN")}</span>
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {a.transactions.length < 2 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Your points history will appear here after your next activity.</p>
            ) : (
              <AreaTrend data={series} name="Points balance" series="blue" curve="stepAfter" height={220} />
            )}
          </CardContent>
        </Card>
      </Reveal>

      {a.frozen && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f8cfcf] bg-danger-soft px-4 py-3 text-sm text-[#a33131]">
          <Snowflake className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Account frozen by security.</strong> {a.frozen_reason ?? ""} Redemptions and transfers are disabled.
          </span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-2xl border border-[#c7ecd9] bg-success-soft px-4 py-3 text-sm text-success">
          <CircleCheck className="size-4" /> {notice}
        </div>
      )}

      <Reveal delay={0.06} className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <ActionCard
          title="Redeem points"
          icon={Gift}
          tone="amber"
          onSubmit={() => redeem.mutate()}
          busy={redeem.isPending}
          disabled={!(Number(redeemPts) > 0)}
          cta="Redeem"
          error={errors.redeem ?? null}
        >
          <Field label="Points">
            <Input type="number" min={1} value={redeemPts} onChange={(e) => setRedeemPts(e.target.value)} />
          </Field>
          <Field label="Reward">
            <Input value={reward} onChange={(e) => setReward(e.target.value)} />
          </Field>
        </ActionCard>
        <ActionCard
          title="Transfer points"
          icon={ArrowRightLeft}
          tone="violet"
          onSubmit={() => transfer.mutate()}
          busy={transfer.isPending}
          disabled={!(Number(transferPts) > 0) || !toAccount.trim()}
          cta="Transfer"
          error={errors.transfer ?? null}
        >
          <Field label="To member ID">
            <Input value={toAccount} onChange={(e) => setToAccount(e.target.value)} placeholder="AR…" className="font-mono" />
          </Field>
          <Field label="Points">
            <Input type="number" min={1} value={transferPts} onChange={(e) => setTransferPts(e.target.value)} />
          </Field>
        </ActionCard>
        <ActionCard
          title="Change email"
          icon={Mail}
          tone="blue"
          onSubmit={() => changeEmail.mutate()}
          busy={changeEmail.isPending}
          disabled={!newEmail.includes("@")}
          cta="Update email"
          error={errors.email ?? null}
        >
          <Field label="New email" hint="Redemptions pause for 24h after a contact change.">
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </Field>
        </ActionCard>
      </Reveal>

      <Reveal delay={0.1}>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs text-ink-3">{fmtDateTime(t.created_at)}</TableCell>
                    <TableCell>
                      <Badge tone={t.points < 0 ? "orange" : "green"} className="capitalize">
                        {t.kind.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-ink">{t.description}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", t.points < 0 ? "text-danger" : "text-success")}>
                      {t.points > 0 ? "+" : ""}
                      {t.points.toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}

export function PortalPage() {
  const [token, setTok] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const setToken = (t: string | null) => {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
    setTok(t);
  };
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-20 border-b border-border bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#efa00b,#e0607e)] text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <GradientText colors={["#d98f06", "#e0607e", "#8b5cf6", "#e0607e"]} animationSpeed={10} className="text-base font-semibold">
                Aranya Rewards
              </GradientText>
              <p className="text-[11px] text-ink-3">Member portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-xs text-ink-3 hover:text-ink">
              Staff login
            </Link>
            {token && (
              <Button variant="outline" size="sm" onClick={() => setToken(null)}>
                <LogOut /> Sign out
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="px-5 py-8">{token ? <PortalDashboard token={token} onLogout={() => setToken(null)} /> : <PortalLogin onToken={setToken} />}</main>
    </div>
  );
}
