import type { Profile } from "@/lib/supabase";
import type { OnboardingDraft } from "@/lib/onboarding-draft";
import { resolveCalibrationSources } from "@/lib/no-cv-calibration";
import { asStringArray } from "@/lib/profile-preferences";

/** Remplit le profil avec les préférences du brouillon onboarding si absentes en base. */
export function buildOnboardingPrefsPatch(
  profile: Profile | null | undefined,
  draft: Partial<OnboardingDraft> | null
): Partial<
  Pick<Profile, "target_roles" | "target_locations" | "contract_type" | "remote_pref">
> | null {
  if (!draft) return null;

  const src = resolveCalibrationSources(profile, draft);
  const patch: Partial<
    Pick<Profile, "target_roles" | "target_locations" | "contract_type" | "remote_pref">
  > = {};

  if (!profile?.target_roles?.length && src.target_roles.length) {
    patch.target_roles = src.target_roles;
  }
  if (!profile?.target_locations?.length && src.target_locations.length) {
    patch.target_locations = src.target_locations;
  }
  if (!asStringArray(profile?.contract_type).length && src.contract_type.length) {
    patch.contract_type = src.contract_type;
  }
  if (!asStringArray(profile?.remote_pref).length && src.remote_pref.length) {
    patch.remote_pref = src.remote_pref;
  }

  return Object.keys(patch).length ? patch : null;
}
