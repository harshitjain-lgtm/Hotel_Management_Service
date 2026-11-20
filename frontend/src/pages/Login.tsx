import { ArrowRight, Check, KeyRound, Lock, ShieldAlert, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Field } from "@/components/kit";
import Aurora from "@/components/reactbits/Aurora";
import BlurText from "@/components/reactbits/BlurText";
import GradientText from "@/components/reactbits/GradientText";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/utils";

function RevokedBanner() {
  const { banner, dismissBanner } = useAuth();
  if (!banner) return null;
  const suspended = banner.code === "account_suspended";
  return (
    <div className="animate-pulse-ring mb-6 overflow-hidden rounded-2xl border-2 border-danger bg-danger text-white shadow-lift" role="alert">
      <div className="flex items-start gap-4 p-5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/15">
          <ShieldAlert className="size-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.18em] text-red-100 uppercase">Security action · StaySec</p>
          <p className="mt-1 text-lg leading-snug font-bold">
            {suspended ? "Your account was suspended by security monitoring (StaySec)" : "Your session was terminated by security monitoring (StaySec)"}
          </p>
          <p className="mt-2 rounded-lg bg-black/15 px-3 py-2 text-sm">
            <span className="font-semibold">Reason:</span> {banner.reason}
          </p>
          <p className="mt-2 text-xs text-red-100">
            {banner.by ? `Action by ${banner.by} · ` : ""}
            {fmtDateTime(banner.at)} · Contact the security team before signing in again.
          </p>
        </div>
        <button onClick={dismissBanner} className="cursor-pointer text-red-100 hover:text-white" title="Dismiss" aria-label="Dismiss">
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}

const FEATURES = [
  "Property-scoped access and step-up MFA for bulk exports",
  "Guest identity data masked by default, revealed with a reason",
  "Two-person refunds and loyalty cooling-off",
  "Every read and change monitored by StaySec",
];

function HeroPanel() {
  return (
    <div className="relative m-4 hidden w-[46%] flex-col justify-between overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#1565c0,#1e88e5_45%,#5c63c7)] p-10 text-white lg:flex">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <Aurora colorStops={["#7cc4ff", "#b794f6", "#5ec8ff"]} amplitude={0.9} blend={0.6} speed={0.6} mouseInteraction={false} />
      </div>
      <div className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute right-24 bottom-32 size-24 rounded-full bg-white/10" />

      <div className="relative flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-white/20 text-lg font-bold backdrop-blur">S</div>
        <div>
          <p className="text-lg font-semibold">StayDesk</p>
          <p className="text-sm text-white/75">Aranya Hotels · Property operations</p>
        </div>
      </div>

      <div className="relative">
        <div role="heading" aria-level={2}>
          <BlurText
            text="Reservations, guests and folios — with security built in."
            animateBy="words"
            direction="top"
            delay={90}
            className="max-w-md text-[34px] leading-tight font-semibold"
          />
        </div>
        <ul className="mt-8 space-y-3.5 text-sm text-white/90">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative flex items-center justify-between text-xs text-white/70">
        <span>Synthetic demo data · AI Forge 2026</span>
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" /> Mumbai · Goa · Jaipur
        </span>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { token, login, verifyMfa } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (token) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        await verifyMfa(challenge, code);
      } else {
        const res = await login(username, password);
        if (res.challenge) setChallenge(res.challenge);
      }
    } catch (err) {
      setError(describeError(err).description ?? "Login failed");
      if (challenge) setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full bg-canvas">
      <HeroPanel />

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <GradientText colors={["#e0607e", "#8b5cf6", "#1e88e5", "#8b5cf6"]} className="text-3xl font-semibold">
              StayDesk
            </GradientText>
          </div>
          <RevokedBanner />
          <Card className="shadow-lift">
            <CardContent className="p-8">
              <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                {challenge ? <KeyRound className="size-6" /> : <UserRound className="size-6" />}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{challenge ? "Verify it's you" : "Staff sign in"}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {challenge ? "This device isn't recognised. Enter the 6-digit code from your authenticator app." : "Welcome back. Use your StayDesk staff ID or email."}
              </p>
              <form onSubmit={submit} className="mt-7 space-y-4">
                {!challenge ? (
                  <>
                    <Field label="Staff ID or email">
                      <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. fd_goa_01" className="h-11" />
                    </Field>
                    <Field label="Password">
                      <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
                    </Field>
                  </>
                ) : (
                  <Field label="Authenticator code">
                    <Input
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
                      placeholder="••••••"
                    />
                  </Field>
                )}
                {error && (
                  <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-[#a33131]" role="alert">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={challenge ? code.length !== 6 : !username || !password}>
                  {challenge ? "Verify" : "Sign in"} {!busy && <ArrowRight />}
                </Button>
                {challenge && (
                  <button
                    type="button"
                    className="w-full cursor-pointer text-center text-xs text-muted-foreground hover:text-ink"
                    onClick={() => {
                      setChallenge(null);
                      setCode("");
                    }}
                  >
                    ← Back
                  </button>
                )}
              </form>
            </CardContent>
          </Card>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Guest?{" "}
            <Link to="/portal" className="font-medium text-primary hover:underline">
              Aranya Rewards portal →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
