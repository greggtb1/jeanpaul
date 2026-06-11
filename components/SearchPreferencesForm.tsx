"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  ROLE_GROUPS,
  LOCATION_SUGGESTIONS,
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
  LetterSampleInput,
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
          target_locations: data.target_locations,
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
    supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const next: PreferencesForm = {
            target_roles: data.target_roles ?? [],
            target_locations: data.target_locations ?? [],
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
  }, [uid, supabase]);

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
      const { data } = supabase.storage.from("cvs").getPublicUrl(path);
      set({ cv_url: data.publicUrl, cv_filename: file.name });
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

  return (
    <form className="pref-page" onSubmit={(e) => e.preventDefault()}>
      <section className="db-panel db-panel--cv">
        <h2 className="db-panel__title">Votre CV</h2>
        <p className="db-muted">PDF pour adapter chaque candidature.</p>
        <CvDropzone
          cvUrl={form.cv_url}
          cvFilename={form.cv_filename}
          uploading={uploading}
          onFile={handleFile}
          compact
        />
      </section>

      <section className="db-panel db-panel--criteria">
        <h2 className="db-panel__title">Critères de recherche</h2>
        <div className="ob__fields pref-criteria-grid">
          <PrefField label="Postes visés" className="pref-criteria-grid__full">
            <TagInput
              value={form.target_roles}
              onChange={(v) => set({ target_roles: v })}
              groups={ROLE_GROUPS}
              freeform
              compact
              placeholder="Ex. Growth Marketing, Customer Success…"
            />
          </PrefField>
          <PrefField label="Lieux">
            <TagInput
              value={form.target_locations}
              onChange={(v) => set({ target_locations: v })}
              suggestions={LOCATION_SUGGESTIONS}
              compact
              placeholder="Paris, Remote…"
            />
          </PrefField>
          <PrefField label="Type de contrat">
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
          <PrefField label="Salaire minimum souhaité (k€/an, optionnel)">
            <input
              className="ob__input"
              type="number"
              placeholder="45"
              value={form.salary_min}
              onChange={(e) => set({ salary_min: e.target.value })}
            />
          </PrefField>
        </div>
      </section>

      <section className="db-panel">
        <h2 className="db-panel__title">Lettres de motivation</h2>
        <div className="ob__fields">
          <PrefField label="Ton">
            <LetterTonePicker value={form.letter_tone} onChange={(v) => set({ letter_tone: v })} />
          </PrefField>
          <PrefField label="Votre lettre type (optionnel)">
            <LetterSampleInput
              value={form.letter_sample}
              onChange={(v) => set({ letter_sample: v })}
              uploading={letterUploading}
              onUpload={handleLetterFile}
            />
          </PrefField>
        </div>
      </section>

      <div className="db-panel__actions pref-page__actions pref-page__autosave" aria-live="polite">
        {uploading || letterUploading ? (
          <span className="db-muted">Upload en cours…</span>
        ) : saving ? (
          <span className="db-muted">Enregistrement…</span>
        ) : saveError ? (
          <span className="pref-page__autosave-error">Erreur : {saveError}</span>
        ) : saved ? (
          <span className="db-saved">✓ Enregistré</span>
        ) : (
          <span className="db-muted">Modifications enregistrées automatiquement</span>
        )}
      </div>
    </form>
  );
}
