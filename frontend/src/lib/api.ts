export const API_URL: string =
  ((import.meta.env.VITE_API_URL as string | undefined) || "http://127.0.0.1:8000/api").replace(/\/$/, "");

export interface ApiDetail {
  error?: string;
  reason?: string;
  policy?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  detail: ApiDetail | null;

  constructor(status: number, detail: ApiDetail | null) {
    super(detail?.reason || detail?.error || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

// ---------------- local identity / demo settings ----------------

const TOKEN_KEY = "staydesk.token";
const DEVICE_KEY = "staydesk.device_id";
const CLOCK_KEY = "staydesk.demo_clock";

let staffToken: string | null = sessionStorage.getItem(TOKEN_KEY);

export const getToken = () => staffToken;

export function setToken(token: string | null) {
  staffToken = token;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${randomId()}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function resetDeviceId(): string {
  localStorage.removeItem(DEVICE_KEY);
  return getDeviceId();
}

export const getDemoClock = () => localStorage.getItem(CLOCK_KEY) || "";

export function setDemoClock(value: string) {
  if (value) localStorage.setItem(CLOCK_KEY, value);
  else localStorage.removeItem(CLOCK_KEY);
}

// ---------------- global hooks (set by providers) ----------------

export const apiHooks: {
  onUnauthorized?: (detail: ApiDetail | null) => void;
  onStepUp?: (detail: ApiDetail) => Promise<boolean>;
} = {};

// ---------------- request ----------------

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  query?: Record<string, QueryValue>;
  /** staff = staff bearer token, guest = guestToken, none = no Authorization header */
  auth?: "staff" | "guest" | "none";
  guestToken?: string | null;
  raw?: boolean;
  retried?: boolean;
}

function normalizeDetail(json: unknown, statusText: string): ApiDetail {
  const detail = (json as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) return detail as ApiDetail;
  if (Array.isArray(detail)) {
    return {
      error: "validation_error",
      reason: detail.map((d: { msg?: string; loc?: unknown[] }) => `${(d.loc || []).slice(1).join(".")}: ${d.msg}`).join("; "),
    };
  }
  return { error: "error", reason: typeof detail === "string" ? detail : statusText };
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, form, query, auth = "staff", raw } = opts;
  // API_URL may be absolute (local dev) or relative ("/api" behind CloudFront); resolve against the page origin.
  const url = new URL(API_URL + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = { "X-Device-Id": getDeviceId() };
  const clock = getDemoClock();
  if (clock) headers["X-Demo-Clock"] = clock;
  if (auth === "staff" && staffToken) headers.Authorization = `Bearer ${staffToken}`;
  if (auth === "guest" && opts.guestToken) headers.Authorization = `Bearer ${opts.guestToken}`;

  let payload: BodyInit | undefined;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, { error: "network_error", reason: `Cannot reach the StayDesk API at ${API_URL}` });
  }

  if (!res.ok) {
    let detail: ApiDetail | null = null;
    try {
      detail = normalizeDetail(await res.json(), res.statusText);
    } catch {
      detail = { error: "error", reason: res.statusText };
    }
    if (res.status === 401 && auth === "staff" && staffToken) {
      apiHooks.onUnauthorized?.(detail);
    }
    if (res.status === 403 && detail?.code === "step_up_required" && apiHooks.onStepUp && !opts.retried) {
      const ok = await apiHooks.onStepUp(detail);
      if (ok) return api<T>(path, { ...opts, retried: true });
    }
    throw new ApiError(res.status, detail);
  }

  if (raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function describeError(err: unknown): { title: string; description?: string } {
  if (err instanceof ApiError) {
    const d = err.detail;
    const title =
      err.status === 403 ? "Blocked by security control" : err.status === 0 ? "Network error" : `Request failed (${err.status})`;
    const parts = [d?.reason || d?.error || err.message];
    if (d?.policy) parts.push(`Control: ${d.policy}`);
    return { title, description: parts.filter(Boolean).join(" · ") };
  }
  return { title: "Something went wrong", description: err instanceof Error ? err.message : String(err) };
}
