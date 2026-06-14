"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase";
import { PrefField, CvDropzone } from "@/components/ProfilePreferencesFields";
import { loadDraft } from "@/lib/onboarding-draft";
import { uploadPendingCvForUser, resolveProfileCv } from "@/lib/onboarding-cv";
import {
  SENIORITY_LEVELS,
  calibrationIsValid,
  formatProfileSummary,
  getCalibrationSteps,
  hasCvOnFile,
  needsNoCvScanCalibration,
  profileToCalibrationDefaults,
  type NoCvCalibrationData,
  type SeniorityId,
} from "@/lib/no-cv-calibration";

const ABOUT_YOU_COPY = {
  title: "Et vous, c'est quoi votre profil ?",
  lead: "2–3 phrases sur qui vous êtes pro. On s'en sert pour noter les offres à votre place.",
};

type Props = {
  profile: Profile | null;
  userId: string;
  saving?: boolean;
  onClose: () => void;
  onComplete: (profile: Profile) => void;
};

type ModalPhase = "cv_pitch" | "questions";

export default function NoCvCalibrationModal({
  profile,
  userId,
  saving = false,
  onClose,
  onComplete,
}: Props) {
  const supabase = createClient();
  const draft = useMemo(() => loadDraft(), [profile?.id]);
  const questionSteps = useMemo(() => getCalibrationSteps(profile, draft), [profile, draft]);

  const [phase, setPhase] = useState<ModalPhase>("cv_pitch");
  const [form, setForm] = useState<NoCvCalibrationData>(() =>
    profileToCalibrationDefaults(profile, draft)
  );
  const [cvUrl, setCvUrl] = useState(profile?.cv_url ?? "");
  const [cvFilename, setCvFilename] = useState(profile?.cv_filename ?? "");
  const [uploadingCv, setUploadingCv] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCv =
    !!(cvUrl?.trim() && cvUrl !== "local") || !!cvFilename?.trim();

  useEffect(() => {
    setForm(profileToCalibrationDefaults(profile, draft));
    setCvUrl(profile?.cv_url ?? "");
    setCvFilename(profile?.cv_filename ?? "");
    setPhase("cv_pitch");
  }, [profile?.id, profile?.cv_url, profile?.cv_filename, profile?.summary, draft]);

  useEffect(() => {
    let cancelled = false;
    async function syncPendingCv() {
      if (cvUrl?.trim() && cvUrl !== "local") return;
      try {
        const resolved = await resolveProfileCv(userId, {
          cvUrl,
          cvFilename,
        });
        if (!resolved || cancelled) return;
        const { error: upsertErr } = await supabase
          .from("profiles")
          .update({
            cv_url: resolved.url,
            cv_filename: resolved.filename,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        if (upsertErr) throw upsertErr;
        if (!cancelled) {
          setCvUrl(resolved.url);
          setCvFilename(resolved.filename);
        }
      } catch {
        /* L'utilisateur peut redéposer le fichier si besoin. */
      }
    }
    void syncPendingCv();
    return () => {
      cancelled = true;
    };
  }, [userId, cvUrl, cvFilename]);

  const canSubmitQuestions = phase === "questions" && calibrationIsValid(form);
  const busy = submitting || saving || uploadingCv;

  const set = (patch: Partial<NoCvCalibrationData>) =>
    setForm((f) => ({ ...f, ...patch }));

  async function persistCv(fileUrl: string, filename: string) {
    const { error: upsertErr } = await supabase
      .from("profiles")
      .update({
        cv_url: fileUrl,
        cv_filename: filename,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (upsertErr) throw upsertErr;
  }

  async function handleCvFile(file: File) {
    if (file.type !== "application/pdf") {
      alert("Merci d'uploader un CV au format PDF.");
      return;
    }
    setUploadingCv(true);
    setError(null);
    try {
      const path = `${userId}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: uploadErr } = await supabase.storage.from("cvs").upload(path, file, {
        upsert: true,
        contentType: "application/pdf",
      });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedError } = await supabase.storage
        .from("cvs")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedError || !signedData?.signedUrl) {
        throw signedError ?? new Error("URL indisponible");
      }
      setCvUrl(signedData.signedUrl);
      setCvFilename(file.name);
      await persistCv(signedData.signedUrl, file.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingCv(false);
    }
  }

  async function finishWithCv() {
    if (!hasCv) return;
    setSubmitting(true);
    setError(null);
    try {
      const resolved = await resolveProfileCv(userId, {
        cvUrl,
        cvFilename,
      });
      if (!resolved) {
        throw new Error(
          "Le fichier n'est plus sur cet appareil. Redéposez votre CV ci-dessus pour continuer."
        );
      }
      await persistCv(resolved.url, resolved.filename);
      onComplete({
        ...(profile ?? { id: userId }),
        cv_url: resolved.url,
        cv_filename: resolved.filename,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function finishWithQuestions() {
    if (!calibrationIsValid(form)) return;
    setSubmitting(true);
    setError(null);
    try {
      const summary = formatProfileSummary(form.experience, form.seniority);
      const updatedAt = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase
        .from("profiles")
        .update({ summary, updated_at: updatedAt })
        .eq("id", userId)
        .select("id")
        .maybeSingle();

      if (updateErr) throw updateErr;
      if (!updated) {
        const { error: insertErr } = await supabase.from("profiles").insert({
          id: userId,
          summary,
          updated_at: updatedAt,
        });
        if (insertErr) throw insertErr;
      }

      onComplete({
        ...(profile ?? { id: userId }),
        summary,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function finishWithoutCv() {
    setSubmitting(true);
    setError(null);
    try {
      onComplete(profile ?? { id: userId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSkipWithoutCv() {
    setError(null);
    const freshDraft = loadDraft();
    if (needsNoCvScanCalibration(profile, freshDraft)) {
      setPhase("questions");
      return;
    }
    void finishWithoutCv();
  }

  async function handleLaunchScan() {
    if (phase === "questions") {
      await finishWithQuestions();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase !== "questions" || busy || !canSubmitQuestions) return;
    await finishWithQuestions();
  }

  if (phase === "questions" && !questionSteps.length) return null;

  const skipLabel = needsNoCvScanCalibration(profile, draft)
    ? "Continuer sans CV · parler de moi"
    : "Continuer sans CV · lancer le scan";

  return (
    <div className="dob__overlay" role="dialog" aria-modal="true" aria-labelledby="ncv-title">
      <form className="dob__panel ncv-calib" onSubmit={handleSubmit}>
        <button
          type="button"
          className="dob__close"
          onClick={onClose}
          disabled={busy}
          aria-label="Fermer"
        >
          ✕
        </button>

        {phase === "cv_pitch" ? (
          <>
            <p className="ncv-calib__eyebrow">Avant le scan</p>
            <h2 id="ncv-title" className="dob__title">
              Personnalisez vos dossiers
            </h2>
            <p className="ncv-calib__lead">
              {hasCvOnFile(profile) || hasCv
                ? "Votre CV sera utilisé pour adapter chaque dossier à chaque offre."
                : "Déposez votre CV pour qu'on l'adapte à chaque offre. À la fin du scan, vos dossiers seront prêts avec CV et lettre personnalisés."}
            </p>

            <div className="ncv-calib__fields">
              <CvDropzone
                cvUrl={cvUrl && cvUrl !== "local" ? cvUrl : ""}
                cvFilename={cvFilename}
                uploading={uploadingCv}
                onFile={handleCvFile}
              />
              <ul className="ncv-calib__benefits">
                <li>CV adapté offre par offre</li>
                <li>Lettre de motivation ciblée</li>
                <li>Meilleur scoring avec votre vrai parcours</li>
              </ul>
            </div>

            {error && <p className="ncv-calib__error">{error}</p>}

            <div className="ncv-calib__actions">
              {hasCv && (
                <button
                  type="button"
                  className="dob__btn-next dob__btn-next--done"
                  disabled={busy}
                  onClick={() => void finishWithCv()}
                >
                  {busy ? "Enregistrement…" : "Lancer le scan avec ce CV"}
                </button>
              )}
              <button
                type="button"
                className="ncv-calib__skip"
                disabled={busy}
                onClick={handleSkipWithoutCv}
              >
                {skipLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="ncv-calib__eyebrow">Sans CV · 1 question</p>
            <h2 id="ncv-title" className="dob__title">
              {ABOUT_YOU_COPY.title}
            </h2>
            <p className="ncv-calib__lead">{ABOUT_YOU_COPY.lead}</p>

            <div className="ncv-calib__fields">
              <PrefField label="Votre profil">
                <textarea
                  className="ob__input ob__textarea ncv-calib__textarea"
                  rows={4}
                  maxLength={320}
                  placeholder="Ex : Marketing B2B depuis 6 ans, j'ai monté l'acquisition chez une scale-up SaaS. Je cherche un poste où je peux mixer stratégie et exécution."
                  value={form.experience}
                  onChange={(e) => set({ experience: e.target.value })}
                />
                <p className="ncv-calib__hint">
                  {form.experience.length}/320 · minimum 20 caractères
                </p>
              </PrefField>
              <PrefField label="Niveau (optionnel)">
                <div className="ncv-calib__chips" role="group" aria-label="Niveau d'expérience">
                  {SENIORITY_LEVELS.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      className={`ncv-calib__chip${form.seniority === level.id ? " is-active" : ""}`}
                      onClick={() =>
                        set({
                          seniority: (form.seniority === level.id ? "" : level.id) as SeniorityId | "",
                        })
                      }
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </PrefField>
            </div>

            {error && <p className="ncv-calib__error">{error}</p>}

            <div className="dob__nav">
              <button
                type="button"
                className="dob__btn-back"
                onClick={() => setPhase("cv_pitch")}
                disabled={busy}
              >
                Retour
              </button>
              <button
                type="button"
                className="dob__btn-next dob__btn-next--primary"
                disabled={!canSubmitQuestions || busy}
                onClick={() => void handleLaunchScan()}
              >
                {busy ? "Enregistrement…" : "Lancer le scan"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
