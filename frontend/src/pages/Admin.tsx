import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BedDouble, CreditCard, Fingerprint, Gift, KeyRound, Pencil, Share2, ShieldCheck, ShieldOff, UserCheck, UserCog, UserX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { RISK_LABELS } from "@/components/badges";
import { MeterRow, RadialGauge, RankedBars, StatTile } from "@/components/charts";
import { Field, IconChip, InitialsAvatar, LoadingBlock, Modal, PageHeader, Reveal, SelectField } from "@/components/kit";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { useProperties } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    mutationFn: (body: { enabled?: boolean; params?: Record<string, number> }) => api<Policy>(`/admin/policies/${policy.key}`, { method: "PUT", body }),
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
    <SpotlightCard
      theme="light"
      spotlightColor={on ? "rgba(30, 136, 229, 0.16)" : "rgba(239, 160, 11, 0.2)"}
      className={cn("flex h-full flex-col rounded-2xl p-0", !on && "ring-1 ring-[#fbe2ad]")}
    >
      <div className="relative z-[2] flex items-start gap-4 p-5">
        <IconChip icon={Icon} tone={on ? "blue" : "amber"} size="lg" className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink">{policy.title}</h3>
            {on ? (
              <Badge tone="green">
                <ShieldCheck /> Enforced
              </Badge>
            ) : (
              <Badge tone="amber">
                <ShieldOff /> Disabled
              </Badge>
            )}
          </div>
          {policy.risk && <p className="mt-0.5 text-xs font-medium text-ink-3">Mitigates: {RISK_LABELS[policy.risk] ?? policy.risk}</p>}
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{policy.description}</p>
        </div>
        <Switch size="lg" className="data-checked:bg-success" checked={on} disabled={mutation.isPending} onCheckedChange={(v) => mutation.mutate({ enabled: v })} aria-label={`${policy.title} enforced`} />
      </div>

      {!on && (
        <div className="relative z-[2] mx-5 mb-4 flex items-start gap-2 rounded-xl border border-[#fbe2ad] bg-warning-soft px-3 py-2.5 text-sm text-[#8a5a00]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <strong>Gap:</strong> {policy.gap_when_off}
          </span>
        </div>
      )}

      {Object.keys(policy.params).length > 0 && (
        <div className="relative z-[2] mx-5 mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f6f9fe] p-3">
          {Object.keys(policy.params).map((k) => (
            <Field key={k} label={PARAM_LABELS[k] ?? k} className="w-40">
              <Input type="number" min={1} value={params[k] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))} />
            </Field>
          ))}
          <Button
            variant="soft"
            className="h-10"
            disabled={!paramsDirty || mutation.isPending}
            onClick={() => mutation.mutate({ params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Number(v)])) })}
          >
            Save
          </Button>
        </div>
      )}

      <div className="relative z-[2] mt-auto rounded-b-2xl border-t border-border bg-[#fafcff] px-5 py-2.5 text-[11px] text-ink-3">
        <span className="font-mono">{policy.key}</span> · updated by {policy.updated_by ?? "—"} · {fmtDateTime(policy.updated_at)}
      </div>
    </SpotlightCard>
  );
}

