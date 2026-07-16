"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadCvPdf, buildCvPdfBlob } from "@/lib/cv-pdf";
import { nameFileSuffix } from "@/lib/file-name";

type Props = {
  company: string;
  title: string;
  cvUrl: string;
  fullName?: string | null;
  /** Déclenché quand l'essai gratuit de modification est épuisé (mode découverte). */
  onLockedRefine?: () => void;
  onClose: () => void;
};

const QUICK_ACTIONS = [
  { label: "Plus percutant", instruction: "Rends les formulations plus percutantes et orientées résultats." },
  { label: "Plus concis", instruction: "Raccourcis et va à l'essentiel, sans perdre d'information clé." },
  { label: "Ton plus pro", instruction: "Adopte un ton plus professionnel et sobre." },
];

const REFINE_PLACEHOLDERS = [
  "Mets en avant mes compétences data",
  "Insiste davantage sur mes résultats chiffrés",
  "Adapte le CV à cette offre en particulier",
  "Rends les expériences plus concises",
  "Ajoute mes soft skills les plus pertinents",
];

export default function CvModal({ company, title, cvUrl, fullName, onLockedRefine, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [signedUrl, setSignedUrl] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [cvText, setCvText] = useState("");

  const [instruction, setInstruction] = useState("");
  const [refinePlaceholder, setRefinePlaceholder] = useState(REFINE_PLACEHOLDERS[0]);
  const [refining, setRefining] = useState(false);
  const [refinedText, setRefinedText] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [refinedPreview, setRefinedPreview] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");

  const previewUrlRef = useRef("");
  const nameSuffix = useMemo(() => nameFileSuffix(fullName), [fullName]);
  const hasRefined = !!refinedText;

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Aperçu du CV de base
  useEffect(() => {
    let cancelled = false;
    setLoadingUrl(true);
    setLoadingPreview(true);
    setError("");
    setSignedUrl("");

    fetch(`/api/storage/signed-url?url=${encodeURIComponent(cvUrl)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.url) throw new Error(data.error || "Impossible d'ouvrir le CV");
        if (!cancelled) {
          setSignedUrl(data.url);
          setLoadingPreview(true);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "Erreur de chargement");
      })
      .finally(() => {
        if (!cancelled) setLoadingUrl(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cvUrl]);

  useEffect(() => {
    if (!signedUrl || !loadingPreview) return;
    const t = window.setTimeout(() => setLoadingPreview(false), 2500);
    return () => window.clearTimeout(t);
  }, [signedUrl, loadingPreview]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const ensureCvText = async (): Promise<string> => {
    if (cvText) return cvText;
    const res = await fetch("/api/cv-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cvUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.text) throw new Error(data.error || "Texte du CV indisponible");
    setCvText(data.text);
    return data.text as string;
  };

  const runRefine = async (nextInstruction = instruction) => {
    const prompt = nextInstruction.trim();
    if (prompt.length < 3) {
      setError("Ajoutez une consigne courte, exemple : plus percutant.");
      return;
    }
    setRefining(true);
    setError("");
    try {
      const baseText = await ensureCvText();
      const res = await fetch("/api/cv-refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cv: baseText, instruction: prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data.trialLocked) {
          if (onLockedRefine) onLockedRefine();
          else setError(data.error || "Modifications gratuites épuisées.");
          return;
        }
        throw new Error(data.error || "Modification impossible");
      }
      const next = (data.text || "").trim();
      if (!next) throw new Error("Réponse vide");
      setCvText(next);
      setRefinedText(next);
      setChanges(Array.isArray(data.changes) ? data.changes : []);
      setInstruction("");
      setSaved(false);
      await refreshRefinedPreview(next);
    } catch (e) {
      setError((e as Error).message || "Modification impossible");
    } finally {
      setRefining(false);
    }
  };

  const refreshRefinedPreview = async (text: string) => {
    try {
      const blob = await buildCvPdfBlob(text);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setRefinedPreview(url);
    } catch {
      /* aperçu régénéré optionnel */
    }
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setError("");
    try {
      if (hasRefined) {
        await downloadCvPdf(refinedText, `CV_${company || "modifie"}${nameSuffix}.pdf`);
      } else if (signedUrl) {
        const anchor = document.createElement("a");
        anchor.href = signedUrl;
        anchor.download = `CV_${company || "adapte"}${nameSuffix}.pdf`;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
      }
    } catch (e) {
      setError((e as Error).message || "Téléchargement impossible");
    } finally {
      setPdfBusy(false);
    }
  };

  const saveEditedCv = async () => {
    if (!refinedText) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const blob = await buildCvPdfBlob(refinedText);
      const form = new FormData();
      form.append("file", new File([blob], "cv.pdf", { type: "application/pdf" }));
      form.append("url", cvUrl);
      const res = await fetch("/api/storage/save-cv", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Enregistrement impossible");
      setSaved(true);
    } catch (e) {
      setError((e as Error).message || "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  const previewSrc = hasRefined && refinedPreview ? refinedPreview : signedUrl;
  const showPreviewSpinner = !hasRefined && (loadingUrl || (signedUrl && loadingPreview));

  return createPortal(
    <div className="cv-modal__overlay" onClick={onClose} role="presentation">
      <div
        className="cv-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="cv-modal-title"
        aria-modal="true"
      >
        <header className="letter-modal__head">
          <div>
            <span className="letter-modal__kicker">CV adapté à</span>
            <h2 id="cv-modal-title" className="letter-modal__title">
              {company}
            </h2>
            <p className="letter-modal__sub">{title}</p>
          </div>
          <button type="button" className="letter-modal__close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className="cv-modal__body">
          <section className="cv-modal__preview" aria-label="Aperçu du CV">
            <div className="cv-modal__ats-note">
              <strong>{hasRefined ? "CV mis à jour" : "CV personnalisé pour cette offre"}</strong>
              <span>
                {hasRefined
                  ? "Le contenu a été retouché. Enregistrez pour mettre à jour votre CV, ou téléchargez-le."
                  : "Mots-clés, intitulés et expériences sont ajustés pour passer les filtres recruteurs et ATS."}
              </span>
            </div>

            {hasRefined && changes.length > 0 && (
              <div className="cv-modal__changes" role="status">
                <span className="cv-modal__changes-badge">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Modifié
                </span>
                <ul className="cv-modal__changes-list">
                  {changes.map((c, i) => (
                    <li key={i} className="cv-modal__change-pill">{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className={`cv-modal__preview-frame${refining ? " cv-modal__preview-frame--busy" : ""}`}>
              {showPreviewSpinner && (
                <div className="cv-modal__preview-loading" role="status" aria-live="polite">
                  <span className="cv-modal__spinner" aria-hidden="true" />
                  <span>Chargement de l&apos;aperçu…</span>
                </div>
              )}
              {refining && (
                <div className="cv-modal__rewrite" role="status" aria-live="polite">
                  <div className="cv-modal__dots" aria-hidden="true" />
                  <div className="cv-modal__rewrite-badge">
                    <span className="cv-modal__rewrite-dot" aria-hidden="true" />
                    Réécriture du CV par l&apos;IA…
                  </div>
                </div>
              )}
              {previewSrc && (
                <object
                  key={previewSrc}
                  className={`cv-modal__object${hasRefined ? " cv-modal__object--fade" : ""}`}
                  data={`${previewSrc}#toolbar=0&navpanes=0&view=FitH&zoom=page-width`}
                  type="application/pdf"
                  aria-label={`Aperçu du CV ${company}`}
                  onLoad={() => setLoadingPreview(false)}
                >
                  <p className="cv-modal__fallback">
                    Aperçu indisponible. Téléchargez le CV avec le bouton en bas.
                  </p>
                </object>
              )}
            </div>
          </section>
        </div>

        <div className="cv-modal__refine" aria-label="Retoucher le CV avec l'IA">
          <div className="cv-modal__refine-quick">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                className="cv-modal__chip"
                disabled={refining}
                onClick={() => runRefine(a.instruction)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="cv-modal__refine-row">
            <input
              className="cv-modal__refine-input"
              value={instruction}
              maxLength={200}
              disabled={refining}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runRefine();
              }}
              placeholder={refinePlaceholder}
              aria-label="Consigne de modification du CV"
            />
            <button
              type="button"
              className={`cv-modal__send${refining ? " cv-modal__send--busy" : ""}`}
              disabled={refining || instruction.trim().length < 3}
              onClick={() => runRefine()}
            >
              {refining ? <span className="cv-modal__send-spinner" aria-hidden="true" /> : "Modifier"}
            </button>
          </div>
          {refining && (
            <p className="cv-modal__refine-loading" aria-live="polite">
              <span className="cv-modal__refine-loading-dot" aria-hidden="true" />
              Modification en cours…
            </p>
          )}
          {error && <p className="letter-modal__error">{error}</p>}
        </div>

        <footer className="letter-modal__foot cv-modal__foot">
          {hasRefined && (
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={saving || pdfBusy}
              onClick={saveEditedCv}
            >
              {saving ? "Enregistrement…" : saved ? "Enregistré ✓" : "Sauvegarder"}
            </button>
          )}
          <button
            type="button"
            className="btn btn--navy btn--sm"
            disabled={pdfBusy || saving || (!signedUrl && !hasRefined)}
            onClick={downloadPdf}
          >
            {pdfBusy ? "PDF…" : hasRefined ? "Télécharger CV modifié" : "Télécharger le CV"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
