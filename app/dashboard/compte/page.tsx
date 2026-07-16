"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import LogoutWarningModal from "@/components/LogoutWarningModal";
import { isPlausiblePersonName } from "@/lib/file-name";

export default function ComptePage() {
  const { uid, loading: authLoading, user } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoutWarnOpen, setLogoutWarnOpen] = useState(false);
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
          // Le nom peut avoir été mal extrait du CV (ex. un intitulé de poste
          // « Customer Operations Lead Bigblue »). On ne pré-remplit que si c'est
          // un vrai nom de personne, sinon on laisse vide.
          const rawName = (data.full_name || "").trim();
          const validName = isPlausiblePersonName(rawName);
          setForm({
            full_name: validName ? rawName : "",
            email: data.email || "",
            phone: data.phone || "",
            location: data.location || "",
          });
          // Purge en base le nom invalide pour éviter toute génération de
          // document signée avec un faux nom tant que l'utilisateur n'a rien saisi.
          if (rawName && !validName) {
            void supabase
              .from("profiles")
              .update({ full_name: null })
              .eq("id", uid);
          }
        }
        setLoading(false);
      });
  }, [uid, supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function requestLogout() {
    if (user?.is_anonymous) {
      setLogoutWarnOpen(true);
      return;
    }
    void logout();
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
        <h2 className="db-panel__title">Session</h2>
        <p className="db-muted">
          {user?.is_anonymous
            ? "Compte découverte : vos données ne sont pas sauvegardées, la déconnexion les efface définitivement."
            : "Déconnectez-vous de votre compte sur cet appareil."}
        </p>
        <button type="button" className="btn btn--outline btn--sm" style={{ marginTop: 12 }} onClick={requestLogout}>
          Déconnexion
        </button>
      </section>

      <LogoutWarningModal
        open={logoutWarnOpen}
        onConfirm={() => {
          setLogoutWarnOpen(false);
          void logout();
        }}
        onCancel={() => setLogoutWarnOpen(false)}
      />
    </main>
  );
}
