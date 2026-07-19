import type { User } from "@supabase/supabase-js";

/**
 * Session découverte temporaire (pas encore de compte).
 * Après conversion anonyme → permanent, Supabase peut laisser is_anonymous=true
 * dans le JWT : on considère alors l'e-mail lié comme compte réel.
 */
export function isAnonymousSession(user: User | null | undefined): boolean {
  if (!user) return false;
  if (!user.is_anonymous) return false;
  if (user.email) return false;
  return true;
}
