"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await auth.signup(email, password, name);
      auth.saveToken(data);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Erreur d'inscription.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center mb-8 text-xl font-bold">JobApply</Link>
        <div className="card">
          <h1 className="text-xl font-semibold mb-2">Créer un compte</h1>
          <p className="text-sm text-gray-500 mb-6">Gratuit pour commencer.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Nom complet</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="Grégoire Linée"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="toi@example.com"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Mot de passe</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="8 caractères minimum"
              />
            </div>
            {error && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Création..." : "Créer mon compte →"}
            </button>
          </form>
          <p className="text-xs text-gray-600 text-center mt-4">
            En créant un compte tu acceptes les CGU.
          </p>
          <p className="text-sm text-gray-500 text-center mt-2">
            Déjà un compte ?{" "}
            <Link href="/auth/login" className="text-indigo-400 hover:text-indigo-300">Se connecter</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
