/**
 * API client — toutes les requêtes au backend FastAPI.
 * Le token est stocké dans localStorage et envoyé en Bearer header.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ja_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Erreur API");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  user_id: string;
  email: string;
  plan: string;
}

export const auth = {
  signup: (email: string, password: string, full_name: string) =>
    request<TokenResponse>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, full_name }),
    }),

  login: (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password });
    return request<TokenResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  },

  me: () => request<{ id: string; email: string; full_name: string; plan: string }>("/api/auth/me"),

  logout: () => {
    localStorage.removeItem("ja_token");
    localStorage.removeItem("ja_user");
    window.location.href = "/";
  },

  saveToken: (data: TokenResponse) => {
    localStorage.setItem("ja_token", data.access_token);
    localStorage.setItem("ja_user", JSON.stringify({ id: data.user_id, email: data.email, plan: data.plan }));
  },

  currentUser: (): { id: string; email: string; plan: string } | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("ja_user");
    return raw ? JSON.parse(raw) : null;
  },
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  platform: string;
  fit_score?: number;
  fit_reasoning?: string;
  status: string;
  is_seen: boolean;
  cv_url?: string;
  letter_url?: string;
  autofill_done: boolean;
  published_at?: string;
  scraped_at: string;
}

export const jobs = {
  list: (params?: { status?: string; min_score?: number; platform?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams(params as Record<string, string>);
    return request<Job[]>(`/api/jobs?${q}`);
  },
  stats: () => request<{ total: number; by_status: Record<string, number>; submitted: number; interview: number; generated: number }>("/api/jobs/stats"),
  get: (id: string) => request<Job>(`/api/jobs/${id}`),
  update: (id: string, data: Partial<{ status: string; notes: string; is_seen: boolean }>) =>
    request<Job>(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/api/jobs/${id}`, { method: "DELETE" }),

  scrape: (data: { platforms?: string[]; queries?: string[]; locations?: string[]; max_per_query?: number }) =>
    request<{ task_id: string }>("/api/jobs/scrape", { method: "POST", body: JSON.stringify(data) }),
  analyze: (id: string) => request<{ task_id: string }>(`/api/jobs/${id}/analyze`, { method: "POST" }),
  generate: (id: string) => request<{ task_id: string }>(`/api/jobs/${id}/generate`, { method: "POST" }),
  autofill: (id: string) => request<{ task_id: string }>(`/api/jobs/${id}/autofill`, { method: "POST" }),
  pipeline: (data: object) => request<{ task_id: string }>("/api/jobs/pipeline", { method: "POST", body: JSON.stringify(data) }),
};

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  type: string;
  status: string;
  progress: number;
  job_id?: string;
  result?: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export const tasks = {
  list: () => request<Task[]>("/api/tasks"),
  get: (id: string) => request<Task>(`/api/tasks/${id}`),
  streamUrl: (id: string) => `${API_BASE}/api/tasks/${id}/stream`,
};

// ── Profile ───────────────────────────────────────────────────────────────────

export const profile = {
  get: () => request<Record<string, unknown>>("/api/profile"),
  update: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("/api/profile", { method: "PATCH", body: JSON.stringify(data) }),
  uploadCv: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/profile/cv`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error("Upload CV échoué");
    return res.json() as Promise<{ cv_url: string }>;
  },
};

// ── Billing ───────────────────────────────────────────────────────────────────

export const billing = {
  checkout: (plan: "pro" | "unlimited") =>
    request<{ checkout_url: string }>(`/api/billing/checkout?plan=${plan}`, { method: "POST" }),
  portal: () =>
    request<{ portal_url: string }>("/api/billing/portal", { method: "POST" }),
};
