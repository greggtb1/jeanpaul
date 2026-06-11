"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await auth.login(email, password);
      auth.saveToken(data);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "Erreur de connexion.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center mb-8 text-xl font-bold">JobApply</Link>
        <div className="card">
          <h1 className="text-xl font-semibold mb-6">Connexion</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                placeholder="••••••••"
              />
            </div>
            {error && <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
          <p className="text-sm text-gray-500 text-center mt-4">
            Pas encore de compte ?{" "}
            <Link href="/auth/signup" className="text-indigo-400 hover:text-indigo-300">S'inscrire</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
