import type { Profile } from "@/lib/supabase";

export const SENIORITY_LEVELS = [
  { id: "junior", label: "Junior" },
  { id: "confirme", label: "Confirmé" },
  { id: "senior", label: "Senior" },
] as const;

export type SeniorityId = (typeof SENIORITY_LEVELS)[number]["id"];

/** Une seule étape : qui êtes-vous pro (le reste vient de l'onboarding). */
export type CalibrationStepId = "about_you";

export type NoCvCalibrationData = {
  experience: string;
  seniority: SeniorityId | "";
};

export type CalibrationDraft = {
  target_roles?: string[];
  target_locations?: string[];
  location?: string;
  contract_type?: string[];
  remote_pref?: string[];
};

export function hasUploadedCv(profile: Profile | null | undefined): boolean {
  return !!profile?.cv_url?.trim();
}

export function parseSummaryToCalibration(
  summary: string | null | undefined
): Pick<NoCvCalibrationData, "experience" | "seniority"> {
  const raw = summary?.trim() ?? "";
  let seniority: SeniorityId | "" = "";
  let experience = raw;

  for (const level of SENIORITY_LEVELS) {
    const prefix = `Niveau : ${level.label}`;
    if (raw.startsWith(prefix)) {
      seniority = level.id;
      experience = raw.slice(prefix.length).replace(/^\s*\n+/, "").trim();
      break;
    }
  }

  return { experience, seniority };
}

/** Préférences recherche : profil Supabase, puis brouillon onboarding. */
export function resolveCalibrationSources(
  profile: Profile | null | undefined,
  draft?: CalibrationDraft | null
): {
  target_roles: string[];
  target_locations: string[];
  contract_type: string[];
  remote_pref: string[];
  summary: string | null | undefined;
} {
  const target_roles = profile?.target_roles?.length
    ? profile.target_roles
    : draft?.target_roles?.length
      ? draft.target_roles
      : [];

  let target_locations = profile?.target_locations?.length ? profile.target_locations : [];
  if (!target_locations.length && draft?.target_locations?.length) {
    target_locations = draft.target_locations;
  }
  if (!target_locations.length) {
    const loc = profile?.location?.trim() || draft?.location?.trim();
    if (loc) target_locations = [loc];
  }

  const contract_type = profile?.contract_type?.length
    ? profile.contract_type
    : draft?.contract_type?.length
      ? draft.contract_type
      : [];

  const remote_pref = profile?.remote_pref?.length
    ? profile.remote_pref
    : draft?.remote_pref?.length
      ? draft.remote_pref
      : [];

  return {
    target_roles,
    target_locations,
    contract_type,
    remote_pref,
    summary: profile?.summary,
  };
}

export function hasAboutYouProfile(profile: Profile | null | undefined): boolean {
  const { experience } = parseSummaryToCalibration(profile?.summary);
  return experience.length >= 20;
}

export function needsPreScanNoCvModal(profile: Profile | null | undefined): boolean {
  return !hasUploadedCv(profile);
}

/** Questions sans CV : uniquement le profil perso si pas encore renseigné. */
export function getCalibrationSteps(
  profile: Profile | null | undefined,
  _draft?: CalibrationDraft | null
): CalibrationStepId[] {
  if (hasUploadedCv(profile)) return [];
  if (hasAboutYouProfile(profile)) return [];
  return ["about_you"];
}

export function needsNoCvScanCalibration(
  profile: Profile | null | undefined,
  draft?: CalibrationDraft | null
): boolean {
  if (hasUploadedCv(profile)) return false;
  return getCalibrationSteps(profile, draft).length > 0;
}

export function needsNoCvCalibration(
  profile: Profile | null | undefined,
  draft?: CalibrationDraft | null
): boolean {
  return needsPreScanNoCvModal(profile) || getCalibrationSteps(profile, draft).length > 0;
}

export function calibrationPromptLabel(
  profile: Profile | null | undefined,
  draft?: CalibrationDraft | null
): string {
  if (!hasUploadedCv(profile)) {
    if (needsNoCvScanCalibration(profile, draft)) {
      return "Déposez votre CV pour des dossiers personnalisés, ou décrivez-vous en 2 phrases.";
    }
    return "Déposez votre CV pour personnaliser vos dossiers à chaque offre.";
  }
  if (getCalibrationSteps(profile, draft).length) {
    return "1 question rapide sur votre profil.";
  }
  return "";
}

export function formatProfileSummary(
  experience: string,
  seniority: SeniorityId | ""
): string {
  const parts: string[] = [];
  if (seniority) {
    const label = SENIORITY_LEVELS.find((s) => s.id === seniority)?.label ?? seniority;
    parts.push(`Niveau : ${label}`);
  }
  const exp = experience.trim();
  if (exp) parts.push(exp);
  return parts.join("\n\n");
}

export function profileToCalibrationDefaults(
  profile: Profile | null | undefined,
  _draft?: CalibrationDraft | null
): NoCvCalibrationData {
  const { experience, seniority } = parseSummaryToCalibration(profile?.summary);
  return { experience, seniority };
}

export function calibrationStepIsValid(
  step: CalibrationStepId,
  data: NoCvCalibrationData
): boolean {
  if (step === "about_you") {
    return data.experience.trim().length >= 20;
  }
  return false;
}

export function calibrationIsValid(data: NoCvCalibrationData): boolean {
  return data.experience.trim().length >= 20;
}
