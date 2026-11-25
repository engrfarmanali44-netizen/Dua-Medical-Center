/**
 * API base URL. If NEXT_PUBLIC_API_URL is not set, use the host the page was opened from on
 * port 8000, so the same build works at http://localhost:3000 on the PC and at
 * http://<PC-LAN-IP>:3000 on a phone (and the auth cookie stays same-site in both cases).
 */
function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:8000`;
  return "http://localhost:8000";
}

const PUBLIC_PAGES = ["/login", "/change-password", "/unauthorized"];
const AUTH_PATHS = ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout"];

function rawFetch(path: string, options: RequestInit = {}) {
  // File uploads (FormData) must let the browser set the multipart Content-Type itself.
  const json = !(options.body instanceof FormData);
  return fetch(`${apiBase()}${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(json && { "Content-Type": "application/json" }), ...options.headers },
  });
}

/**
 * The sign-in cookie lives 20 minutes; the refresh cookie 7 days. Renew once, shared by every
 * request that hit a 401 at the same moment (a second renewal with the same, now-rotated,
 * refresh token would be rejected and log the user out).
 */
let renewing: Promise<boolean> | null = null;
function renewSession(): Promise<boolean> {
  renewing ??= (async () => {
    try {
      if ((await rawFetch("/api/v1/auth/refresh", { method: "POST" })).ok) return true;
      // Another tab may have renewed first (cookies are shared): check whether we are signed in now.
      return (await rawFetch("/api/v1/auth/me")).ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => { renewing = null; }, 0);
    }
  })();
  return renewing;
}

function goToLogin() {
  if (typeof window === "undefined" || PUBLIC_PAGES.some((p) => window.location.pathname.startsWith(p))) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?expired=1&next=${next}`);
}

/** fetch() for the HMS API: sends cookies and renews an expired session transparently. */
export async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await rawFetch(path, options);
  if (res.status !== 401 || AUTH_PATHS.includes(path)) return res;
  if (await renewSession()) return rawFetch(path, options);
  goToLogin();
  return res;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FIELD_LABELS: Record<string, string> = {
  batch_number: "batch number", expiry_date: "expiry date", unit_cost: "cost price", selling_price: "selling price",
  medicine_id: "medicine", supplier_id: "supplier", patient_id: "patient", medicine_code: "code",
  generic_name: "medicine name", first_name: "first name", last_name: "last name", age: "age",
  blood_group: "blood group", paid_amount: "amount paid", discount_amount: "discount", payment_method: "payment method",
  reorder_level: "reorder level", items: "items",
};

const MESSAGE_REWRITES: [RegExp, string][] = [
  [/^String should have at least 1 character/, "is required"],
  [/^Field required/, "is required"],
  [/^Input should be greater than 0/, "must be more than 0"],
  [/^Input should be greater than or equal to 0/, "cannot be negative"],
  [/^List should have at least 1 item.*/, "needs at least one line"],
  [/^Input should be a valid (number|decimal).*/, "must be a number"],
  [/^Input should be a valid date.*/, "must be a valid date"],
  [/^Input should be a valid UUID.*/, "must be selected"],
  [/^String should match pattern.*/, "is not valid"],
];

function describeField(loc: (string | number)[]): string {
  const parts = loc.filter((p) => p !== "body" && p !== "query");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (typeof p === "number") out.push(`line ${p + 1}`);
    else if (!(p === "items" && typeof parts[i + 1] === "number")) out.push(FIELD_LABELS[p] ?? p.replaceAll("_", " "));
  }
  const s = out.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Turn FastAPI error bodies (string detail or validation list) into readable sentences. */
function errorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") {
    if (status === 401) return "Your session has expired. Please log in again.";
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const msg = MESSAGE_REWRITES.reduce((m, [re, to]) => (re.test(m) ? to : m), d.msg ?? "is not valid");
        const field = d.loc ? describeField(d.loc) : "";
        return field ? `${field} ${msg}.` : `${msg}.`;
      })
      .join(" ");
  }
  if (status === 401) return "Your session has expired. Please log in again.";
  if (status === 403) return "You do not have permission to do this.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Request failed (${status}).`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const payload = body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body);
    res = await apiFetch(`/api/v1${path}`, { method, body: payload });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your internet connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data));
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};
