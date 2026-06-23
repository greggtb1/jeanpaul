"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BrandName from "@/components/BrandName";

const MIN_PASSWORD = 6;

export default function SignupAffiliateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard/parrainage";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    setError("");

    const register = await fetch("/api/auth/register-affiliate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
      }),
    });
    const payload = await register.json().catch(() => ({}));
    if (!register.ok) {
      setError(payload.error || "Impossible de créer le compte.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    await fetch("/api/auth/merge-legacy", { method: "POST" });
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="auth-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="auth-card">
        <Link href="/" className="auth-card__brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <BrandName />
        </Link>
        <h1>Créer un compte ambassadeur</h1>
        <p className="auth-card__lead">
          Accédez au dashboard parrainage sans abonnement.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Mot de passe</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Confirmer le mot de passe</span>
            <input
              type="password"
              required
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn--accent btn--full" disabled={loading}>
            {loading ? "Création…" : "Créer mon compte"}
          </button>
        </form>

        <p className="auth-card__foot">
          Déjà un compte ?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`}>Se connecter</Link>
        </p>
      </div>
    </div>
  );
}

