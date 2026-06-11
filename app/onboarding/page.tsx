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
  LOCATION_SUGGESTIONS,
  CONTRACTS,
  REMOTE,
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
  const parsedCvKey = useRef("");
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
  }, [uid, supabase]);

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
    if (step === 2) return form.target_roles.length > 0;
    if (step === 4) return !!form.full_name.trim() && !!form.email.trim();
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
        await applyCvIdentityFromFile(file);
      } catch {
        /* extraction optionnelle */
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
      alert("Enregistrement échoué : " + (e as Error).message);
    } finally {
      setUploading(false);
      setParsingCv(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const email = form.email.trim();
      const fullName = form.full_name.trim();
      if (!fullName || !email) {
        alert("Merci de renseigner votre nom et votre email.");
        setSaving(false);
        return;
      }

      if (alreadyPaid && uid) {
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
            contract_type: form.contract_type,
            remote_pref: form.remote_pref,
            salary_min: form.salary_min ? Number(form.salary_min) : undefined,
            letter_tone: form.letter_tone || undefined,
            letter_sample: form.letter_sample || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Sauvegarde échouée");
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
              subtitle="PDF uniquement. On pré-remplit ce qu'on trouve — complétez le reste vous-même."
            >
              <CvDropzone
                cvUrl={form.cv_url}
                cvFilename={form.cv_filename}
                uploading={uploading || parsingCv}
                onFile={handleFile}
              />
              <Field label="Nom complet">
                <input
                  className="ob__input"
                  type="text"
                  placeholder="Prénom Nom"
                  value={form.full_name}
                  onChange={(e) => set({ full_name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  className="ob__input"
                  type="email"
                  placeholder="vous@exemple.com"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  required
                />
              </Field>
              <Field label="Téléphone">
                <input
                  className="ob__input"
                  type="tel"
                  placeholder="06 12 34 56 78"
                  value={form.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              </Field>
              <Field label="Ville">
                <input
                  className="ob__input"
                  type="text"
                  placeholder="Paris"
                  value={form.location}
                  onChange={(e) => set({ location: e.target.value })}
                />
              </Field>
              <p className="ob__hint">
                {parsingCv
                  ? "Analyse du CV en cours…"
                  : "Le CV est optionnel, mais nom et email sont requis pour postuler."}
              </p>
            </Section>
          )}

          {step === 5 && (
            <Section
              kicker="Vos lettres"
              title="Quel ton pour vos lettres ?"
              subtitle="Choisissez un style, c'est tout ce qu'il faut pour commencer. JEAN PAUL l'adapte à chaque offre."
            >
              <Field label="Ton">
                <LetterTonePicker
                  value={form.letter_tone}
                  onChange={(v) => set({ letter_tone: v })}
                />
              </Field>
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
                {saving
                  ? "Un instant…"
                  : step === STEPS.length - 1
                    ? alreadyPaid
                      ? "Accéder au dashboard"
                      : "Continuer"
                    : step === 3 && !form.salary_min
                      ? "Passer"
                      : step === 4 && !form.cv_filename
                      ? "Continuer sans CV"
                      : "Continuer"}
              </button>
            </div>
            {step === STEPS.length - 1 && !alreadyPaid && !busy && (
              <p className="ob__actions-hint">Paiement sécurisé à l&apos;étape suivante.</p>
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
