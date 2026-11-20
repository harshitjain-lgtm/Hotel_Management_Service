import { KeyRound, Lock, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, Field, Input } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/utils";

function RevokedBanner() {
  const { banner, dismissBanner } = useAuth();
  if (!banner) return null;
  const suspended = banner.code === "account_suspended";
  return (
    <div className="animate-pulse-ring mb-6 overflow-hidden rounded-xl border-2 border-red-600 bg-red-600 text-white shadow-2xl">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-100">Security action · StaySec</p>
          <p className="mt-1 text-lg font-bold leading-snug">
            {suspended
              ? "Your account was suspended by security monitoring (StaySec)"
              : "Your session was terminated by security monitoring (StaySec)"}
          </p>
          <p className="mt-2 rounded-md bg-red-700/60 px-3 py-2 text-sm">
            <span className="font-semibold">Reason:</span> {banner.reason}
          </p>
          <p className="mt-2 text-xs text-red-100">
            {banner.by ? `Action by ${banner.by} · ` : ""}
            {fmtDateTime(banner.at)} · Contact the security team before signing in again.
          </p>
        </div>
        <button onClick={dismissBanner} className="text-red-100 hover:text-white" title="Dismiss">
          <X className="h-5 w-5" />
        </button>
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
    <div className="flex min-h-full">
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-bold">S</div>
          <div>
            <p className="text-lg font-semibold">StayDesk</p>
            <p className="text-sm text-indigo-200">Aranya Hotels · Property operations</p>
          </div>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">Reservations, guests and folios — with security built in.</h2>
          <ul className="mt-6 space-y-3 text-sm text-indigo-100">
            <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Property-scoped access &amp; step-up MFA for bulk exports</li>
            <li className="flex items-center gap-2"><Lock className="h-4 w-4" /> Guest identity data masked by default</li>
            <li className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Every action monitored by StaySec</li>
          </ul>
        </div>
        <p className="text-xs text-indigo-300">Synthetic demo data · AI Forge 2026</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <RevokedBanner />
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">{challenge ? "Verify it's you" : "Staff sign in"}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {challenge
                ? "This device isn't recognised. Enter the 6-digit code from your authenticator app."
                : "Use your StayDesk staff ID or email."}
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              {!challenge ? (
                <>
                  <Field label="Staff ID or email">
                    <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. fd_goa_01" />
                  </Field>
                  <Field label="Password">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label="Authenticator code">
                  <Input
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
                    placeholder="••••••"
                  />
                </Field>
              )}
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={busy}
                disabled={challenge ? code.length !== 6 : !username || !password}
              >
                {challenge ? "Verify" : "Sign in"}
              </Button>
              {challenge && (
                <button
                  type="button"
                  className="w-full text-center text-xs text-slate-500 hover:text-slate-800"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                  }}
                >
                  ← Back
                </button>
              )}
            </form>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            Guest? <Link to="/portal" className="font-medium text-indigo-600 hover:underline">Aranya Rewards portal →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