function PolicyCenter() {
  const query = useQuery({
    queryKey: ["policies"],
    queryFn: () => api<{ items: Policy[] }>("/admin/policies"),
    refetchInterval: 5000,
  });
  if (query.isLoading || !query.data) return <LoadingBlock rows={6} />;
  const items = query.data.items;
  const enforced = items.filter((p) => p.enabled).length;
  const ratio = enforced / Math.max(items.length, 1);
  const severity = ratio === 1 ? "good" : ratio >= 0.75 ? "warning" : "critical";
  const off = items.filter((p) => !p.enabled);
  const risks = Object.keys(RISK_LABELS)
    .map((risk) => {
      const controls = items.filter((p) => p.risk === risk);
      return { risk, total: controls.length, on: controls.filter((p) => p.enabled).length };
    })
    .filter((r) => r.total > 0);

  return (
    <div className="space-y-5">
      <Reveal>
        <Card>
          <CardContent className="grid grid-cols-1 items-center gap-8 py-6 lg:grid-cols-[280px_1fr]">
            <RadialGauge
              value={enforced}
              max={items.length}
              severity={severity}
              caption="Security posture"
              center={
                <span className="text-[30px] leading-none font-semibold text-ink">
                  {enforced}
                  <span className="text-lg text-ink-3">/{items.length}</span>
                </span>
              }
              footer={
                <p className="text-center text-sm text-ink-2">
                  {off.length === 0 ? (
                    "All security controls are enforced."
                  ) : (
                    <>
                      <span className="font-medium text-warning">{off.length} disabled:</span> {off.map((p) => p.title).join(", ")}
                    </>
                  )}
                </p>
              }
            />
            <div>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-medium text-ink">Coverage by priority risk</h3>
                <p className="text-xs text-ink-3">Controls enforced / controls mapped to the risk</p>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                {risks.map((r) => (
                  <MeterRow
                    key={r.risk}
                    label={RISK_LABELS[r.risk]}
                    value={r.on}
                    max={r.total}
                    display={`${r.on}/${r.total}`}
                    severity={r.on === r.total ? "good" : r.on === 0 ? "critical" : "warning"}
                  />
                ))}
              </div>
              <p className="mt-5 rounded-xl bg-[#f6f9fe] px-4 py-3 text-xs leading-relaxed text-ink-2">
                Every change here emits a security event. StaySec flags disabled controls and can re-enable them after an incident.
              </p>
            </div>
          </CardContent>
        </Card>
      </Reveal>
      <Reveal delay={0.06} className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {items.map((p) => (
          <PolicyCard key={p.key} policy={p} />
        ))}
      </Reveal>
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
    mutationFn: () => api(`/admin/staff/${staff.id}`, { method: "PUT", body: { role, status, mfa_enabled: mfa, property_scope: scope } }),
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
          <Button variant="outline" onClick={onClose}>
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
          <SelectField value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="Status">
          <SelectField
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "active" },
              { value: "suspended", label: "suspended" },
            ]}
          />
        </Field>
      </div>
      <Field label="Property scope">
        <div className="flex flex-wrap gap-2">
          {properties?.map((p) => {
            const checked = scope.includes(p.id);
            return (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  checked ? "border-primary/40 bg-primary-soft text-primary-strong" : "border-input text-ink-2 hover:bg-muted",
                )}
              >
                <Checkbox checked={checked} onCheckedChange={(v) => setScope((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                {p.id} · {p.city}
              </label>
            );
          })}
        </div>
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink">MFA enabled</p>
          <p className="text-xs text-muted-foreground">Required for new-device logins and step-up</p>
        </div>
        <Switch checked={mfa} onCheckedChange={setMfa} aria-label="MFA enabled" />
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
  if (query.isLoading || !query.data) return <LoadingBlock rows={6} />;
  const staff = query.data.items;
  const mfaOn = staff.filter((s) => s.mfa_enabled).length;
  const suspended = staff.filter((s) => s.status !== "active").length;
  const byRole = Object.entries(
    staff.reduce<Record<string, number>>((acc, s) => {
      acc[s.role_label] = (acc[s.role_label] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const mfaRatio = mfaOn / Math.max(staff.length, 1);

  return (
    <div className="space-y-5">
      <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid h-full grid-cols-1 content-center gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border">
            <StatTile className="sm:pr-5" icon={<IconChip icon={Users} tone="blue" />} label="Staff accounts" value={staff.length} />
            <StatTile
              className="sm:px-5"
              icon={<IconChip icon={UserCheck} tone="green" />}
              label="MFA coverage"
              value={Math.round(mfaRatio * 100)}
              suffix="%"
              footer={
                <span className="block w-32">
                  <MeterRow label={`${mfaOn} of ${staff.length}`} value={mfaOn} max={staff.length} display="" severity={mfaRatio === 1 ? "good" : mfaRatio >= 0.8 ? "warning" : "critical"} />
                </span>
              }
            />
            <StatTile className="sm:pl-5" icon={<IconChip icon={UserX} tone="red" />} label="Suspended" value={suspended} footer={suspended ? "Cannot sign in" : "No suspended accounts"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Accounts by role</CardTitle>
              <CardDescription>{Object.keys(query.data.roles).length} roles defined</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RankedBars data={byRole} name="Staff accounts by role" series="periwinkle" />
          </CardContent>
        </Card>
      </Reveal>
      <Reveal delay={0.06}>
        <Card>
          <div className="p-5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Shift (IST)</TableHead>
                  <TableHead>MFA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <InitialsAvatar name={s.name} />
                        <div className="min-w-0 leading-tight">
                          <p className="font-medium text-ink">{s.name}</p>
                          <p className="text-xs text-ink-3">{s.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{s.id}</TableCell>
                    <TableCell>{s.role_label}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {s.property_scope.map((p) => (
                          <Badge key={p} tone={p === s.home_property ? "blue" : "slate"}>
                            {p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{s.shift}</TableCell>
                    <TableCell>{s.mfa_enabled ? <Badge tone="green">On</Badge> : <Badge tone="red">Off</Badge>}</TableCell>
                    <TableCell>{s.status === "active" ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="text-primary" onClick={() => setEditing(s)}>
                        <Pencil /> Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {editing && <StaffEditor staff={editing} roles={Object.keys(query.data.roles)} onClose={() => setEditing(null)} />}
        </Card>
      </Reveal>
    </div>
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
  const piiAvailable = available.filter((f) => PII_FIELDS.has(f)).length;
  const piiShared = fields.filter((f) => PII_FIELDS.has(f)).length;
  const sensitive = fields.some((f) => f === "passport_no" || f === "dob");
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <IconChip icon={Share2} tone="violet" />
          <div>
            <CardTitle>{partner.name}</CardTitle>
            <CardDescription>
              <span className="font-mono">{partner.id}</span> · key <span className="font-mono">{partner.key_prefix}…</span> ·{" "}
              {partner.key_rotated_at ? `rotated ${fmtDateTime(partner.key_rotated_at)}` : "never rotated"}
            </CardDescription>
          </div>
        </div>
        <Badge tone={partner.key_status === "active" ? "green" : "red"}>{partner.key_status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MeterRow label="Fields shared" value={fields.length} max={available.length} display={`${fields.length}/${available.length}`} series="blue" />
          <MeterRow
            label="Guest PII shared"
            value={piiShared}
            max={piiAvailable}
            display={`${piiShared}/${piiAvailable}`}
            severity={sensitive ? "critical" : piiShared > 0 ? "warning" : "good"}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Data contract</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {available.map((f) => {
              const checked = fields.includes(f);
              return (
                <label
                  key={f}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
                    checked ? "border-primary/30 bg-[#f4f9ff]" : "border-border hover:bg-muted",
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={(v) => setFields((s) => (v ? [...s, f] : s.filter((x) => x !== f)))} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2">{f}</span>
                  {PII_FIELDS.has(f) && <Badge tone={f === "passport_no" || f === "dob" ? "red" : "amber"}>PII</Badge>}
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end">
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
  if (query.isLoading || !query.data) return <LoadingBlock rows={6} />;
  return (
    <Reveal className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {query.data.items.map((p) => (
        <PartnerCard key={p.id} partner={p} available={query.data.available_fields} />
      ))}
    </Reveal>
  );
}

// ------------------------------ page ------------------------------

const TABS = [
  { key: "policies", label: "Policy Center", icon: ShieldCheck },
  { key: "staff", label: "Staff & access", icon: UserCog },
  { key: "partners", label: "OTA partners", icon: Share2 },
] as const;

export function AdminPage() {
  const [tab, setTab] = useState<string>("policies");
  return (
    <div>
      <PageHeader title="Security administration" subtitle="Controls enforced by the StayDesk backend for every user, screen and API call" />
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList variant="pill" className="rounded-xl bg-white p-1 shadow-card">
          {TABS.map(({ key, label, icon: Icon }) => (
            <TabsTrigger key={key} value={key}>
              <Icon /> {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="policies">
          <PolicyCenter />
        </TabsContent>
        <TabsContent value="staff">
          <StaffTab />
        </TabsContent>
        <TabsContent value="partners">
          <PartnersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
