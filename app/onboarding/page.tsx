"use client";

import { useEffect, useMemo, useState } from "react";
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
import { resolveFullName } from "@/lib/parse-cv-profile";
import {
  ROLE_GROUPS,
  LOCATION_SUGGESTIONS,
  CONTRACTS,
  REMOTE,
  asStringArray,
} from "@/lib/profile-preferences";
import {
  PrefField as Field,
  LetterTonePicker,
  MultiChoice,
  TagInput,
  CvDropzone,
} from "@/components/ProfilePreferencesFields";

type Form = Omit<OnboardingDraft, "draft_id" | "plan_id">;

const EMPTY: Form = {
  full_name: "",
  email: "",
  phone: "",
  location: "",
  target_roles: [],
  target_locations: [],
  contract_type: [],
  remote_pref: [],
  salary_min: "",
  cv_url: "",
  cv_filename: "",
  cv_path: "",
  letter_tone: "pro",
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
  const { uid, user } = useAuth();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [parsingCv, setParsingCv] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setForm((f) => ({
        ...f,
        full_name: draft.full_name ?? "",
        email: draft.email ?? "",
        phone: draft.phone ?? "",
        location: draft.location ?? "",
        target_roles: draft.target_roles ?? [],
        target_locations: draft.target_locations ?? [],
        contract_type: draft.contract_type ?? [],
        remote_pref: draft.remote_pref ?? [],
        salary_min: draft.salary_min ?? "",
        cv_url: draft.cv_url ?? "",
        cv_filename: draft.cv_filename ?? "",
        cv_path: draft.cv_path ?? "",
        letter_tone: draft.letter_tone ?? "pro",
        letter_sample: draft.letter_sample ?? "",
      }));
    }
  }, []);

  useEffect(() => {
    if (!uid) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const paid =
          data.subscription_status === "active" ||
          data.subscription_status === "trialing";
        setAlreadyPaid(paid);
        setForm((f) => ({
          ...f,
          full_name: data.full_name ?? user?.user_metadata?.full_name ?? f.full_name,
          email: data.email ?? user?.email ?? f.email,
          phone: data.phone ?? f.phone,
          location: data.location ?? f.location,
          target_roles: data.target_roles ?? f.target_roles,
          target_locations: data.target_locations ?? f.target_locations,
          contract_type: asStringArray(data.contract_type).length
            ? asStringArray(data.contract_type)
            : f.contract_type,
          remote_pref: asStringArray(data.remote_pref).length
            ? asStringArray(data.remote_pref)
            : f.remote_pref,
          salary_min: data.salary_min ? String(data.salary_min) : f.salary_min,
          cv_url: data.cv_url ?? f.cv_url,
          cv_filename: data.cv_filename ?? f.cv_filename,
          letter_tone: data.letter_tone ?? f.letter_tone,
          letter_sample: data.letter_sample ?? f.letter_sample,
        }));
      });
  }, [uid, user, supabase]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const canNext = useMemo(() => {
    if (step === 2) return form.target_roles.length > 0;
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

      try {
        const profile = await extractCvProfile(file);
        const hasData = !!(profile.full_name || profile.email || profile.phone || profile.location);
        if (hasData) {
          setForm((f) => {
            const email = profile.email || f.email;
            return {
              ...f,
              full_name: resolveFullName(profile.full_name, email),
              email,
              phone: profile.phone || f.phone,
              location: profile.location || f.location,
              cv_url: "local",
              cv_filename: file.name,
              cv_path: "",
            };
          });
        }
      } catch {
        /* extraction optionnelle */
      }
    } catch (e) {
      alert("Enregistrement échoué : " + (e as Error).message);
    } finally {
      setUploading(false);
      setParsingCv(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const email = form.email || user?.email || "";
      const fullName =
        form.full_name ||
        (user?.user_metadata?.full_name as string | undefined) ||
        "";

      if (alreadyPaid && uid) {
        // Utilisateur déjà abonné : sauvegarder directement en base et aller au dashboard
        await supabase.from("profiles").update({
          full_name: fullName || undefined,
          email: email || undefined,
          phone: form.phone || undefined,
          location: form.location || undefined,
          target_roles: form.target_roles.length ? form.target_roles : undefined,
          target_locations: form.target_locations.length ? form.target_locations : undefined,
          contract_type: form.contract_type.length ? form.contract_type : undefined,
          remote_pref: form.remote_pref.length ? form.remote_pref : undefined,
          salary_min: form.salary_min ? Number(form.salary_min) : undefined,
          letter_tone: form.letter_tone || undefined,
          letter_sample: form.letter_sample || undefined,
          onboarding_done: true,
          updated_at: new Date().toISOString(),
        }).eq("id", uid);
        router.push("/dashboard");
        return;
      }

      saveDraft({
        ...form,
        plan_id: planId,
        email,
        full_name: fullName,
      });
      router.push(`/subscribe${planQuery(planId)}`);
    } catch (e) {
      alert("Erreur : " + (e as Error).message);
      setSaving(false);
    }
  }

  const next = () => (step < STEPS.length - 1 ? setStep((s) => s + 1) : finish());
  const back = () => setStep((s) => Math.max(0, s - 1));
  const busy = saving || uploading || parsingCv;

  return (
    <div className="ob">
      <div className="bg-decor" aria-hidden="true" />
      <div className="ob__shell">
        <header className="ob__top">
          <span className="ob__brand">JEAN&nbsp;PAUL</span>
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
              subtitle="On commence par le cadre : contrat et mode de travail."
            >
              <Field label="Type de contrat">
                <MultiChoice
                  options={CONTRACTS}
                  value={form.contract_type}
                  onChange={(v) => set({ contract_type: v })}
                />
                <p className="ob__hint ob__hint--inline">Plusieurs choix possibles</p>
              </Field>
              <Field label="Présentiel">
                <MultiChoice
                  options={REMOTE}
                  value={form.remote_pref}
                  onChange={(v) => set({ remote_pref: v })}
                />
                <p className="ob__hint ob__hint--inline">Plusieurs choix possibles</p>
              </Field>
            </Section>
          )}

          {step === 1 && (
            <Section
              kicker="Votre recherche"
              title="Où souhaitez-vous travailler ?"
              subtitle="Ville, région ou remote. Plusieurs choix possibles."
            >
              <Field label="Lieux">
                <TagInput
                  value={form.target_locations}
                  onChange={(v) => set({ target_locations: v })}
                  suggestions={LOCATION_SUGGESTIONS}
                  placeholder="Paris, Remote, Lyon…"
                />
              </Field>
            </Section>
          )}

          {step === 2 && (
            <Section
              kicker="Votre recherche"
              title="Que recherchez-vous ?"
              subtitle="Les postes qui vous intéressent. Métier rare ou hybride accepté."
            >
              <Field label="Postes visés">
                <TagInput
                  value={form.target_roles}
                  onChange={(v) => set({ target_roles: v })}
                  groups={ROLE_GROUPS}
                  placeholder="Ex. Growth Marketing, Product Manager…"
                  hint="Entrée pour valider."
                />
              </Field>
            </Section>
          )}

          {step === 3 && (
            <Section
              kicker="Votre recherche"
              title="Salaire minimum ?"
              subtitle="Optionnel. Utile pour filtrer les offres en dessous de vos attentes."
            >
              <Field label="Salaire minimum souhaité (k€/an)">
                <input
                  className="ob__input"
                  type="number"
                  placeholder="45"
                  value={form.salary_min}
                  onChange={(e) => set({ salary_min: e.target.value })}
                />
              </Field>
              <p className="ob__hint">Laissez vide si vous n&apos;avez pas de seuil.</p>
            </Section>
          )}

          {step === 4 && (
            <Section
              kicker="Votre CV"
              title="Déposez votre CV"
              subtitle="PDF uniquement. JEAN PAUL en extrait vos coordonnées pour la suite."
            >
              <CvDropzone
                cvUrl={form.cv_url}
                cvFilename={form.cv_filename}
                uploading={uploading || parsingCv}
                onFile={handleFile}
              />
              <p className="ob__hint">
                {parsingCv
                  ? "Analyse du CV en cours…"
                  : "Optionnel pour l'instant, mais recommandé pour personnaliser vos candidatures."}
              </p>
            </Section>
          )}

          {step === 5 && (
            <Section
              kicker="Vos lettres"
              title="Ton de vos lettres de motivation"
              subtitle="JEAN PAUL adapte le style à chaque offre. Vous gardez le contrôle."
            >
              <Field label="Ton">
                <LetterTonePicker
                  value={form.letter_tone}
                  onChange={(v) => set({ letter_tone: v })}
                />
              </Field>
              <Field label="Lettre type (optionnel)">
                <textarea
                  className="ob__textarea"
                  rows={6}
                  placeholder="Collez une lettre déjà écrite. JEAN PAUL s'en inspire pour le style."
                  value={form.letter_sample}
                  onChange={(e) => set({ letter_sample: e.target.value })}
                />
              </Field>
            </Section>
          )}

          <div className="ob__actions">
            {step > 0 ? (
              <button className="btn btn--outline" onClick={back} disabled={busy}>
                Retour
              </button>
            ) : (
              <span />
            )}
            <button className="btn btn--coral" onClick={next} disabled={!canNext || busy}>
              {saving
                ? "Redirection…"
                : step === STEPS.length - 1
                  ? alreadyPaid
                    ? "Accéder au dashboard"
                    : "Aller au paiement"
                  : step === 3 && !form.salary_min
                    ? "Passer"
                    : step === 4 && !form.cv_filename
                      ? "Passer"
                      : "Continuer"}
            </button>
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
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ob__section">
      <span className="ob__kicker">{kicker}</span>
      <h1 className="ob__title">{title}</h1>
      <p className="ob__subtitle">{subtitle}</p>
      <div className="ob__fields">{children}</div>
    </div>
  );
}
