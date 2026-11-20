import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BedDouble,
  CreditCard,
  Fingerprint,
  Gift,
  KeyRound,
  Pencil,
  Share2,
  ShieldCheck,
  ShieldOff,
  UserCog,
} from "lucide-react";
import { useEffect, useState } from "react";
import { RISK_LABELS } from "@/components/badges";
import { useProperties } from "@/components/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { PartnerRow, Policy, StaffRow } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const RISK_ICON: Record<string, typeof ShieldCheck> = {
  unauthorized_booking_access: BedDouble,
  account_compromise: KeyRound,
  guest_identity_exposure: Fingerprint,
  payment_workflow_compromise: CreditCard,
  loyalty_account_misuse: Gift,
  excessive_third_party_sharing: Share2,
};

const PARAM_LABELS: Record<string, string> = {
  threshold: "Row threshold",
  window_minutes: "Step-up valid (minutes)",
  hours: "Cooling-off (hours)",
};

// ------------------------------ Policy Center ------------------------------

function PolicyCard({ policy }: { policy: Policy }) {
  const qc = useQueryClient();
  const [params, setParams] = useState<Record<string, string>>({});
  useEffect(() => {
    setParams(Object.fromEntries(Object.entries(policy.params).map(([k, v]) => [k, String(v)])));
  }, [policy.params]);

  const mutation = useMutation({
    mutationFn: (body: { enabled?: boolean; params?: Record<string, number> }) =>
      api<Policy>(`/admin/policies/${policy.key}`, { method: "PUT", body }),
    onSuccess: (p, vars) => {
      if (vars.enabled === false) toast.warning(`${p.title} disabled`, "This change is logged and monitored by StaySec.");
      else if (vars.enabled === true) toast.success(`${p.title} enforced`);
      else toast.success("Parameters saved");
      qc.invalidateQueries({ queryKey: ["policies"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const Icon = (policy.risk && RISK_ICON[policy.risk]) || ShieldCheck;
  const paramsDirty = Object.entries(policy.params).some(([k, v]) => String(v) !== params[k]);
  const on = policy.enabled;

  return (
    <Card className={cn("flex flex-col overflow-hidden transition-colors", on ? "border-slate-200" : "border-amber-300 ring-1 ring-amber-200")}>
      <div className="flex items-start gap-4 p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", on ? "bg-indigo-50 text-indigo-600" : "bg-amber-100 text-amber-700")}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-slate-900">{policy.title}</h3>
            {on ? (
              <Badge color="green">
                <ShieldCheck className="h-3 w-3" /> Enforced
              </Badge>
            ) : (
              <Badge color="amber">
                <ShieldOff className="h-3 w-3" /> Disabled
              </Badge>
            )}
          </div>
          {policy.risk && <p className="mt-0.5 text-xs font-medium text-slate-500">Mitigates: {RISK_LABELS[policy.risk] ?? policy.risk}</p>}
          <p className="mt-2 text-sm text-slate-600">{policy.description}</p>
        </div>
        <Switch size="lg" tone="green" checked={on} disabled={mutation.isPending} onChange={(v) => mutation.mutate({ enabled: v })} />
      </div>

      {!on && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>Gap:</strong> {policy.gap_when_off}
          </span>
        </div>
      )}

      {Object.keys(policy.params).length > 0 && (
        <div className="mx-5 mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
          {Object.keys(policy.params).map((k) => (
            <Field key={k} label={PARAM_LABELS[k] ?? k} className="w-40">
              <Input type="number" min={1} value={params[k] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} />
            </Field>
          ))}
          <Button
            size="sm"
            variant="secondary"
            className="h-9"
            disabled={!paramsDirty || mutation.isPending}
            onClick={() => mutation.mutate({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Number(v)])) })}
          >
            Save
          </Button>
        </div>
      )}

      <div className="mt-auto border-t border-slate-100 bg-slate-50/60 px-5 py-2 text-[11px] text-slate-500">
        <span className="font-mono">{policy.key}</span> · updated by {policy.updated_by ?? "—"} · {fmtDateTime(policy.updated_at)}
      </div>
    </Card>
  );
}

