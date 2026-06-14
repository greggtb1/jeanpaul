"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BrandName from "@/components/BrandName";
import AuthProvisioning from "@/components/AuthProvisioning";
import { activateAccount } from "@/lib/activate-account";
import { loadDraft } from "@/lib/onboarding-draft";
import { trackEvent } from "@/lib/umami";

const MIN_PASSWORD = 6;

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: "new-password" | "off";
}) {
  return (
    <label className="auth-field auth-field--password">
      <span>{label}</span>
      <input
        type={show ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="auth-field__toggle"
        onClick={onToggleShow}
        aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
      >
        {show ? "Masquer" : "Voir"}
      </button>
    </label>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [provisioningStep, setProvisioningStep] = useState("");
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const passwordsMatch = password === passwordConfirm;

  useEffect(() => {
    if (!sessionId) {
      router.replace("/onboarding");
      return;
    }

    fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.active) throw new Error(data.error || "Paiement non confirmé");

        const draft = loadDraft();
        setEmail(data.email || draft?.email || "");
        setFullName(data.full_name || draft?.full_name || "");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setChecking(false));
  }, [sessionId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId) return;

    if (password.length < MIN_PASSWORD) {
      setError(`Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
      return;
    }
    if (password !== passwordConfirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    setError("");

    const registerRes = await fetch("/api/auth/register-after-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        email,
        password,
        full_name: fullName.trim(),
      }),
    });

    const registerData = await registerRes.json().catch(() => ({}));
    if (!registerRes.ok) {
      trackEvent("signup_error", { stage: "register" });
      setError(registerData.error || "Impossible de créer le compte");
      setLoading(false);
      return;
    }
    trackEvent("signup_account_created");

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      trackEvent("signup_error", { stage: "signin" });
      setError(authError.message);
      setLoading(false);
      return;
    }

    try {
      setProvisioningStep("Création de votre espace…");
      await activateAccount(sessionId, { onStep: setProvisioningStep });
      trackEvent("signup_activation_completed");
      setProvisioningStep("Ouverture de votre espace…");
      router.replace("/dashboard");
    } catch (err) {
      trackEvent("signup_error", { stage: "activate" });
      setError((err as Error).message);
      setLoading(false);
      setProvisioningStep("");
    }
  }

  if (loading && provisioningStep) {
    return <AuthProvisioning step={provisioningStep} />;
  }

  if (checking) {
    return (
      <div className="auth-page">
        <div className="bg-decor" aria-hidden="true" />
        <div className="auth-card">
          <p>Vérification du paiement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="auth-card">
        <Link href="/" className="auth-card__brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <BrandName />
        </Link>
        <span className="paywall-card__badge">Étape 3 sur 3</span>
        <h1>Créez votre compte</h1>
        <p className="auth-card__lead">
          Paiement confirmé. Choisissez un mot de passe pour accéder à votre espace.
        </p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              required
              readOnly
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <PasswordField
            label="Mot de passe"
            value={password}
            onChange={setPassword}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirmer le mot de passe"
            value={passwordConfirm}
            onChange={setPasswordConfirm}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoComplete="off"
          />
          {password.length > 0 && password.length < MIN_PASSWORD && (
            <p className="auth-hint">{MIN_PASSWORD} caractères minimum</p>
          )}
          {passwordConfirm.length > 0 && !passwordsMatch && (
            <p className="auth-error">Les mots de passe ne correspondent pas.</p>
          )}
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn--accent btn--full" disabled={loading}>
            {loading ? "Activation…" : "Accéder à mon espace"}
          </button>
        </form>
        <p className="auth-card__foot">
          Déjà inscrit ? <Link href="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
