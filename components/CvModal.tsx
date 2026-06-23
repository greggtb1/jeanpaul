"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { downloadCvPdf } from "@/lib/cv-pdf";

type Props = {
  company: string;
  title: string;
  cvUrl: string;
  onClose: () => void;
};

export default function CvModal({ company, title, cvUrl, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [signedUrl, setSignedUrl] = useState("");
  const [text, setText] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadingText, setLoadingText] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    setLoadingUrl(true);
    setLoadingPreview(true);
    setLoadingText(false);
    setEditing(false);
    setError("");
    setSignedUrl("");
    setText("");

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
    const t = window.setTimeout(() => setLoadingPreview(false), 5000);
    return () => window.clearTimeout(t);
  }, [signedUrl, loadingPreview]);

  const startEdit = async () => {
    if (text) {
      setEditing(true);
      return;
    }
    setLoadingText(true);
    setError("");
    try {
      const res = await fetch("/api/cv-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cvUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.text) throw new Error(data.error || "Texte du CV indisponible");
      setText(data.text);
      setEditing(true);
    } catch (e) {
      setError((e as Error).message || "Texte du CV indisponible");
    } finally {
      setLoadingText(false);
    }
  };

  const downloadEditedPdf = async () => {
    if (!text) return;
    setPdfBusy(true);
    setError("");
    try {
      await downloadCvPdf(text, `CV_${company || "modifie"}.pdf`);
    } catch (e) {
      setError((e as Error).message || "PDF impossible");
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadOriginal = () => {
    if (!signedUrl) return;
    const anchor = document.createElement("a");
    anchor.href = signedUrl;
    anchor.download = `CV_${company || "adapte"}.pdf`;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  };

  if (!mounted) return null;

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
            <span className="letter-modal__kicker">CV adapté</span>
            <h2 id="cv-modal-title" className="letter-modal__title">
              {company}
            </h2>
            <p className="letter-modal__sub">{title}</p>
          </div>
          <button type="button" className="letter-modal__close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </header>

        <div className={`cv-modal__body${editing ? " cv-modal__body--editor" : ""}`}>
          {!editing ? (
            <section className="cv-modal__preview" aria-label="Aperçu du CV">
              <div className="cv-modal__preview-frame">
                {(loadingUrl || (signedUrl && loadingPreview)) && (
                  <div className="cv-modal__preview-loading" role="status" aria-live="polite">
                    <span className="cv-modal__spinner" aria-hidden="true" />
                    <span>Chargement de l&apos;aperçu…</span>
                  </div>
                )}
                {signedUrl && (
                  <object
                    className="cv-modal__object"
                    data={`${signedUrl}#toolbar=0&navpanes=0`}
                    type="application/pdf"
                    aria-label={`Aperçu du CV ${company}`}
                    onLoad={() => setLoadingPreview(false)}
                  >
                    <p className="cv-modal__fallback">
                      Aperçu indisponible. Téléchargez le CV avec le bouton en bas.
                    </p>
                  </object>
                )}
                <button
                  type="button"
                  className="cv-modal__edit-btn"
                  disabled={loadingText}
                  onClick={startEdit}
                >
                  {loadingText ? "Préparation…" : "Modifier"}
                </button>
                {error && <p className="letter-modal__error">{error}</p>}
              </div>
            </section>
          ) : (
          <section className="cv-modal__editor" aria-label="Modification manuelle du CV">
            <div className="cv-modal__editor-head">
              <h3>Modifier le texte</h3>
              <p>Ajustements rapides avant téléchargement. Le PDF source reste intact.</p>
            </div>
            {error && <p className="letter-modal__error">{error}</p>}
            {loadingText ? (
              <p className="letter-modal__status">Extraction du texte…</p>
            ) : (
              <textarea
                className="cv-modal__textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Texte du CV"
              />
            )}
          </section>
          )}
        </div>

        <footer className="letter-modal__foot cv-modal__foot">
          {editing ? (
          <button
            type="button"
            className="btn btn--navy btn--sm"
            disabled={!text || loadingText || pdfBusy}
            onClick={downloadEditedPdf}
          >
            {pdfBusy ? "PDF…" : "Télécharger CV modifié"}
          </button>
          ) : (
            <button
              type="button"
              className="btn btn--navy btn--sm"
              disabled={!signedUrl}
              onClick={downloadOriginal}
            >
              Télécharger le CV
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
