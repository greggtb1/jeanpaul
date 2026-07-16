import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function allowedEmails(): string[] {
  return (process.env.BLOG_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireBlogAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return { ok: false as const, status: 401, error: "Non authentifié" };
  }

  const allowlist = allowedEmails();
  const email = user.email.trim().toLowerCase();
  const localBypass = process.env.NODE_ENV !== "production" && allowlist.length === 0;

  if (!localBypass && !allowlist.includes(email)) {
    return {
      ok: false as const,
      status: 403,
      error: "Accès blog refusé. Ajoutez votre email dans BLOG_ADMIN_EMAILS.",
    };
  }

  return {
    ok: true as const,
    user,
    admin: createAdminClient(),
  };
}
