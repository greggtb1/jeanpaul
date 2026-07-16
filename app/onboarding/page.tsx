"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { parsePlanId, planQuery } from "@/lib/plans";
import {
  loadDraft,
  saveDraft,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";
import { extractCvProfile } from "@/lib/extract-cv";
import { identityFromCvExtraction } from "@/lib/parse-cv-profile";
import { getPendingCv } from "@/lib/onboarding-cv";
import {
  ROLE_GROUPS,
  ROLE_DOMAINS,
  LOCATION_SUGGESTIONS,
  LOCATION_RADIUS_OPTIONS,
  CONTRACTS,
  REMOTE,
  SALARY_QUICK_RANGES,
  asStringArray,
} from "@/lib/profile-preferences";
import {
  PrefField as Field,
  LetterTonePicker,
  LetterSampleOptional,
  MultiChoice,
  TagInput,
  CvDropzone,
} from "@/components/ProfilePreferencesFields";
import BrandName from "@/components/BrandName";
import TrialUsedBlock from "@/components/TrialUsedBlock";
import { queueDashboardProductTourAfterOnboarding } from "@/components/DashboardProductTour";
import { trackEvent } from "@/lib/umami";
import {
  appendRefToPath,
  getStoredReferralCode,
  persistReferralCode,
} from "@/lib/referral-storage";

type Form = Omit<OnboardingDraft, "draft_id" | "plan_id">;

const ROLE_TYPEWRITER_WORDS = [
  "Growth Marketing",
  "Product Manager",
  "Business Developer",
  "UX Designer",
  "Data Analyst",
  "Community Manager",
  "Chef de projet digital",
  "Développeur Full Stack",
  "Consultant",
  "Chargé de recrutement",
];

const EMPTY: Form = {
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
};

const STEPS = [
  "Contrat",
  "Lieux",
  "Postes",
  "Salaire",
  "CV",
  "Lettres",
];

export default function Onboarding() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = parsePlanId(searchParams.get("plan"));
  const referralCodeParam = searchParams.get("ref")?.trim() || "";

  useEffect(() => {
    if (referralCodeParam) {
      const code = persistReferralCode(referralCodeParam);
      if (code) saveDraft({ referral_code: code });
    }
  }, [referralCodeParam]);
  const { uid, user } = useAuth();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [parsingCv, setParsingCv] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [trialUsedBlock, setTrialUsedBlock] = useState(false);
  const parsedCvKey = useRef("");

  useEffect(() => {
    trackEvent("onboarding_step_view", {
      step: step + 1,
      step_name: STEPS[step],
      plan: planId,
      already_paid: alreadyPaid,
    });
  }, [step, planId, alreadyPaid]);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setForm((f) => ({
        ...f,
        full_name: "",
        email: "",
        phone: "",
        location: draft.location ?? "",
        target_roles: draft.target_roles ?? [],
        target_locations: draft.target_locations ?? [],
        location_search_mode: draft.location_search_mode ?? "city",
        location_radius_km: draft.location_radius_km ?? "",
        contract_type: draft.contract_type ?? [],
        remote_pref: draft.remote_pref ?? [],
        salary_min: draft.salary_min ?? "",
        cv_url: draft.cv_url ?? "",
        cv_filename: draft.cv_filename ?? "",
        cv_path: draft.cv_path ?? "",
        letter_tone: draft.letter_tone ?? "",
        letter_sample: draft.letter_sample ?? "",
      }));
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const paid =
          data.subscription_status === "active" ||
          data.subscription_status === "trialing";
        setAlreadyPaid(paid);
        // Préférer ce que l'utilisateur a déjà saisi dans cette session :
        // sinon un fetch profil (souvent letter_tone="pro") écrase le ton choisi.
        setForm((f) => ({
          ...f,
          target_roles: f.target_roles.length ? f.target_roles : (data.target_roles ?? f.target_roles),
          target_locations: f.target_locations.length
            ? f.target_locations
            : (data.target_locations ?? f.target_locations),
          location_search_mode: f.location_search_mode || data.location_search_mode || "city",
          location_radius_km:
            f.location_radius_km ||
            (data.location_radius_km != null ? String(data.location_radius_km) : ""),
          contract_type: f.contract_type.length
            ? f.contract_type
            : asStringArray(data.contract_type).length
              ? asStringArray(data.contract_type)
              : f.contract_type,
          remote_pref: f.remote_pref.length
            ? f.remote_pref
            : asStringArray(data.remote_pref).length
              ? asStringArray(data.remote_pref)
              : f.remote_pref,
          salary_min: f.salary_min || (data.salary_min ? String(data.salary_min) : ""),
          cv_url: f.cv_url || data.cv_url || "",
          cv_filename: f.cv_filename || data.cv_filename || "",
          letter_tone: f.letter_tone || data.letter_tone || "",
          letter_sample: f.letter_sample || data.letter_sample || "",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function applyCvIdentityFromFile(file: File) {
    const profile = await extractCvProfile(file);
    const identity = identityFromCvExtraction(profile, file.name);
    parsedCvKey.current = `${file.name}|local`;
    setForm((f) => ({
      ...f,
      ...identity,
      cv_url: "local",
      cv_filename: file.name,
      cv_path: "",
    }));
  }

  useEffect(() => {
    if (step !== 4 || !form.cv_filename) return;
    const key = `${form.cv_filename}|${form.cv_url || "local"}`;
    if (parsedCvKey.current === key) return;

    let cancelled = false;
    (async () => {
      setParsingCv(true);
      try {
        let file: File | null = await getPendingCv();
        if (!file && form.cv_url && form.cv_url !== "local") {
          const res = await fetch(form.cv_url);
          if (!res.ok) return;
          const blob = await res.blob();
          file = new File([blob], form.cv_filename, { type: "application/pdf" });
        }
        if (!file || cancelled) return;
        const profile = await extractCvProfile(file);
        if (cancelled) return;
        parsedCvKey.current = key;
        const identity = identityFromCvExtraction(profile, file.name);
        setForm((f) => ({ ...f, ...identity }));
      } catch {
        /* extraction optionnelle */
      } finally {
        if (!cancelled) setParsingCv(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, form.cv_filename, form.cv_url]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const canNext = useMemo(() => {
    if (step === 0) {
      return form.contract_type.length > 0 && form.remote_pref.length > 0;
    }
    if (step === 1) return form.target_locations.length > 0;
    if (step === 2) return form.target_roles.length > 0;
    if (step === 5) return !!form.letter_tone.trim();
    return true;
  }, [step, form]);

  async function handleFile(file: File) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      alert("Merci d'uploader un CV au format PDF.");
      return;
    }
    setUploading(true);
    setParsingCv(true);
    try {
      const { savePendingCv } = await import("@/lib/onboarding-cv");
      await savePendingCv(file);
      set({ cv_url: "local", cv_filename: file.name, cv_path: "" });
      trackEvent("onboarding_cv_uploaded", {
        step: step + 1,
        file_type: file.type || "application/pdf",
      });

      try {
        await applyCvIdentityFromFile(file);
        trackEvent("onboarding_cv_parsed", { result: "success" });
      } catch {
        /* extraction optionnelle */
        trackEvent("onboarding_cv_parsed", { result: "fallback" });
        parsedCvKey.current = `${file.name}|local`;
        setForm((f) => ({
          ...f,
          full_name: identityFromCvExtraction(
            { full_name: "", email: "", phone: "", location: "" },
            file.name
          ).full_name,
          email: "",
          phone: "",
          cv_url: "local",
          cv_filename: file.name,
          cv_path: "",
        }));
      }
    } catch (e) {
      trackEvent("onboarding_cv_upload_error");
      alert("Enregistrement échoué : " + (e as Error).message);
    } finally {
      setUploading(false);
      setParsingCv(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const email = user?.email?.trim() || form.email.trim();
      const fullName = form.full_name.trim();

      if (alreadyPaid && uid) {
        trackEvent("onboarding_complete_attempt", {
          plan: planId,
          already_paid: true,
          has_cv: !!form.cv_filename,
        });
        const res = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName || undefined,
            email: email || undefined,
            phone: form.phone || undefined,
            location: form.location || undefined,
            target_roles: form.target_roles,
            target_locations: form.target_locations,
            location_search_mode: form.location_search_mode,
            location_radius_km:
              form.location_search_mode === "city"
                ? undefined
                : Number(form.location_radius_km || 25),
            contract_type: form.contract_type,
            remote_pref: form.remote_pref,
            salary_min: form.salary_min ? Number(form.salary_min) : undefined,
            letter_tone: form.letter_tone || undefined,
            letter_sample: form.letter_sample || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Sauvegarde échouée");
        trackEvent("onboarding_completed", {
          plan: planId,
          already_paid: true,
          has_cv: !!form.cv_filename,
        });
        queueDashboardProductTourAfterOnboarding();
        router.push("/dashboard");
        return;
      }

      trackEvent("onboarding_complete_attempt", {
        plan: planId,
        already_paid: false,
        has_cv: !!form.cv_filename,
      });
      const refCode = getStoredReferralCode() || referralCodeParam;
      const draft = saveDraft({
        ...form,
        plan_id: planId,
        email,
        full_name: fullName,
        ...(refCode ? { referral_code: refCode } : {}),
      });
      trackEvent("onboarding_completed", {
        plan: planId,
        already_paid: false,
        has_cv: !!form.cv_filename,
      });

      // Scan découverte gratuit : session anonyme + premier scan bridé, paiement plus tard.
      try {
        // Toujours tenter de retrouver la session existante (cookie Supabase encore
        // valide, même après plusieurs jours) avant d'en recréer une nouvelle.
        const supabase = createClient();
        let userId = uid;
        if (!userId) {
          const { data: current } = await supabase.auth.getUser();
          userId = current.user?.id ?? "";
        }
        if (!userId) {
          const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
          if (anonError || !anon.user) throw anonError ?? new Error("Session anonyme refusée");
          userId = anon.user.id;
        }

        let trialDraft = draft;
        try {
          const { uploadPendingCvForUser } = await import("@/lib/onboarding-cv");
          const cv = await uploadPendingCvForUser(userId);
          if (cv) {
            trialDraft = saveDraft({ cv_url: cv.url, cv_filename: cv.filename, cv_path: cv.path });
          }
        } catch {
          /* CV optionnel : le scan démarre sans */
        }

        const shouldPrepareBeforeScan = !trialDraft.cv_url || trialDraft.cv_url === "local";
        const res = await fetch("/api/trial/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft: trialDraft,
            prepare_only: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Session reconnue : on renvoie l'utilisateur vers son dashboard existant.
          if (data.existingSession && data.redirectTo) {
            router.push(data.redirectTo);
            return;
          }
          // Essai déjà utilisé : on affiche le blocage directement en fin d'onboarding.
          if (data.trialUsed) {
            trackEvent("onboarding_trial_used_blocked", { plan: planId });
            setTrialUsedBlock(true);
            setSaving(false);
            return;
          }
          if (data.redirectTo) {
            router.push(data.redirectTo);
            return;
          }
          throw new Error(data.error || "Recherche indisponible");
        }
        if (data.existingSession && data.redirectTo) {
          router.push(data.redirectTo);
          return;
        }
        trackEvent("trial_scan_prepared", {
          plan: planId,
          has_cv: !!form.cv_filename,
          cv_pending: shouldPrepareBeforeScan,
        });
        queueDashboardProductTourAfterOnboarding();
        router.push("/dashboard");
        return;
      } catch {
        trackEvent("trial_scan_unavailable", { plan: planId });
        /* fallback : parcours paiement classique */
      }

      const query = planQuery(planId);
      router.push(appendRefToPath(`${query ? `/subscribe${query}&` : "/subscribe?"}fallback=1`, refCode));
    } catch (e) {
      trackEvent("onboarding_complete_error", { step: step + 1 });
      alert("Erreur : " + (e as Error).message);
      setSaving(false);
    }
  }

  const persistDraft = () => {
    const refCode = getStoredReferralCode() || referralCodeParam;
    saveDraft({
      ...form,
      plan_id: planId,
      email: user?.email?.trim() || form.email.trim(),
      full_name: form.full_name.trim(),
      ...(refCode ? { referral_code: refCode } : {}),
    });
  };

  const next = () => {
    trackEvent("onboarding_step_next", {
      step: step + 1,
      step_name: STEPS[step],
      plan: planId,
      has_cv: !!form.cv_filename,
    });
    persistDraft();
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => {
    trackEvent("onboarding_step_back", {
      step: step + 1,
      step_name: STEPS[step],
      plan: planId,
    });
    persistDraft();
    setStep((s) => Math.max(0, s - 1));
  };
  const busy = saving || uploading || parsingCv;

  return (
    <div className="ob">
      <div className="bg-decor" aria-hidden="true" />
      {trialUsedBlock && <TrialUsedBlock source="onboarding" />}
      <div
        className={`ob__shell${trialUsedBlock ? " db__main--blocked" : ""}`}
        aria-hidden={trialUsedBlock || undefined}
      >
        <header className="ob__top">
          <BrandName />
          <div className="ob__progress" aria-hidden="true">
            <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
          <span className="ob__count">
            {step + 1} / {STEPS.length}
          </span>
        </header>

        <div className="ob__card" key={step}>
          {step === 0 && (
            <Section
              kicker="Votre recherche"
              title="Quel type de contrat ?"
              subtitle="On commence par le cadre : contrat et mode de travail. Plusieurs choix possibles."
            >
              <Field label="Type de contrat">
                <MultiChoice
                  options={CONTRACTS}
                  value={form.contract_type}
                  onChange={(v) => set({ contract_type: v })}
                />
              </Field>
              <Field label="Présentiel">
                <MultiChoice
                  options={REMOTE}
                  value={form.remote_pref}
                  onChange={(v) => set({ remote_pref: v })}
                />
              </Field>
            </Section>
          )}

          {step === 1 && (
            <Section
              kicker="Votre recherche"
              title="Où souhaitez-vous travailler ?"
            >
              <Field label="Lieux">
                <div className="ob__location-row">
                  <TagInput
                    value={form.target_locations}
                    onChange={(v) => set({ target_locations: v })}
                    suggestions={LOCATION_SUGGESTIONS}
                    placeholder="Paris, Remote, Lyon…"
                  />
                  {form.target_locations.some(
                    (l) => !/remote|t[ée]l[ée]travail|distanciel/i.test(l)
                  ) && (
                    <LocationRadiusPicker
                      mode={form.location_search_mode}
                      radiusKm={form.location_radius_km}
                      onSelect={(option) =>
                        option.value === "city"
                          ? set({ location_search_mode: "city", location_radius_km: "" })
                          : set({
                              location_search_mode: "radius",
                              location_radius_km: option.value,
                            })
                      }
                    />
                  )}
                </div>
              </Field>
            </Section>
          )}

          {step === 2 && (
            <Section
              kicker="Votre recherche"
              title="Que recherchez-vous ?"
            >
              <Field label="Postes visés">
                <TagInput
                  value={form.target_roles}
                  onChange={(v) => set({ target_roles: v })}
                  groups={ROLE_GROUPS}
                  domains={ROLE_DOMAINS}
                  placeholder="Ex. Growth Marketing, Product Manager…"
                  hint="Les suggestions sont optionnelles. ou insérer votre propre intitulé"
                  autocomplete
                  typewriterWords={ROLE_TYPEWRITER_WORDS}
                />
              </Field>
            </Section>
          )}

          {step === 3 && (
            <Section
              kicker="Votre recherche"
              title="Un salaire minimum ?"
              optional
            >
              <div className="ob__salary-grid">
                {SALARY_QUICK_RANGES.map((v) => (
                  <button
                    type="button"
                    key={v}
                    className={`ob__salary-chip ${form.salary_min === v ? "is-active" : ""}`}
                    onClick={() => set({ salary_min: form.salary_min === v ? "" : v })}
                    aria-pressed={form.salary_min === v}
                  >
                    <strong>{v}</strong>
                    <span>k€/an</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`ob__salary-chip ob__salary-chip--unknown ${!form.salary_min ? "is-active" : ""}`}
                  onClick={() => {
                    set({ salary_min: "" });
                    trackEvent("onboarding_salary_skip", { step: step + 1, plan: planId });
                  }}
                  aria-pressed={!form.salary_min}
                >
                  Je ne sais pas
                </button>
              </div>
              <p className="ob__hint ob__hint--inline">
                Vous pourrez préciser plus tard dans vos préférences.
              </p>
            </Section>
          )}

          {step === 4 && (
            <Section
              kicker="Votre CV"
              title="Déposez votre CV"
              optional
            >
              <CvDropzone
                cvUrl={form.cv_url}
                cvFilename={form.cv_filename}
                uploading={uploading || parsingCv}
                onFile={handleFile}
              />
              <p className="ob__reassure">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="m9 12 2 2 4-4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                Votre CV reste privé. Il sert uniquement à préparer vos dossiers et n&apos;est jamais
                partagé.
              </p>
              {parsingCv && (
                <p className="ob__hint">Analyse du CV en cours…</p>
              )}
            </Section>
          )}

          {step === 5 && (
            <Section
              kicker="Dernière étape"
              title="Sélectionnez le ton de vos lettres"
            >
              <LetterTonePicker
                grid
                value={form.letter_tone}
                onChange={(v) => set({ letter_tone: v })}
              />
              <p className="ob__hint ob__hint--inline ob__hint--tight">
                Chaque lettre sera adaptée à l&apos;offre. Le style reste modifiable à tout moment
                dans vos préférences.
              </p>
              <LetterSampleOptional
                value={form.letter_sample}
                onChange={(v) => set({ letter_sample: v })}
              />
            </Section>
          )}

          <div className="ob__actions">
            <div className="ob__actions-row">
              {step > 0 ? (
                <button className="btn btn--outline" onClick={back} disabled={busy}>
                  Retour
                </button>
              ) : (
                <span />
              )}
              <button className="btn btn--coral" onClick={next} disabled={!canNext || busy}>
                {saving ? (
                  <span className="ob__btn-loading">
                    <span className="ob__btn-spinner" aria-hidden="true" />
                    Préparation en cours…
                  </span>
                ) : step === STEPS.length - 1 ? (
                  "Lancer ma première recherche"
                ) : step === 4 && !form.cv_filename ? (
                  "Continuer sans CV"
                ) : (
                  "Continuer"
                )}
              </button>
            </div>
            {saving && (
              <p className="ob__actions-status" role="status" aria-live="polite">
                On prépare votre espace et votre premier scan…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  kicker,
  title,
  subtitle,
  optional,
  children,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="ob__section">
      <div className="ob__section-head">
        <span className="ob__kicker">{kicker}</span>
      </div>
      <h1 className="ob__title">
        {title}
        {optional && <span className="ob__step-badge">Optionnel</span>}
      </h1>
      {subtitle && <p className="ob__subtitle">{subtitle}</p>}
      <div className="ob__fields">{children}</div>
    </div>
  );
}

function LocationRadiusPicker({
  mode,
  radiusKm,
  onSelect,
}: {
  mode: "city" | "radius";
  radiusKm: string;
  onSelect: (option: (typeof LOCATION_RADIUS_OPTIONS)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const current =
    mode === "radius"
      ? LOCATION_RADIUS_OPTIONS.find((o) => o.value === radiusKm) ?? LOCATION_RADIUS_OPTIONS[0]
      : LOCATION_RADIUS_OPTIONS[0];

  return (
    <div className={`ob__radius${open ? " ob__radius--open" : ""}`}>
      <button
        type="button"
        className="ob__radius-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Rayon autour de vos villes"
      >
        <svg className="ob__radius-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        </svg>
        <span className="ob__radius-value">{current.label}</span>
        <svg className="ob__radius-caret" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="ob__radius-backdrop"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="ob__radius-pop" role="menu">
            <p className="ob__radius-pop-title">Élargir autour de vos villes</p>
            <div className="ob__radius-pop-opts">
              {LOCATION_RADIUS_OPTIONS.map((option) => {
                const active =
                  option.value === "city"
                    ? mode === "city"
                    : mode === "radius" && radiusKm === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`ob__radius-opt${active ? " is-active" : ""}`}
                    onClick={() => {
                      onSelect(option);
                      setOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
