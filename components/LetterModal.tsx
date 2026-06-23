"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Profile } from "@/lib/supabase";
import { downloadLetterPdf } from "@/lib/letter-pdf";

type Props = {
  company: string;
  title: string;
  letterUrl: string;
  profile: Profile | null;
  onClose: () => void;
};

export default function LetterModal({ company, title, letterUrl, profile, onClose }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [animating, setAnimating] = useState(false);
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const downloadPdf = async () => {
    if (!text) return;
    setPdfBusy(true);
    setError("");
    try {
      await downloadLetterPdf(text, company, title, {
        name: profile?.full_name || "Candidat",
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
      if (!res.ok) throw new Error(data.error || "Modification impossible");
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
            <div className={`letter-modal__paper${refining || animating ? " letter-modal__paper--active" : ""}`}>
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
              <div className="letter-modal__text">
                {displayText}
                {animating && <span className="letter-modal__cursor" aria-hidden="true" />}
              </div>
              {(refining || animating) && (
                <p className="letter-modal__rewrite-status" aria-live="polite">
                  {refining ? "Retouche en cours…" : "Réécriture de la lettre…"}
                </p>
              )}
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
                placeholder="Retoucher avec une phrase..."
                aria-label="Consigne de retouche de la lettre"
              />
              <button
                type="button"
                className="letter-modal__send"
                disabled={!text || loading || refining || animating || instruction.trim().length < 3}
                onClick={() => refineLetter()}
              >
                {refining ? "…" : "OK"}
              </button>
            </div>
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
      </div>
    </div>,
    document.body
  );
}
