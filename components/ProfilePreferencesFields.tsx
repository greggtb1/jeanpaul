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
  badge,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  badge?: string;
  hint?: string;
}) {
  return (
    <div className={["ob__field", className].filter(Boolean).join(" ")}>
      <span className="ob__label">
        {label}
        {badge ? <span className="ob__label-badge">{badge}</span> : null}
      </span>
      {hint ? <p className="ob__field-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

export function LetterTonePicker({
  value,
  onChange,
  grid,
}: {
  value: string;
  onChange: (id: string) => void;
  grid?: boolean;
}) {
  return (
    <div className={`ob__tone-list${grid ? " ob__tone-list--grid" : ""}`}>
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

const TYPEWRITER_TYPE_MS = 26;
const TYPEWRITER_DELETE_MS = 14;
const TYPEWRITER_HOLD_MS = 800;
const TYPEWRITER_GAP_MS = 150;

function useTypewriterPlaceholder(words: string[] | undefined, paused: boolean) {
  const [wordIndex, setWordIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!words || words.length === 0 || paused) return;
    const word = words[wordIndex % words.length];

    let delay: number;
    if (!deleting && charCount < word.length) delay = TYPEWRITER_TYPE_MS;
    else if (!deleting && charCount === word.length) delay = TYPEWRITER_HOLD_MS;
    else if (deleting && charCount > 0) delay = TYPEWRITER_DELETE_MS;
    else delay = TYPEWRITER_GAP_MS;

    const t = setTimeout(() => {
      if (!deleting) {
        if (charCount < word.length) setCharCount((c) => c + 1);
        else setDeleting(true);
      } else if (charCount > 0) {
        setCharCount((c) => c - 1);
      } else {
        setDeleting(false);
        setWordIndex((i) => (i + 1) % words.length);
      }
    }, delay);

    return () => clearTimeout(t);
  }, [words, wordIndex, charCount, deleting, paused]);

  if (!words || words.length === 0) return "";
  return words[wordIndex % words.length].slice(0, charCount);
}

export function TagInput({
  value,
  onChange,
  suggestions,
  groups,
  domains,
  placeholder,
  hint,
  freeform,
  hideFreeformHint,
  compact,
  autocomplete,
  typewriterWords,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  groups?: { label: string; items: string[] }[];
  /** Domaines → labels de catégories (dans `groups`). */
  domains?: { label: string; groups: string[] }[];
  placeholder: string;
  hint?: string;
  freeform?: boolean;
  hideFreeformHint?: boolean;
  compact?: boolean;
  autocomplete?: boolean;
  typewriterWords?: string[];
}) {
  const [draft, setDraft] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const isMobile = useIsMobile();
  void isMobile;
  const typewriterPaused = value.length > 0 || draft.length > 0;
  const typewriterText = useTypewriterPlaceholder(typewriterWords, typewriterPaused);
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };

  const flatSuggestions = suggestions ?? groups?.flatMap((g) => g.items) ?? [];
  const normalizedDraft = draft.trim().toLowerCase();
  const showAutocomplete = Boolean(autocomplete && normalizedDraft.length >= 2);

  /** Autocomplete groupé : catégorie → postes (max 3 catégories × 3 items). */
  const autocompleteGroups = (() => {
    if (!showAutocomplete) return [] as { label: string; items: string[] }[];
    if (groups?.length) {
      return groups
        .map((g) => ({
          label: g.label,
          items: g.items
            .filter((s) => !value.includes(s))
            .filter((s) => s.toLowerCase().includes(normalizedDraft))
            .slice(0, 3),
        }))
        .filter((g) => g.items.length > 0)
        .slice(0, 3);
    }
    const items = flatSuggestions
      .filter((s) => !value.includes(s))
      .filter((s) => s.toLowerCase().includes(normalizedDraft))
      .slice(0, 6);
    return items.length ? [{ label: "Suggestions", items }] : [];
  })();
  const hasAutocompleteMatches = autocompleteGroups.some((g) => g.items.length > 0);

  const groupByLabel = (label: string) => groups?.find((g) => g.label === label);
  const availableDomains = (domains ?? []).filter((d) =>
    d.groups.some((gl) => groupByLabel(gl)?.items.some((s) => !value.includes(s)))
  );
  const domainCats = activeDomain
    ? (domains?.find((d) => d.label === activeDomain)?.groups ?? [])
        .map((gl) => groupByLabel(gl))
        .filter((g): g is { label: string; items: string[] } => !!g)
        .filter((g) => g.items.some((s) => !value.includes(s)))
    : [];
  const activeItems =
    activeGroup && groupByLabel(activeGroup)
      ? groupByLabel(activeGroup)!.items.filter((s) => !value.includes(s))
      : [];
  const resetDrawerNav = () => {
    setActiveDomain(null);
    setActiveGroup(null);
  };

  return (
    <div className={`ob__tags ${compact ? "ob__tags--compact" : ""}`}>
      {freeform && !compact && !hideFreeformHint && (
        <p className="ob__tags-freeform">
          <span className="ob__tags-freeform-icon" aria-hidden="true">✎</span>
          Saisie libre : tapez ce que vous voulez, même si ce n&apos;est pas dans la liste
        </p>
      )}
      <div className="ob__tags-field">
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
            placeholder={
              value.length
                ? "Ajouter un autre…"
                : typewriterWords?.length
                  ? typewriterText
                  : placeholder
            }
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
        {showAutocomplete && (
          <div className="ob__autocomplete" role="listbox" aria-label="Suggestions de postes">
            <div className="ob__autocomplete-head">
              <span>Suggestions</span>
              <small>Entrée garde votre saisie</small>
            </div>
            {hasAutocompleteMatches ? (
              <div className="ob__autocomplete-body">
                {autocompleteGroups.map((g) => (
                  <div key={g.label} className="ob__autocomplete-group">
                    <p className="ob__autocomplete-cat">{g.label}</p>
                    <div className="ob__autocomplete-list">
                      {g.items.map((s) => (
                        <button
                          type="button"
                          key={s}
                          className="ob__autocomplete-item"
                          onClick={() => add(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ob__autocomplete-empty">
                Appuyez sur Entrée pour ajouter &quot;{draft.trim()}&quot;.
              </p>
            )}
          </div>
        )}
      </div>
      {hint && !compact && <p className="ob__hint ob__hint--inline">{hint}</p>}

      {groups && !compact && (
        <div className={`ob__drawer${showAutocomplete ? " ob__drawer--dimmed" : ""}`}>
          <button
            type="button"
            className="ob__drawer-toggle"
            onClick={() => {
              setSuggestOpen((o) => !o);
              resetDrawerNav();
            }}
          >
            <span>{suggestOpen ? "Masquer les suggestions" : "Voir des suggestions"}</span>
            <span className="ob__drawer-chevron" aria-hidden="true">{suggestOpen ? "▲" : "▼"}</span>
          </button>

          {suggestOpen && (
            <div className="ob__drawer-body">
              {domains?.length ? (
                <>
                  <div className="ob__stair-nav" aria-label="Navigation suggestions">
                    <button
                      type="button"
                      className={`ob__stair-crumb${!activeDomain ? " is-current" : ""}`}
                      onClick={resetDrawerNav}
                    >
                      Domaines
                    </button>
                    {activeDomain && (
                      <>
                        <span className="ob__stair-sep" aria-hidden="true">›</span>
                        <button
                          type="button"
                          className={`ob__stair-crumb${!activeGroup ? " is-current" : ""}`}
                          onClick={() => setActiveGroup(null)}
                        >
                          {activeDomain}
                        </button>
                      </>
                    )}
                    {activeGroup && (
                      <>
                        <span className="ob__stair-sep" aria-hidden="true">›</span>
                        <span className="ob__stair-crumb is-current">{activeGroup}</span>
                      </>
                    )}
                  </div>

                  {!activeDomain && (
                    <div className="ob__stair-domains">
                      {availableDomains.map((d) => (
                        <button
                          type="button"
                          key={d.label}
                          className="ob__stair-domain"
                          onClick={() => {
                            setActiveDomain(d.label);
                            setActiveGroup(null);
                          }}
                        >
                          <span className="ob__stair-domain-label">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {activeDomain && !activeGroup && (
                    <div className="ob__stair-cats">
                      {domainCats.map((g) => (
                        <button
                          type="button"
                          key={g.label}
                          className="ob__stair-cat"
                          onClick={() => setActiveGroup(g.label)}
                        >
                          <span>{g.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {activeDomain && activeGroup && (
                    <div className="ob__suggest ob__suggest--drawer">
                      {activeItems.map((s) => (
                        <button
                          type="button"
                          key={s}
                          className="ob__suggest-chip"
                          onClick={() => add(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="ob__drawer-cats">
                    {groups
                      .filter((g) => g.items.some((s) => !value.includes(s)))
                      .map((g) => (
                        <button
                          type="button"
                          key={g.label}
                          className={`ob__drawer-cat${activeGroup === g.label ? " is-active" : ""}`}
                          onClick={() => setActiveGroup(activeGroup === g.label ? null : g.label)}
                        >
                          {g.label}
                        </button>
                      ))}
                  </div>
                  {activeGroup && activeItems.length > 0 && (
                    <div className="ob__suggest ob__suggest--drawer">
                      {activeItems.map((s) => (
                        <button
                          type="button"
                          key={s}
                          className="ob__suggest-chip"
                          onClick={() => add(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!groups && !showAutocomplete && (
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
          {hasContent ? (
            "Lettre enregistrée"
          ) : (
            <>
              <span className="ob__optional-fold__spark" aria-hidden="true" />
              Pour être encore plus précis
            </>
          )}
        </span>
      </summary>
      <div className="ob__optional-fold__body">
        <p className="ob__optional-fold__lead">
          Collez une lettre qui vous plaît : on s&apos;en inspire pour reproduire votre style.
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
            placeholder="Collez une lettre déjà écrite."
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
            <img
              className="ob__drop-pdf"
              src="/images/pdf-icon.png?v=3"
              alt=""
              aria-hidden="true"
            />
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
