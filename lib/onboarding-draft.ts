import { parsePlanId, type PlanId } from "./plans";

export type OnboardingDraft = {
  draft_id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  target_roles: string[];
  target_locations: string[];
  location_search_mode: "city" | "radius";
  location_radius_km: string;
  contract_type: string[];
  remote_pref: string[];
  salary_min: string;
  cv_url: string;
  cv_filename: string;
  cv_path: string;
  letter_tone: string;
  letter_sample: string;
  plan_id: PlanId;
  referral_code?: string;
};

const DRAFT_KEY = "jp_onboarding_draft";
const DRAFT_ID_KEY = "jp_draft_id";

export function getOrCreateDraftId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DRAFT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DRAFT_ID_KEY, id);
  }
  return id;
}

export function loadDraft(): Partial<OnboardingDraft> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY) ?? sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<OnboardingDraft>) : null;
  } catch {
    return null;
  }
}

export function saveDraft(patch: Partial<OnboardingDraft>): OnboardingDraft {
  const draftId = patch.draft_id || getOrCreateDraftId();
  const current = loadDraft() ?? {};
  const next: OnboardingDraft = {
    full_name: "",
    email: "",
    phone: "",
    location: "",
    target_roles: [],
    target_locations: [],
    location_search_mode: "city",
    location_radius_km: "",
    contract_type: [],
    remote_pref: [],
    salary_min: "",
    cv_url: "",
    cv_filename: "",
    cv_path: "",
    letter_tone: "",
    letter_sample: "",
    plan_id: parsePlanId(null),
    ...current,
    ...patch,
    draft_id: draftId,
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function clearDraft() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
  localStorage.removeItem(DRAFT_ID_KEY);
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function draftToProfilePayload(draft: OnboardingDraft, userId: string) {
  const cvUrl = draft.cv_url && draft.cv_url !== "local" ? draft.cv_url : null;
  return {
    id: userId,
    full_name: draft.full_name || null,
    email: draft.email || null,
    phone: draft.phone || null,
    location: draft.location || null,
    target_roles: draft.target_roles ?? [],
    target_locations: draft.target_locations ?? [],
    location_search_mode: draft.location_search_mode || "city",
    location_radius_km:
      draft.location_search_mode === "city"
        ? null
        : draft.location_radius_km
          ? parseInt(draft.location_radius_km, 10)
          : 25,
    contract_type: draft.contract_type ?? [],
    remote_pref: draft.remote_pref ?? [],
    salary_min: draft.salary_min ? parseInt(draft.salary_min, 10) : null,
    cv_url: cvUrl,
    cv_filename: draft.cv_filename || null,
    letter_tone: draft.letter_tone || "pro",
    letter_sample: draft.letter_sample?.trim() || null,
    onboarding_done: true,
    updated_at: new Date().toISOString(),
  };
}

export function emptyDraft(draftId = ""): OnboardingDraft {
  return {
    draft_id: draftId || (typeof window !== "undefined" ? getOrCreateDraftId() : ""),
    full_name: "",
    email: "",
    phone: "",
    location: "",
    target_roles: [],
    target_locations: [],
    location_search_mode: "city",
    location_radius_km: "",
    contract_type: [],
    remote_pref: [],
    salary_min: "",
    cv_url: "",
    cv_filename: "",
    cv_path: "",
    letter_tone: "",
    letter_sample: "",
    plan_id: parsePlanId(null),
  };
}

export function normalizeDraft(
  partial: Partial<OnboardingDraft> | null | undefined,
  fallback: { email?: string; full_name?: string; plan_id?: PlanId; draft_id?: string }
): OnboardingDraft {
  const stored = partial ?? loadDraft() ?? {};
  const base = emptyDraft();
  const cvUrl = stored.cv_url === "local" ? "" : stored.cv_url ?? "";
  return {
    ...base,
    ...stored,
    draft_id: stored.draft_id || fallback.draft_id || base.draft_id || crypto.randomUUID(),
    email: stored.email || fallback.email || "",
    full_name: stored.full_name || fallback.full_name || "",
    plan_id: parsePlanId(fallback.plan_id ?? stored.plan_id),
    cv_url: cvUrl,
    target_roles: stored.target_roles ?? [],
    target_locations: stored.target_locations ?? [],
    location_search_mode: stored.location_search_mode ?? "city",
    location_radius_km: stored.location_radius_km ?? "",
    contract_type: stored.contract_type ?? [],
    remote_pref: stored.remote_pref ?? [],
  };
}
