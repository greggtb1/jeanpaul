"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { isPlausiblePersonName, splitPersonName } from "@/lib/file-name";

type Props = {
  open: boolean;
  userId: string;
  /** Nom profil actuel (prérempli seulement s'il est plausible). */
  currentName?: string | null;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (fullName: string) => void;
};

function capitalizeName(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'-])([\p{L}])/gu, (_, sep, char) => sep + char.toLocaleUpperCase("fr-FR"));
}

/**
 * Confirmation prénom / nom avant scan (réutilise le pattern signature lettres).
 */
export default function ConfirmNameModal({
  open,
  userId,
  currentName,
  saving = false,
  onClose,
  onConfirm,
}: Props) {
  const split = splitPersonName(currentName);
  const [firstName, setFirstName] = useState(split.firstName);
  const [lastName, setLastName] = useState(split.lastName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = splitPersonName(currentName);
    setFirstName(next.firstName);
    setLastName(next.lastName);
    setError("");
  }, [open, currentName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, busy, saving, onClose]);

  async function handleConfirm() {
    const first = capitalizeName(firstName.trim());
    const last = capitalizeName(lastName.trim());
    if (!first || !last) {
      setError("Indiquez votre prénom et votre nom.");
      return;
    }
    const fullName = `${first} ${last}`;
    if (!isPlausiblePersonName(fullName)) {
      setError("Ce nom ne semble pas valide. Vérifiez prénom et nom.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await createClient()
        .from("profiles")
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (updateError) throw updateError;
      onConfirm(fullName);
    } catch {
      setError("Impossible d'enregistrer. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  const disabled = busy || saving;

  return createPortal(
    <div
      className="letter-modal__name-pop-overlay"
      role="presentation"
      onClick={() => !disabled && onClose()}
    >
      <div
        className="letter-modal__name-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-name-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-name-title" className="letter-modal__name-prompt-title">
          Votre nom sur les documents
        </p>
        <p className="letter-modal__name-prompt-text">
          Prénom et nom pour vos CV et lettres. Vérifiez avant de lancer la
          recherche.
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
            disabled={disabled}
          />
          <input
            type="text"
            className="letter-modal__input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Nom"
            aria-label="Nom"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirm();
            }}
          />
        </div>
        {error && <p className="letter-modal__error">{error}</p>}
        <div className="letter-modal__name-actions">
          <button
            type="button"
            className="letter-modal__name-cancel"
            onClick={onClose}
            disabled={disabled}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn--navy btn--sm"
            disabled={disabled}
            onClick={() => void handleConfirm()}
          >
            {disabled ? "Enregistrement…" : "Confirmer et continuer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
