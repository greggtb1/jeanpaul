"use client";

import { useEffect, useState } from "react";
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
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(letterUrl)
      .then((r) => {
        if (!r.ok) throw new Error("Impossible de charger la lettre");
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t.trim());
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
      setError("Copie impossible — sélectionnez le texte manuellement");
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
          {!loading && !error && (
            <div className="letter-modal__text">{text}</div>
          )}
        </div>

        <footer className="letter-modal__foot">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={!text || loading}
            onClick={copy}
          >
            {copied ? "Copié ✓" : "Copier"}
          </button>
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
