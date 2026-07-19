"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/supabase";
import { downloadLetterPdf } from "@/lib/letter-pdf";
import { isPlausiblePersonName, splitPersonName } from "@/lib/file-name";

function hasSignableName(name: string | null | undefined): boolean {
  return isPlausiblePersonName(name);
}

/** Met une majuscule en début de chaque mot (gère les tirets : Jean-Pierre). */
function capitalizeName(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'-])([\p{L}])/gu, (_, sep, char) => sep + char.toLocaleUpperCase("fr-FR"));
}

const REFINE_PLACEHOLDERS = [
  "Rends la lettre plus directe et plus courte",
  "Ajoute un ton plus humain et naturel",
  "Insiste davantage sur mon expérience",
  "Parle plus de l'entreprise et de ses enjeux",
  "Rends l'accroche plus percutante",
];

type Props = {
  company: string;
  title: string;
  letterUrl: string;
  profile: Profile | null;
  /** Déclenché quand l'essai gratuit de retouche est épuisé (mode découverte). */
  onLockedRefine?: () => void;
  onNameSaved?: (fullName: string) => void;
  onClose: () => void;
};

export default function LetterModal({
  company,
  title,
  letterUrl,
  profile,
  onLockedRefine,
  onNameSaved,
  onClose,
}: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [refinePlaceholder, setRefinePlaceholder] = useState(REFINE_PLACEHOLDERS[0]);
  const [refining, setRefining] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [animating, setAnimating] = useState(false);
  const [namePromptOpen, setNamePromptOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savedName, setSavedName] = useState("");
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (animationRef.current) window.clearTimeout(animationRef.current);
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(letterUrl)
      .then((r) => {
        if (!r.ok) throw new Error("Impossible de charger la lettre");
        return r.text();
      })
      .then((t) => {
        if (!cancelled) {
          const next = t.trim();
          setText(next);
          setDisplayText(next);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "Erreur de chargement");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [letterUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (namePromptOpen) {
          setNamePromptOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, namePromptOpen]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    let phraseIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer: number | undefined;

    const tick = () => {
      if (cancelled) return;
      const phrase = REFINE_PLACEHOLDERS[phraseIndex];
      const next = phrase.slice(0, charIndex);
      setRefinePlaceholder(next || phrase.slice(0, 1));

      if (!deleting && charIndex < phrase.length) {
        charIndex += 1;
        timer = window.setTimeout(tick, 42);
        return;
      }

      if (!deleting) {
        deleting = true;
        timer = window.setTimeout(tick, 1400);
        return;
      }

      if (charIndex > 1) {
        charIndex -= 1;
        timer = window.setTimeout(tick, 22);
        return;
      }

      deleting = false;
      phraseIndex = (phraseIndex + 1) % REFINE_PLACEHOLDERS.length;
      charIndex = 1;
      timer = window.setTimeout(tick, 260);
    };

    timer = window.setTimeout(tick, 300);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [mounted]);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Copie impossible. Sélectionnez le texte manuellement.");
    }
  };

  const resolveSenderName = () => (savedName || profile?.full_name || "").trim();

  const runDownload = async (senderName: string) => {
    setPdfBusy(true);
    setError("");
    try {
      await downloadLetterPdf(text, company, title, {
        name: senderName,
        email: profile?.email,
        phone: profile?.phone,
        location: profile?.location || profile?.target_locations?.[0] || "Paris",
      });
    } catch (e) {
      setError((e as Error).message || "PDF impossible");
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!text) return;
    if (!hasSignableName(resolveSenderName())) {
      // Ne pas pré-remplir avec un nom non plausible (ex. un intitulé de poste
      // capturé par erreur depuis le CV) : on repart d'un champ vide.
      const parts = splitPersonName(profile?.full_name);
      setFirstName(parts.firstName);
      setLastName(parts.lastName);
      setNamePromptOpen(true);
      return;
    }
    await runDownload(resolveSenderName());
  };

  const confirmNameAndDownload = async () => {
    const first = capitalizeName(firstName.trim());
    const last = capitalizeName(lastName.trim());
    if (!first || !last) {
      setError("Indiquez votre prénom et votre nom pour signer la lettre.");
      return;
    }
    setFirstName(first);
    setLastName(last);
    const fullName = `${first} ${last}`;
    setError("");
    if (profile?.id) {
      const { error: updateError } = await createClient()
        .from("profiles")
        .update({ full_name: fullName })
        .eq("id", profile.id);
      if (updateError) {
        setError("Impossible d'enregistrer votre nom. Réessayez.");
        return;
      }
    }
    setSavedName(fullName);
    onNameSaved?.(fullName);
    setNamePromptOpen(false);
    await runDownload(fullName);
  };

  const refineLetter = async (nextInstruction = instruction) => {
    const prompt = nextInstruction.trim();
    if (!text || prompt.length < 3) {
      setError("Ajoutez une consigne courte, exemple : fais plus humain.");
      return;
    }
    setRefining(true);
    setAnimating(false);
    setError("");
    try {
      const res = await fetch("/api/letter-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ letter: text, instruction: prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data.trialLocked) {
          if (onLockedRefine) {
            onLockedRefine();
          } else {
            setError(
              data.error ||
                "Retouches gratuites épuisées. Choisissez une formule pour continuer."
            );
          }
          return;
        }
        throw new Error(data.error || "Modification impossible");
      }
      const refined = (data.text || "").trim();
      setText(refined);
      setInstruction("");
      animateRewrite(refined);
    } catch (e) {
      setError((e as Error).message || "Modification impossible");
    } finally {
      setRefining(false);
    }
  };

  const animateRewrite = (next: string) => {
    if (animationRef.current) window.clearTimeout(animationRef.current);
    setDisplayText("");
    setAnimating(true);
    let i = 0;
    const chunk = Math.max(5, Math.ceil(next.length / 180));
    const tick = () => {
      i = Math.min(next.length, i + chunk);
      setDisplayText(next.slice(0, i));
      if (i < next.length) {
        animationRef.current = window.setTimeout(tick, 16);
      } else {
        animationRef.current = window.setTimeout(() => setAnimating(false), 450);
      }
    };
    tick();
  };

  if (!mounted) return null;

  return createPortal(
    <div className="letter-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="letter-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="letter-modal-title"
        aria-modal="true"
      >
        <header className="letter-modal__head">
          <div>
            <span className="letter-modal__kicker">Lettre de motivation</span>
            <h2 id="letter-modal-title" className="letter-modal__title">
              {company}
            </h2>
            <p className="letter-modal__sub">{title}</p>
          </div>
          <button type="button" className="letter-modal__close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="letter-modal__body">
          {loading && <p className="letter-modal__status">Chargement…</p>}
          {error && !loading && <p className="letter-modal__error">{error}</p>}
          {!loading && text && (
            <div className={`letter-modal__paper${refining ? " letter-modal__paper--busy" : ""}`}>
              <button
                type="button"
                className={`letter-modal__copy${copied ? " letter-modal__copy--done" : ""}`}
                disabled={refining || animating}
                onClick={copy}
                aria-label={copied ? "Texte copié" : "Copier la lettre"}
                title={copied ? "Copié" : "Copier le texte"}
              >
                {copied ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect
                      x="9"
                      y="9"
                      width="11"
                      height="13"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
              {refining && (
                <div className="letter-modal__rewrite" role="status" aria-live="polite">
                  <div className="letter-modal__dots" aria-hidden="true" />
                  <div className="letter-modal__rewrite-badge">
                    <span className="letter-modal__rewrite-dot" aria-hidden="true" />
                    Réécriture de la lettre par l&apos;IA…
                  </div>
                </div>
              )}
              <div className="letter-modal__text">
                {displayText}
                {animating && <span className="letter-modal__cursor" aria-hidden="true" />}
              </div>
            </div>
          )}
        </div>

        {!loading && text && (
          <div className="letter-modal__refine" aria-label="Retoucher la lettre">
            <div className="letter-modal__quick">
              <button
                type="button"
                className="letter-modal__chip"
                disabled={!text || loading || refining || animating}
                onClick={() => refineLetter("Fais plus court et plus direct.")}
              >
                Plus court
              </button>
              <button
                type="button"
                className="letter-modal__chip"
                disabled={!text || loading || refining || animating}
                onClick={() => refineLetter("Rends la lettre plus humaine et naturelle.")}
              >
                Plus humain
              </button>
              <button
                type="button"
                className="letter-modal__chip"
                disabled={!text || loading || refining || animating}
                onClick={() => refineLetter("Parle davantage de l'entreprise et de ce qui rend cette offre intéressante.")}
              >
                Plus entreprise
              </button>
              <button
                type="button"
                className="letter-modal__chip"
                disabled={!text || loading || refining || animating}
                onClick={() => refineLetter("Parle davantage de mon profil, de mes compétences et de ce que j'apporte.")}
              >
                Plus moi
              </button>
            </div>
            <div className="letter-modal__refine-row">
              <input
                id="letter-refine"
                className="letter-modal__input"
                value={instruction}
                maxLength={200}
                disabled={!text || loading || refining || animating}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") refineLetter();
                }}
                placeholder={refinePlaceholder}
                aria-label="Consigne de retouche de la lettre"
              />
              <button
                type="button"
                className={`letter-modal__send${refining || animating ? " letter-modal__send--busy" : ""}`}
                disabled={
                  !text ||
                  loading ||
                  refining ||
                  animating ||
                  instruction.trim().length < 3
                }
                onClick={() => refineLetter()}
                aria-label={refining || animating ? "Modification en cours" : "Modifier la lettre"}
              >
                {refining || animating ? (
                  <span className="letter-modal__send-spinner" aria-hidden="true" />
                ) : (
                  <svg
                    className="letter-modal__send-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 19V5M12 5l-6 6M12 5l6 6"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
            {refining || animating ? (
              <p className="letter-modal__refine-loading" aria-live="polite">
                <span className="letter-modal__refine-loading-dot" aria-hidden="true" />
                {refining ? "Retouche en cours…" : "Écriture…"}
              </p>
            ) : null}
          </div>
        )}

        <footer className="letter-modal__foot">
          <button
            type="button"
            className="btn btn--navy btn--sm"
            disabled={!text || loading || pdfBusy}
            onClick={downloadPdf}
          >
            {pdfBusy ? "PDF…" : "Télécharger PDF"}
          </button>
        </footer>

        {namePromptOpen && (
          <div
            className="letter-modal__name-pop-overlay"
            role="presentation"
            onClick={() => !pdfBusy && setNamePromptOpen(false)}
          >
            <div
              className="letter-modal__name-pop"
              role="dialog"
              aria-modal="true"
              aria-label="Signature de la lettre"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="letter-modal__name-prompt-title">Signez votre lettre</p>
              <p className="letter-modal__name-prompt-text">
                Prénom et nom pour la signature du PDF.
              </p>
              <div className="letter-modal__name-row">
                <input
                  type="text"
                  className="letter-modal__input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Prénom"
                  autoFocus
                  aria-label="Prénom"
                />
                <input
                  type="text"
                  className="letter-modal__input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Nom"
                  aria-label="Nom"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmNameAndDownload();
                  }}
                />
              </div>
              <div className="letter-modal__name-actions">
                <button
                  type="button"
                  className="letter-modal__name-cancel"
                  onClick={() => setNamePromptOpen(false)}
                  disabled={pdfBusy}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn--navy btn--sm"
                  disabled={pdfBusy}
                  onClick={confirmNameAndDownload}
                >
                  {pdfBusy ? "PDF…" : "Télécharger le PDF"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
