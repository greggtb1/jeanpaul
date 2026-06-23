"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";

export default function ComptePage() {
  const { uid, loading: authLoading } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    location: "",
  });

  useEffect(() => {
    if (!uid) return;
    supabase
      .from("profiles")
      .select("full_name,email,phone,location")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setForm({
            full_name: data.full_name || "",
            email: data.email || "",
            phone: data.phone || "",
            location: data.location || "",
          });
        }
        setLoading(false);
      });
  }, [uid, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const { error } = await supabase.from("profiles").upsert({
      id: uid,
      full_name: form.full_name || null,
      email: form.email || null,
      phone: form.phone || null,
      location: form.location || null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) alert(error.message);
    else setSaved(true);
  }

  return (
    <main className="db__main db__main--narrow">
      <div className="db-page-head">
        <h1>Mon compte</h1>
        <p>Vos informations personnelles.</p>
      </div>

      {authLoading || loading ? (
        <p className="db-muted">Chargement…</p>
      ) : (
        <form className="db-panel" onSubmit={save}>
          <label className="db-field">
            <span>Nom complet</span>
            <input
              className="db-input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </label>
          <label className="db-field">
            <span>Email</span>
            <input
              className="db-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="db-field">
            <span>Téléphone</span>
            <input
              className="db-input"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="db-field">
            <span>Ville</span>
            <input
              className="db-input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </label>
          <div className="db-panel__actions">
            <button type="submit" className="btn btn--coral btn--sm" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            {saved && <span className="db-saved">✓ Enregistré</span>}
          </div>
        </form>
      )}

      <section className="db-panel db-panel--flat">
        <h2 className="db-panel__title">Recherche d&apos;emploi</h2>
        <p className="db-muted">
          Postes visés, CV, ton des lettres et critères de recherche.
        </p>
        <Link href="/dashboard/preferences" className="btn btn--outline btn--sm" style={{ marginTop: 12 }}>
          Modifier mes critères de recherche
        </Link>
      </section>

      <section className="db-panel db-panel--flat">
        <h2 className="db-panel__title">Session</h2>
        <p className="db-muted">Déconnectez-vous de votre compte sur cet appareil.</p>
        <button type="button" className="btn btn--outline btn--sm" style={{ marginTop: 12 }} onClick={logout}>
          Déconnexion
        </button>
      </section>
    </main>
  );
}
