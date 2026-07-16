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

const AUTOSAVE_DELAY_MS = 600;

function serializeForm(form: PreferencesForm) {
  return JSON.stringify(form);
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

  return (
    <form className="pref-page" onSubmit={(e) => e.preventDefault()}>
      <section className="pref-block">
        <header className="pref-block__head">
          <h2 className="pref-block__title">Postes</h2>
        </header>

        <PrefField label="Postes visés">
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

        <div className="pref-sector">
          <div className="pref-sector__top">
            <span className="pref-sector__badge">Nouveau</span>
            <span className="pref-sector__title">Secteurs visés</span>
          </div>
          <p className="pref-sector__lead">
            Pas demandé à l&apos;onboarding. Utile pour écarter les offres hors sujet
            (banque, admin, etc.).
          </p>
          <TagInput
            value={form.target_sectors}
            onChange={(v) => set({ target_sectors: v })}
            suggestions={SECTOR_SUGGESTIONS}
            freeform
            compact
            placeholder="Ex. Culture, médias, tech…"
          />
        </div>
      </section>

      <section className="pref-block">
        <header className="pref-block__head">
          <h2 className="pref-block__title">Conditions</h2>
        </header>

        <div className="pref-grid">
          <PrefField label="Lieux" className="pref-grid__span2">
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
          </PrefField>

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

          <PrefField label="Salaire min. (k€/an)" hint="Optionnel">
            <input
              className="ob__input pref-salary-input"
              type="number"
              inputMode="numeric"
              placeholder="Ex. 40"
              value={form.salary_min}
              onChange={(e) => set({ salary_min: e.target.value })}
            />
          </PrefField>
        </div>
      </section>

      <div className="pref-split">
        <section className="pref-block pref-block--cv">
          <header className="pref-block__head">
            <h2 className="pref-block__title">CV</h2>
            <p className="pref-block__lead">PDF pour adapter chaque dossier.</p>
          </header>
          <CvDropzone
            cvUrl={form.cv_url}
            cvFilename={form.cv_filename}
            uploading={uploading}
            onFile={handleFile}
            compact
          />
        </section>

        <section className="pref-block">
          <header className="pref-block__head">
            <h2 className="pref-block__title">Lettres</h2>
          </header>
          <PrefField label="Ton">
            <LetterTonePicker
              grid
              value={form.letter_tone}
              onChange={(v) => set({ letter_tone: v })}
            />
          </PrefField>
          <LetterSampleOptional
            value={form.letter_sample}
            onChange={(v) => set({ letter_sample: v })}
            uploading={letterUploading}
            onUpload={handleLetterFile}
          />
        </section>
      </div>

      <div className="pref-page__actions pref-page__autosave" aria-live="polite">
        {uploading || letterUploading ? (
          <span className="db-muted">Upload en cours…</span>
        ) : saving ? (
          <span className="db-muted">Enregistrement…</span>
        ) : saveError ? (
          <span className="pref-page__autosave-error">Erreur : {saveError}</span>
        ) : saved ? (
          <span className="db-saved">✓ Enregistré</span>
        ) : (
          <span className="db-muted">Enregistrement automatique</span>
        )}
      </div>
    </form>
  );
}
