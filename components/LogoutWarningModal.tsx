"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function LogoutWarningModal({ open, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="logout-warn__overlay" role="presentation" onClick={onCancel}>
      <div
        className="logout-warn"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-warn-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="logout-warn__icon" aria-hidden="true">
          ⚠
        </span>
        <h2 id="logout-warn-title" className="logout-warn__title">
          Vous êtes en mode découverte
        </h2>
        <p className="logout-warn__text">
          Votre compte est temporaire. Si vous vous déconnectez maintenant, vous
          perdrez <strong>définitivement</strong> vos offres, vos CV et vos lettres
          générés : ils ne pourront pas être récupérés.
        </p>
        <div className="logout-warn__actions">
          <button
            type="button"
            className="btn btn--coral logout-warn__stay"
            onClick={onCancel}
          >
            Rester connecté
          </button>
          <button
            type="button"
            className="logout-warn__leave"
            onClick={onConfirm}
          >
            Se déconnecter et tout perdre
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
