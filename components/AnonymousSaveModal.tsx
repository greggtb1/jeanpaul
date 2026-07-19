"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/umami";

type Props = {
  open: boolean;
  /** Contexte d'ouverture : déconnexion ou tentative de quitter. */
  intent?: "logout" | "leave";
  onClose: () => void;
  /** Appelé si l'utilisateur confirme vouloir partir sans sauvegarder. */
  onDiscard?: () => void;
  /** Appelé après conversion réussie (compte créé, session conservée). */
  onSaved?: () => void;
};

const MIN_PASSWORD = 6;

export default function AnonymousSaveModal({
  open,
  intent = "leave",
  onClose,
  onDiscard,
  onSaved,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setDone(false);
    setLoading(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, loading]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Indiquez une adresse e-mail valide.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
      return;
    }

    setLoading(true);
    setError("");
    trackEvent("anon_save_account_submit", { intent });

    try {
      // Via admin (email_confirm) — pas d'e-mail de confirmation Supabase.
      const res = await fetch("/api/auth/finalize-anon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: trimmed, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Impossible de créer le compte");
      }

      const supabase = createClient();
      await supabase.auth.refreshSession();

      trackEvent("anon_save_account_success", { intent });
      setDone(true);
      onSaved?.();
    } catch (err) {
      trackEvent("anon_save_account_error", { intent });
      const message = (err as Error).message || "Impossible de créer le compte";
      if (/already|registered|exists|déjà/i.test(message)) {
        setError(
          "Cet e-mail est déjà utilisé. Connectez-vous avec ce compte, ou choisissez une autre adresse."
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="logout-warn__overlay" role="presentation" onClick={() => !loading && onClose()}>
      <div
        className="logout-warn anon-save"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anon-save-title"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <>
            <span className="logout-warn__icon" aria-hidden="true">
              ✓
            </span>
            <h2 id="anon-save-title" className="logout-warn__title">
              Compte créé, données sauvegardées
            </h2>
            <p className="logout-warn__text">
              Vos offres, CV et lettres restent liés à cet e-mail. Vous pourrez
              vous reconnecter quand vous voulez.
            </p>
            <div className="logout-warn__actions">
              <button
                type="button"
                className="btn btn--coral logout-warn__stay"
                onClick={onClose}
              >
                Continuer
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="logout-warn__icon" aria-hidden="true">
              ☁
            </span>
            <h2 id="anon-save-title" className="logout-warn__title">
              Sauvegardez votre session découverte
            </h2>
            <p className="logout-warn__text">
              Vous êtes en mode temporaire. Créez un compte en 10 secondes pour
              garder <strong>vos offres, CV et lettres</strong>, sinon ils
              disparaîtront si vous quittez.
            </p>

            <form className="anon-save__form" onSubmit={handleSave}>
              <label className="anon-save__field">
                <span>E-mail</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  disabled={loading}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@email.com"
                />
              </label>
              <label className="anon-save__field">
                <span>Mot de passe</span>
                <div className="anon-save__password">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={MIN_PASSWORD}
                    value={password}
                    disabled={loading}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`${MIN_PASSWORD} caractères min.`}
                  />
                  <button
                    type="button"
                    className="anon-save__toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? "Masquer" : "Voir"}
                  </button>
                </div>
              </label>
              {error && <p className="anon-save__error">{error}</p>}
              <button
                type="submit"
                className="btn btn--coral logout-warn__stay"
                disabled={loading}
              >
                {loading ? "Création…" : "Créer mon compte et sauvegarder"}
              </button>
            </form>

            <div className="anon-save__secondary">
              <button
                type="button"
                className="anon-save__stay"
                disabled={loading}
                onClick={onClose}
              >
                Rester sur le tableau de bord
              </button>
              {onDiscard && (
                <button
                  type="button"
                  className="logout-warn__leave"
                  disabled={loading}
                  onClick={() => {
                    trackEvent("anon_save_discard", { intent });
                    onDiscard();
                  }}
                >
                  {intent === "logout"
                    ? "Se déconnecter et tout perdre"
                    : "Quitter sans sauvegarder"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
