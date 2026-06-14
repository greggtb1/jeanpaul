import { createClient } from "@/lib/supabase/client";
import {
  clearDraft,
  loadDraft,
  normalizeDraft,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";
import { uploadPendingCvForUser } from "@/lib/onboarding-cv";
type ActivateOptions = {
  onStep?: (message: string) => void;
};

function buildDraftForActivate(userEmail: string): OnboardingDraft {
  const stored = loadDraft();
  return normalizeDraft(stored, {
    email: stored?.email || userEmail,
    full_name: stored?.full_name || "",
    draft_id: stored?.draft_id,
  });
}

async function syncPendingCv(userId: string) {
  const cv = await uploadPendingCvForUser(userId);
  if (!cv) return;

  const supabase = createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      cv_url: cv.url,
      cv_filename: cv.filename,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) throw error;
}

export async function activateAccount(sessionId: string, options?: ActivateOptions) {
  const onStep = options?.onStep;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) throw new Error("Non authentifié");

  onStep?.("Création de votre espace…");

  const draft = buildDraftForActivate(user.email);

  onStep?.("Connexion à votre abonnement…");

  const res = await fetch("/api/auth/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, draft }),
  });

  const text = await res.text();
  let data: { error?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || "Activation échouée");
  }

  if (!res.ok) throw new Error(data.error || "Activation échouée");

  const { data: prof } = await supabase
    .from("profiles")
    .select("target_roles,target_locations")
    .eq("id", user.id)
    .maybeSingle();

  const prefsSaved =
    (prof?.target_roles?.length ?? 0) > 0 || (prof?.target_locations?.length ?? 0) > 0;
  if (prefsSaved) clearDraft();

  onStep?.("Import de votre CV…");
  await syncPendingCv(user.id);
}
