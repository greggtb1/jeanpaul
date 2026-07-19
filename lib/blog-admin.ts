import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Seul compte autorisé pour le backoffice blog (env optionnel en plus). */
const HARDCODED_BLOG_ADMINS = ["gregoire@garetabecane.fr"];

export function blogAdminEmails(): string[] {
  const fromEnv = (process.env.BLOG_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...HARDCODED_BLOG_ADMINS, ...fromEnv])];
}

export function isBlogAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return blogAdminEmails().includes(email.trim().toLowerCase());
}

export async function requireBlogAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return { ok: false as const, status: 401, error: "Non authentifié" };
  }

  if (!isBlogAdminEmail(user.email)) {
    return {
      ok: false as const,
      status: 403,
      error: "Accès refusé",
    };
  }

  return {
    ok: true as const,
    user,
    admin: createAdminClient(),
  };
}
