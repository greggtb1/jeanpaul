"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LETTER_TONES } from "@/lib/supabase";
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
  "Profil",
  "Récap",
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
  const [profileFromCv, setProfileFromCv] = useState(false);

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
    if (step === 6) {
      return form.full_name.trim().length > 1 && /\S+@\S+\.\S+/.test(form.email);
    }
    return true;
  }, [step, form]);

  useEffect(() => {
    if (step !== 6) return;
    const email = form.email.trim();
    if (!/\S+@\S+\.\S+/.test(email)) return;
    setForm((f) => {
      const resolved = resolveFullName(f.full_name, email);
      if (resolved === f.full_name) return f;
      return { ...f, full_name: resolved };
    });
  }, [step, form.email]);

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
          setProfileFromCv(true);
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
      saveDraft({ ...form, plan_id: planId });
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
              subtitle="On commence par le cadre — contrat et mode de travail."
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
              subtitle="Ville, région ou remote — plusieurs choix possibles."
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
              subtitle="Les postes qui vous intéressent — métier rare ou hybride accepté."
            >
              <Field label="Postes visés">
                <TagInput
                  value={form.target_roles}
                  onChange={(v) => set({ target_roles: v })}
                  groups={ROLE_GROUPS}
                  freeform
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
              subtitle="Optionnel — utile pour filtrer les offres en dessous de vos attentes."
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

          {step === 6 && (
            <Section
              kicker="Vos coordonnées"
              title="Vérifiez vos informations"
              subtitle={
                profileFromCv
                  ? "Extraites de votre CV — modifiez si besoin."
                  : "Nécessaires pour le paiement et vos candidatures."
              }
            >
              <Field label="Nom complet">
                <input
                  className="ob__input"
                  placeholder="Grégoire Linée"
                  value={form.full_name}
                  autoFocus
                  onChange={(e) => set({ full_name: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <input
                  className="ob__input"
                  type="email"
                  placeholder="vous@email.com"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
              <div className="ob__row">
                <Field label="Téléphone">
                  <input
                    className="ob__input"
                    placeholder="06 12 34 56 78"
                    value={form.phone}
                    onChange={(e) => set({ phone: e.target.value })}
                  />
                </Field>
                <Field label="Ville">
                  <input
                    className="ob__input"
                    placeholder="Paris"
                    value={form.location}
                    onChange={(e) => set({ location: e.target.value })}
                  />
                </Field>
              </div>
            </Section>
          )}

          {step === 7 && (
            <Section
              kicker="Récapitulatif"
              title={`Tout est bon${form.full_name ? `, ${form.full_name.split(" ")[0]}` : ""} !`}
              subtitle="Vérifiez avant de passer au paiement."
            >
              <ul className="ob__recap">
                <li>
                  <span>Contrat</span>
                  <strong>{form.contract_type.join(", ") || "Non précisé"}</strong>
                </li>
                <li>
                  <span>Présentiel</span>
                  <strong>{form.remote_pref.join(", ") || "Non précisé"}</strong>
                </li>
                <li>
                  <span>Lieux</span>
                  <strong>{form.target_locations.join(", ") || "Non précisé"}</strong>
                </li>
                <li>
                  <span>Postes</span>
                  <strong>{form.target_roles.join(", ") || "…"}</strong>
                </li>
                <li>
                  <span>Salaire min.</span>
                  <strong>{form.salary_min ? `${form.salary_min} k€` : "Non précisé"}</strong>
                </li>
                <li>
                  <span>CV</span>
                  <strong>{form.cv_filename || "Non fourni"}</strong>
                </li>
                <li>
                  <span>Ton des lettres</span>
                  <strong>
                    {LETTER_TONES.find((t) => t.id === form.letter_tone)?.label ?? "…"}
                  </strong>
                </li>
                <li>
                  <span>Email</span>
                  <strong>{form.email || "…"}</strong>
                </li>
                <li>
                  <span>Téléphone</span>
                  <strong>{form.phone || "Non renseigné"}</strong>
                </li>
              </ul>
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
                  ? "Continuer vers le paiement"
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