function PolicyCenter() {
  const query = useQuery({
    queryKey: ["policies"],
    queryFn: () => api<{ items: Policy[] }>("/admin/policies"),
    refetchInterval: 5000,
  });
  if (query.isLoading || !query.data) return <LoadingBlock />;
  const items = query.data.items;
  const enforced = items.filter((p) => p.enabled).length;
  const pct = Math.round((enforced / Math.max(items.length, 1)) * 100);
  const off = items.filter((p) => !p.enabled);
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Security posture</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {enforced}
              <span className="text-lg text-slate-400">/{items.length}</span>
              <span className="ml-2 text-sm font-medium text-slate-500">controls enforced</span>
            </p>
          </div>
          <div className="min-w-[240px] flex-1">
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : pct >= 75 ? "bg-amber-400" : "bg-red-500")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {off.length === 0 ? (
                "All security controls are enforced."
              ) : (
                <>
                  <span className="font-medium text-amber-700">Disabled:</span> {off.map((p) => p.title).join(", ")}
                </>
              )}
            </p>
          </div>
          <p className="max-w-xs text-xs text-slate-500">
            Every change here emits a security event. StaySec flags disabled controls and can re-enable them after an incident.
          </p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((p) => (
          <PolicyCard key={p.key} policy={p} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------ Staff ------------------------------

function StaffEditor({ staff, roles, onClose }: { staff: StaffRow; roles: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const [role, setRole] = useState(staff.role);
  const [status, setStatus] = useState(staff.status);
  const [mfa, setMfa] = useState(staff.mfa_enabled);
  const [scope, setScope] = useState<string[]>(staff.property_scope);
  const mutation = useMutation({
    mutationFn: () =>
      api(`/admin/staff/${staff.id}`, { method: "PUT", body: { role, status, mfa_enabled: mfa, property_scope: scope } }),
    onSuccess: () => {
      toast.success("Staff updated", "Changes are logged as admin.staff_updated events.");
      qc.invalidateQueries({ queryKey: ["admin-staff"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${staff.name}`}
      description={<span className="font-mono">{staff.id}</span>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={scope.length === 0}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
          </Select>
        </Field>
      </div>
      <Field label="Property scope">
        <div className="flex flex-wrap gap-3">
          {properties?.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={scope.includes(p.id)}
                onChange={(e) => setScope((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
              />
              {p.id} · {p.city}
            </label>
          ))}
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-slate-800">MFA enabled</p>
          <p className="text-xs text-slate-500">Required for new-device logins and step-up</p>
        </div>
        <Switch checked={mfa} onChange={setMfa} />
      </div>
    </Modal>
  );
}

function StaffTab() {
  const query = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => api<{ items: StaffRow[]; roles: Record<string, string[]> }>("/admin/staff"),
  });
  const [editing, setEditing] = useState<StaffRow | null>(null);
  if (query.isLoading || !query.data) return <LoadingBlock />;
  return (
    <Card>
      <Table>
        <THead>
          <tr>
            <TH>Staff ID</TH>
            <TH>Name</TH>
            <TH>Role</TH>
            <TH>Home</TH>
            <TH>Scope</TH>
            <TH>Shift (IST)</TH>
            <TH>MFA</TH>
            <TH>Status</TH>
            <TH />
          </tr>
        </THead>
        <TBody>
          {query.data.items.map((s) => (
            <TR key={s.id}>
              <TD className="font-mono text-[13px]">{s.id}</TD>
              <TD>
                <div className="font-medium text-slate-900">{s.name}</div>
                <div className="text-xs text-slate-500">{s.email}</div>
              </TD>
              <TD>{s.role_label}</TD>
              <TD>{s.home_property}</TD>
              <TD>
                <div className="flex gap-1">
                  {s.property_scope.map((p) => (
                    <Badge key={p}>{p}</Badge>
                  ))}
                </div>
              </TD>
              <TD className="font-mono text-xs">{s.shift}</TD>
              <TD>{s.mfa_enabled ? <Badge color="green">On</Badge> : <Badge color="red">Off</Badge>}</TD>
              <TD>{s.status === "active" ? <Badge color="green">Active</Badge> : <Badge color="red">Suspended</Badge>}</TD>
              <TD className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {editing && <StaffEditor staff={editing} roles={Object.keys(query.data.roles)} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// ------------------------------ Partners ------------------------------

const PII_FIELDS = new Set(["guest_name", "guest_email", "guest_phone", "nationality", "dob", "passport_no", "address_city"]);

function PartnerCard({ partner, available }: { partner: PartnerRow; available: string[] }) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<string[]>(partner.allowed_fields);
  useEffect(() => setFields(partner.allowed_fields), [partner.allowed_fields]);
  const dirty = [...fields].sort().join() !== [...partner.allowed_fields].sort().join();
  const mutation = useMutation({
    mutationFn: () => api(`/admin/partners/${partner.id}`, { method: "PUT", body: { allowed_fields: fields } }),
    onSuccess: () => {
      toast.success(`${partner.name} data contract updated`);
      qc.invalidateQueries({ queryKey: ["admin-partners"] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{partner.name}</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="font-mono">{partner.id}</span> · key <span className="font-mono">{partner.key_prefix}…</span> ·{" "}
            {partner.key_rotated_at ? `rotated ${fmtDateTime(partner.key_rotated_at)}` : "never rotated"}
          </p>
        </div>
        <Badge color={partner.key_status === "active" ? "green" : "red"}>{partner.key_status}</Badge>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Fields shared with this partner (data contract)</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
          {available.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={fields.includes(f)}
                onChange={(e) => setFields((s) => (e.target.checked ? [...s, f] : s.filter((x) => x !== f)))}
              />
              <span className="font-mono text-xs">{f}</span>
              {PII_FIELDS.has(f) && <Badge color={f === "passport_no" || f === "dob" ? "red" : "amber"}>PII</Badge>}
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!dirty}>
            Save data contract
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PartnersTab() {
  const query = useQuery({
    queryKey: ["admin-partners"],
    queryFn: () => api<{ items: PartnerRow[]; available_fields: string[] }>("/admin/partners"),
  });
  if (query.isLoading || !query.data) return <LoadingBlock />;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {query.data.items.map((p) => (
        <PartnerCard key={p.id} partner={p} available={query.data.available_fields} />
      ))}
    </div>
  );
}

// ------------------------------ page ------------------------------

const TABS = [
  { key: "policies", label: "Policy Center", icon: ShieldCheck },
  { key: "staff", label: "Staff & access", icon: UserCog },
  { key: "partners", label: "OTA partners", icon: Share2 },
] as const;

export function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("policies");
  return (
    <div>
      <PageHeader title="Security administration" subtitle="Controls enforced by the StayDesk backend for every user, screen and API call" />
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {tab === "policies" && <PolicyCenter />}
      {tab === "staff" && <StaffTab />}
      {tab === "partners" && <PartnersTab />}
    </div>
  );
}
