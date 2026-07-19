"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  ROLE_GROUPS,
  ROLE_DOMAINS,
  LOCATION_SUGGESTIONS,
  LOCATION_RADIUS_OPTIONS,
  SECTOR_SUGGESTIONS,
  CONTRACTS,
  REMOTE,
  EMPTY_PREFERENCES,
  asStringArray,
  type PreferencesForm,
} from "@/lib/profile-preferences";
import {
  PrefField,
  LetterTonePicker,
  MultiChoice,
  TagInput,
  CvDropzone,
  LetterSampleOptional,
} from "@/components/ProfilePreferencesFields";
import { extractLetterText } from "@/lib/extract-letter";
import { saveDraft } from "@/lib/onboarding-draft";

const AUTOSAVE_DELAY_MS = 600;

function serializeForm(form: PreferencesForm) {
  return JSON.stringify(form);
}

function PrefCard({
  title,
  lead,
  children,
  className,
  index = 0,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
  className?: string;
  index?: number;
}) {
  return (
    <section
      className={["pref-card", className].filter(Boolean).join(" ")}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <header className="pref-card__head">
        <h2 className="pref-card__title">{title}</h2>
        {lead ? <p className="pref-card__lead">{lead}</p> : null}
      </header>
      <div className="pref-card__body">{children}</div>
    </section>
  );
}

