import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Field, Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiHooks, describeError, type ApiDetail } from "./api";

interface Pending {
  detail: ApiDetail;
  resolve: (ok: boolean) => void;
}

/** Handles 403 step_up_required: asks for a fresh TOTP code, then the original request is retried. */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiHooks.onStepUp = (detail) =>
      new Promise<boolean>((resolve) => {
        setCode("");
        setError(null);
        setPending({ detail, resolve });
      });
    return () => {
      apiHooks.onStepUp = undefined;
    };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/step-up", { method: "POST", body: { code } });
      close(true);
    } catch (err) {
      setError(describeError(err).description || "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const rows = pending?.detail.rows as number | undefined;
  const threshold = pending?.detail.threshold as number | undefined;

  return (
    <>
      {children}
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Step-up verification required
          </span>
        }
        description={
          rows && threshold
            ? `This export contains ${rows.toLocaleString("en-IN")} rows, above the ${threshold.toLocaleString("en-IN")}-row limit. Confirm it's you with your authenticator code.`
            : pending?.detail.reason
        }
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={code.trim().length < 6}>
              Verify &amp; continue
            </Button>
          </>
        }
      >
        <Field label="Authenticator code" hint="6-digit TOTP from your authenticator app">
          <Input
            autoFocus
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submit()}
            className="h-12 text-center font-mono text-lg tracking-[0.4em]"
            placeholder="••••••"
          />
        </Field>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-[#a33131]">{error}</p>}
      </Modal>
    </>
  );
}
