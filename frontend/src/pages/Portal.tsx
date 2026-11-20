import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Gift, LogOut, Mail, ShieldAlert, Snowflake } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TierBadge } from "@/components/badges";
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, LoadingBlock, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { api, ApiError, describeError } from "@/lib/api";
import type { LoyaltyAccountDetail } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";

const TOKEN_KEY = "staydesk.portal_token";

const DENIAL_COPY: Record<string, string> = {
  cooling_off: "For your security, redemptions and transfers are paused for 24 hours after your contact details change.",
  account_frozen: "Your account has been frozen by our security team. Please contact Aranya Rewards support.",
  insufficient_points: "You don't have enough points for this.",
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
    <div className="mx-auto mt-16 w-full max-w-sm">
      <Card>
        <CardContent className="p-8">
          <h1 className="text-xl font-semibold text-slate-900">Member sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Access your Aranya Rewards points and benefits.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email">
              <Input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" size="lg" className="w-full bg-amber-600 hover:bg-amber-700" loading={busy} disabled={!email || !password}>
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
  icon: Icon,
  children,
  onSubmit,
  busy,
  disabled,
  cta,
  error,
}: {
  title: string;
  icon: typeof Gift;
  children: ReactNode;
  onSubmit: () => void;
  busy: boolean;
  disabled: boolean;
  cta: string;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-amber-600" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <Button className="w-full bg-amber-600 hover:bg-amber-700" onClick={onSubmit} loading={busy} disabled={disabled}>
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

  if (me.isLoading) return <LoadingBlock />;
  if (!me.data)
    return (
      <div className="py-16 text-center text-sm text-slate-500">
        Session expired.{" "}
        <button className="text-amber-700 hover:underline" onClick={onLogout}>
          Sign in again
        </button>
      </div>
    );
  const a = me.data;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-orange-700 p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-amber-100">Welcome back</p>
            <h1 className="text-2xl font-semibold">{a.guest_name}</h1>
            <p className="mt-1 font-mono text-sm text-amber-100">{a.id}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-amber-100">Points balance</p>
            <p className="text-4xl font-bold tabular-nums">{a.points.toLocaleString("en-IN")}</p>
            <div className="mt-1 inline-block rounded bg-white/90 px-1">
              <TierBadge tier={a.tier} />
            </div>
          </div>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-sm text-amber-50">
          <Mail className="h-4 w-4" /> {a.portal_email}
          {a.contact_changed_at && <span className="text-amber-200">· changed {fmtDateTime(a.contact_changed_at)}</span>}
        </p>
      </div>

      {a.frozen && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Snowflake className="mt-0.5 h-4 w-4" />
          <span>
            <strong>Account frozen by security.</strong> {a.frozen_reason ?? ""} Redemptions and transfers are disabled.
          </span>
        </div>
      )}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ActionCard
          title="Redeem points"
          icon={Gift}
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <tr>
              <TH>When</TH>
              <TH>Activity</TH>
              <TH>Description</TH>
              <TH className="text-right">Points</TH>
            </tr>
          </THead>
          <TBody>
            {a.transactions.map((t) => (
              <TR key={t.id}>
                <TD className="text-xs text-slate-500">{fmtDateTime(t.created_at)}</TD>
                <TD className="capitalize">{t.kind.replace("_", " ")}</TD>
                <TD>{t.description}</TD>
                <TD className={`text-right font-medium tabular-nums ${t.points < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {t.points > 0 ? "+" : ""}
                  {t.points.toLocaleString("en-IN")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
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
    <div className="min-h-full bg-gradient-to-b from-amber-50 to-slate-50">
      <header className="border-b border-amber-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Aranya Rewards</p>
              <p className="text-[11px] text-slate-500">Member portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-xs text-slate-500 hover:text-slate-800">
              Staff login
            </Link>
            {token && (
              <Button variant="ghost" size="sm" onClick={() => setToken(null)}>
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="px-5 py-8">
        {token ? <PortalDashboard token={token} onLogout={() => setToken(null)} /> : <PortalLogin onToken={setToken} />}
      </main>
    </div>
  );
}