export default function SearchPreferencesForm() {
  const { uid, loading: authLoading } = useAuth();
  const supabase = createClient();
  const [form, setForm] = useState<PreferencesForm>(EMPTY_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [letterUploading, setLetterUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const readyRef = useRef(false);
  const lastSavedRef = useRef(serializeForm(EMPTY_PREFERENCES));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);

  formRef.current = form;

  const persistForm = useCallback(
    async (data: PreferencesForm) => {
      if (!uid) return;
      setSaving(true);
      setSaved(false);
      setSaveError(null);
      try {
        const { error } = await supabase.from("profiles").upsert({
          id: uid,
          target_roles: data.target_roles,
          target_sectors: data.target_sectors,
          target_locations: data.target_locations,
          location_search_mode: data.location_search_mode,
          location_radius_km:
            data.location_search_mode === "city"
              ? null
              : parseInt(data.location_radius_km || "25", 10),
          contract_type: data.contract_type,
          remote_pref: data.remote_pref,
          salary_min: data.salary_min ? parseInt(data.salary_min, 10) : null,
          cv_url: data.cv_url || null,
          cv_filename: data.cv_filename || null,
          letter_tone: data.letter_tone || "pro",
          letter_sample: data.letter_sample.trim() || null,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        lastSavedRef.current = serializeForm(data);
        // Aligne le brouillon onboarding pour que le 1er scan trial
        // n'écrase pas les critères avec l'ancien localStorage.
        saveDraft({
          target_roles: data.target_roles,
          target_locations: data.target_locations,
          location_search_mode: data.location_search_mode,
          location_radius_km: data.location_radius_km,
          contract_type: data.contract_type,
          remote_pref: data.remote_pref,
          salary_min: data.salary_min,
          cv_url: data.cv_url,
          cv_filename: data.cv_filename,
          letter_tone: data.letter_tone,
          letter_sample: data.letter_sample,
        });
        setSaved(true);
        window.dispatchEvent(new CustomEvent("ja:prefs-updated"));
      } catch (err) {
        setSaveError((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [uid, supabase],
  );

  const scheduleSave = useCallback(
    (data: PreferencesForm) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistForm(data);
      }, AUTOSAVE_DELAY_MS);
    },
    [persistForm],
  );

  useEffect(() => {
    if (!uid) return;
    const client = createClient();
    let cancelled = false;
    client
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const next: PreferencesForm = {
            target_roles: data.target_roles ?? [],
            target_sectors: data.target_sectors ?? [],
            target_locations: data.target_locations ?? [],
            location_search_mode: data.location_search_mode ?? "city",
            location_radius_km:
              data.location_radius_km != null ? String(data.location_radius_km) : "",
            contract_type: asStringArray(data.contract_type),
            remote_pref: asStringArray(data.remote_pref),
            salary_min: data.salary_min ? String(data.salary_min) : "",
            cv_url: data.cv_url ?? "",
            cv_filename: data.cv_filename ?? "",
            letter_tone: data.letter_tone ?? "pro",
            letter_sample: data.letter_sample ?? "",
          };
          setForm(next);
          lastSavedRef.current = serializeForm(next);
        }
        readyRef.current = true;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    if (!uid || loading || !readyRef.current) return;
    const snapshot = serializeForm(form);
    if (snapshot === lastSavedRef.current) return;
    scheduleSave(form);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [form, uid, loading, scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (!uid || !readyRef.current) return;
      const snapshot = serializeForm(formRef.current);
      if (snapshot === lastSavedRef.current) return;
      void persistForm(formRef.current);
    };
  }, [uid, persistForm]);

  const set = (patch: Partial<PreferencesForm>) => {
    setSaved(false);
    setSaveError(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function handleFile(file: File) {
    if (!file || !uid) return;
    if (file.type !== "application/pdf") {
      alert("Merci d'uploader un CV au format PDF.");
      return;
    }
    setUploading(true);
    setSaved(false);
    setSaveError(null);
    try {
      const path = `${uid}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error } = await supabase.storage.from("cvs").upload(path, file, {
        upsert: true,
        contentType: "application/pdf",
      });
      if (error) throw error;
      const { data: signedData, error: signedError } = await supabase.storage
        .from("cvs")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedError || !signedData?.signedUrl) throw signedError ?? new Error("URL indisponible");
      set({ cv_url: signedData.signedUrl, cv_filename: file.name });
    } catch (e) {
      alert("Upload échoué : " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleLetterFile(file: File) {
    setLetterUploading(true);
    setSaved(false);
    setSaveError(null);
    try {
      const text = await extractLetterText(file);
      set({ letter_sample: text });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLetterUploading(false);
    }
  }

  if (authLoading || loading) {
    return <p className="db-muted">Chargement…</p>;
  }

  const hasCity =
    form.target_locations.some((l) => !/remote|t[ée]l[ée]travail|distanciel/i.test(l));

  const saveStatus = (() => {
    if (uploading || letterUploading) return { kind: "muted" as const, text: "Upload…" };
    if (saving) return { kind: "muted" as const, text: "Enregistrement…" };
    if (saveError) return { kind: "error" as const, text: "Erreur" };
    if (saved) return { kind: "ok" as const, text: "Enregistré" };
    return { kind: "muted" as const, text: "Autosave" };
  })();

  return (
    <form className="pref-page" onSubmit={(e) => e.preventDefault()}>
      <div className="pref-page__toolbar" aria-live="polite">
        <div className="pref-page__toolbar-copy">
          <p className="pref-page__eyebrow">Profil de recherche</p>
          <p className="pref-page__toolbar-hint">
            Modifications enregistrées automatiquement.
          </p>
        </div>
        <span
          className={`pref-save-pill pref-save-pill--${saveStatus.kind}${saving ? " is-pulse" : ""}`}
          title={saveError ?? undefined}
        >
          {saveStatus.kind === "ok" ? "✓ Enregistré" : saveStatus.text}
        </span>
      </div>

      <div className="pref-bento">
        <PrefCard title="Cible" className="pref-card--cible" index={0}>
          <div className="pref-split">
            <PrefField label="Postes">
              <TagInput
                value={form.target_roles}
                onChange={(v) => set({ target_roles: v })}
                groups={ROLE_GROUPS}
                domains={ROLE_DOMAINS}
                freeform
                hideFreeformHint
                autocomplete
                placeholder="Ex. Growth Marketing, Product Manager…"
              />
            </PrefField>
            <PrefField label="Secteurs">
              <TagInput
                value={form.target_sectors}
                onChange={(v) => set({ target_sectors: v })}
                suggestions={SECTOR_SUGGESTIONS}
                freeform
                compact
                placeholder="Culture, médias, tech…"
              />
            </PrefField>
          </div>
        </PrefCard>

        <PrefCard title="Lieux" className="pref-card--places" index={1}>
          <TagInput
            value={form.target_locations}
            onChange={(v) => set({ target_locations: v })}
            suggestions={LOCATION_SUGGESTIONS}
            compact
            placeholder="Paris, Remote, Lyon…"
          />
          {hasCity && (
            <div className="ob__location-radius ob__location-radius--compact">
              <span className="ob__location-radius-label">Rayon</span>
              <div
                className="ob__location-radius-options"
                role="group"
                aria-label="Rayon de recherche"
              >
                {LOCATION_RADIUS_OPTIONS.map((option) => {
                  const active =
                    option.value === "city"
                      ? form.location_search_mode === "city"
                      : form.location_search_mode === "radius" &&
                        form.location_radius_km === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`ob__location-radius-chip${active ? " is-active" : ""}`}
                      onClick={() =>
                        option.value === "city"
                          ? set({ location_search_mode: "city", location_radius_km: "" })
                          : set({
                              location_search_mode: "radius",
                              location_radius_km: option.value,
                            })
                      }
                      aria-pressed={active}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </PrefCard>

        <PrefCard title="Conditions" className="pref-card--conditions" index={2}>
          <div className="pref-stack">
            <PrefField label="Contrat">
              <MultiChoice
                options={CONTRACTS}
                value={form.contract_type}
                onChange={(v) => set({ contract_type: v })}
              />
            </PrefField>
            <PrefField label="Présentiel">
              <MultiChoice
                options={REMOTE}
                value={form.remote_pref}
                onChange={(v) => set({ remote_pref: v })}
              />
            </PrefField>
            <PrefField label="Salaire min." hint="k€ / an · optionnel">
              <input
                className="ob__input pref-salary-input"
                type="number"
                inputMode="numeric"
                placeholder="40"
                value={form.salary_min}
                onChange={(e) => set({ salary_min: e.target.value })}
              />
            </PrefField>
          </div>
        </PrefCard>

        <PrefCard title="Candidature" className="pref-card--docs" index={3}>
          <div className="pref-split pref-split--docs">
            <PrefField label="CV" className="pref-docs-cv">
              <CvDropzone
                cvUrl={form.cv_url}
                cvFilename={form.cv_filename}
                uploading={uploading}
                onFile={handleFile}
                compact
              />
            </PrefField>
            <PrefField label="Ton de lettre" className="pref-docs-tones">
              <LetterTonePicker
                grid
                value={form.letter_tone}
                onChange={(v) => set({ letter_tone: v })}
              />
            </PrefField>
            <div className="pref-docs-optional">
              <LetterSampleOptional
                value={form.letter_sample}
                onChange={(v) => set({ letter_sample: v })}
                uploading={letterUploading}
                onUpload={handleLetterFile}
              />
            </div>
          </div>
        </PrefCard>
      </div>
    </form>
  );
}
