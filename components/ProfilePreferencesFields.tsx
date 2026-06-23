"use client";

import { useEffect, useRef, useState } from "react";

const MOBILE_SUGGEST_MAX = 720;
const MOBILE_GROUP_LIMIT = 2;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_SUGGEST_MAX}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
import { LETTER_TONES } from "@/lib/supabase";
import { LETTER_FILE_ACCEPT } from "@/lib/extract-letter";

export function PrefField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={["ob__field", className].filter(Boolean).join(" ")}>
      <span className="ob__label">{label}</span>
      {children}
    </div>
  );
}

export function LetterTonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="ob__tone-list">
      {LETTER_TONES.map((tone) => {
        const active = value === tone.id;
        return (
          <button
            type="button"
            key={tone.id}
            className={`ob__tone-card ${active ? "is-active" : ""}`}
            onClick={() => onChange(tone.id)}
            aria-pressed={active}
          >
            <div className="ob__tone-card-head">
              <span className="ob__tone-label">{tone.label}</span>
              {active && (
                <span className="ob__tone-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </div>
            <p className="ob__tone-sample">{tone.tagline}</p>
          </button>
        );
      })}
    </div>
  );
}

export function MultiChoice({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (o: string) => {
    if (value.includes(o)) onChange(value.filter((x) => x !== o));
    else onChange([...value, o]);
  };
  return (
    <div className="ob__choice">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          className={`ob__chip ${value.includes(o) ? "is-active" : ""}`}
          onClick={() => toggle(o)}
          aria-pressed={value.includes(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function TagInput({
  value,
  onChange,
  suggestions,
  groups,
  placeholder,
  hint,
  freeform,
  compact,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  groups?: { label: string; items: string[] }[];
  placeholder: string;
  hint?: string;
  freeform?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [suggestExpanded, setSuggestExpanded] = useState(false);
  const isMobile = useIsMobile();
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };

  const flatSuggestions = suggestions ?? groups?.flatMap((g) => g.items) ?? [];

  return (
    <div className={`ob__tags ${compact ? "ob__tags--compact" : ""}`}>
      {freeform && !compact && (
        <p className="ob__tags-freeform">
          <span className="ob__tags-freeform-icon" aria-hidden="true">✎</span>
          Saisie libre : tapez ce que vous voulez, même si ce n&apos;est pas dans la liste
        </p>
      )}
      <div className={`ob__tags-box ${freeform && !compact ? "ob__tags-box--freeform" : ""}`}>
        {value.map((t) => (
          <span className="ob__tag" key={t}>
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="ob__tags-input"
          value={draft}
          placeholder={value.length ? "Ajouter un autre…" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
        {freeform && !value.length && !draft && (
          <span className="ob__tags-enter" aria-hidden="true">Entrée ↵</span>
        )}
      </div>
      {hint && !compact && <p className="ob__hint ob__hint--inline">{hint}</p>}

      {groups ? (
        (() => {
          const availableGroups = groups
            .map((group) => ({
              ...group,
              items: group.items.filter((s) => !value.includes(s)),
            }))
            .filter((group) => group.items.length > 0);

          const collapseOnMobile = isMobile && !compact && !suggestExpanded;
          const visibleGroups = collapseOnMobile
            ? availableGroups.slice(0, MOBILE_GROUP_LIMIT)
            : availableGroups;
          const hiddenGroupCount = collapseOnMobile
            ? Math.max(0, availableGroups.length - MOBILE_GROUP_LIMIT)
            : 0;

          return (
            <div className={`ob__suggest-groups ${compact ? "ob__suggest-groups--compact" : ""}`}>
              {!compact && <p className="ob__suggest-lead">Ou cliquez sur une suggestion :</p>}
              {visibleGroups.map((group) => (
                <div className="ob__suggest-group" key={group.label}>
                  <span className="ob__suggest-group-label">{group.label}</span>
                  <div className="ob__suggest">
                    {group.items.map((s) => (
                      <button type="button" key={s} className="ob__suggest-chip" onClick={() => add(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {hiddenGroupCount > 0 && (
                <button
                  type="button"
                  className="ob__suggest-more"
                  onClick={() => setSuggestExpanded(true)}
                >
                  Voir plus de suggestions ({hiddenGroupCount} catégorie
                  {hiddenGroupCount > 1 ? "s" : ""})
                </button>
              )}
            </div>
          );
        })()
      ) : (
        <div className="ob__suggest">
          {flatSuggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <button type="button" key={s} className="ob__suggest-chip" onClick={() => add(s)}>
                {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function LetterSampleOptional({
  value,
  onChange,
  uploading,
  onUpload,
}: {
  value: string;
  onChange: (v: string) => void;
  uploading?: boolean;
  onUpload?: (file: File) => void | Promise<void>;
}) {
  const hasContent = !!value.trim();
  const [open, setOpen] = useState(hasContent);
  const hadContent = useRef(hasContent);

  useEffect(() => {
    if (hasContent && !hadContent.current) setOpen(true);
    hadContent.current = hasContent;
  }, [hasContent]);

  return (
    <details
      className="ob__optional-fold"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="ob__optional-fold__summary">
        <span className="ob__optional-fold__title">
          Affiner le style avec une lettre existante
          <span className="ob__optional-fold__badge">Optionnel</span>
        </span>
        <span className="ob__optional-fold__hint">
          {hasContent ? "Lettre enregistrée" : "Pas obligatoire, le ton choisi suffit"}
        </span>
      </summary>
      <div className="ob__optional-fold__body">
        <p className="ob__optional-fold__lead">
          Vous n&apos;avez rien à coller ici pour continuer. Si vous avez déjà une lettre dont vous
          êtes satisfait·e, BLOW MY JOB s&apos;en inspire pour reproduire votre façon d&apos;écrire.
        </p>
        {onUpload ? (
          <LetterSampleInput
            value={value}
            onChange={onChange}
            uploading={uploading}
            onUpload={onUpload}
          />
        ) : (
          <textarea
            className="ob__textarea ob__letter-sample__area"
            rows={5}
            placeholder="Collez une lettre déjà écrite, ou laissez vide."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </details>
  );
}

export function LetterSampleInput({
  value,
  onChange,
  uploading,
  onUpload,
}: {
  value: string;
  onChange: (v: string) => void;
  uploading?: boolean;
  onUpload: (file: File) => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="ob__letter-sample">
      <textarea
        className="ob__textarea ob__letter-sample__area"
        rows={4}
        placeholder="Collez une lettre ou importez un PDF / Word. BLOW MY JOB s'en inspire pour le style."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="ob__letter-sample-bar">
        <button
          type="button"
          className="ob__letter-sample-upload"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Import…" : "Importer un fichier"}
        </button>
        <span className="ob__letter-sample-hint">PDF · Word · .txt</span>
        <input
          ref={fileRef}
          type="file"
          accept={LETTER_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export function CvDropzone({
  cvUrl,
  cvFilename,
  uploading,
  onFile,
  compact,
}: {
  cvUrl: string;
  cvFilename: string;
  uploading: boolean;
  onFile: (file: File) => void;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hasCv = !!(cvUrl || cvFilename);
  const canView = !!cvUrl && cvUrl !== "local" && cvUrl.startsWith("http");

  const openPicker = () => fileRef.current?.click();

  return (
    <div
      className={[
        "ob__drop",
        hasCv ? "is-done" : "",
        uploading ? "is-uploading" : "",
        compact ? "ob__drop--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={hasCv ? undefined : openPicker}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {uploading ? (
        <p className="ob__drop-title">Upload en cours…</p>
      ) : hasCv ? (
        <div className="ob__drop-filled">
          <div className="ob__drop-file">
            <span className="ob__drop-pdf" aria-hidden="true">
              PDF
            </span>
            <div className="ob__drop-file-meta">
              <p className="ob__drop-title">{cvFilename || "CV.pdf"}</p>
              {!compact && (
                <p className="ob__drop-sub">
                  {canView ? "CV actuellement enregistré" : "CV enregistré à la création du compte"}
                </p>
              )}
            </div>
            <span className="ob__drop-ok" aria-hidden="true">
              ✓
            </span>
          </div>
          <div className="ob__drop-actions">
            <button type="button" className="ob__drop-replace" onClick={openPicker}>
              ↻ Remplacer
            </button>
            {canView && (
              <a
                className="ob__drop-view"
                href={cvUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {compact ? "Voir" : "Voir le PDF"}
              </a>
            )}
          </div>
          {!compact && (
            <p className="ob__drop-hint">ou glissez un nouveau PDF ici pour le remplacer</p>
          )}
        </div>
      ) : (
        <>
          <div className="ob__drop-icon">{compact ? "📄" : "⬆"}</div>
          <p className="ob__drop-title">{compact ? "Déposer un PDF" : "Glissez votre CV ici"}</p>
          {!compact && <p className="ob__drop-sub">ou cliquez pour choisir un fichier</p>}
        </>
      )}
    </div>
  );
}
