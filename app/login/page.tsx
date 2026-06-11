"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BrandName from "@/components/BrandName";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(searchParams.get("error") ? "Connexion impossible." : "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
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
        <h1>Connexion</h1>
        <p className="auth-card__lead">Retrouvez vos offres et candidatures.</p>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn btn--accent btn--full" disabled={loading}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <p className="auth-card__foot">
          Pas encore de compte ? <Link href="/onboarding">Commencer</Link>
        </p>
        <p className="auth-card__back">
          <Link href="/">Retour à l&apos;accueil</Link>
        </p>
      </div>
    </div>
  );
}
