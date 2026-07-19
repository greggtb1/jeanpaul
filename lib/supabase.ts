"use client";

import { createClient } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  target_roles?: string[] | null;
  target_sectors?: string[] | null;
  target_locations?: string[] | null;
  location_search_mode?: "city" | "radius" | null;
  location_radius_km?: number | null;
  contract_type?: string[] | null;
  salary_min?: number | null;
  remote_pref?: string[] | null;
  cv_url?: string | null;
  cv_filename?: string | null;
  cv_path?: string | null;
  summary?: string | null;
  letter_tone?: string | null;
  letter_sample?: string | null;
  onboarding_done?: boolean | null;
  first_search_done?: boolean | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan_id?: string | null;
  bonus_credits?: number | null;
  is_trial?: boolean | null;
  trial_used?: boolean | null;
};

export const LETTER_TONES = [
  { id: "pro", label: "Professionnel & posé", tagline: "Classique" },
  { id: "corporate", label: "Formelle & corporate", tagline: "Lettre type" },
  { id: "enthousiaste", label: "Enthousiaste & énergique", tagline: "Énergique" },
  { id: "concis", label: "Ultra-court & percutant", tagline: "Droit au but" },
] as const;

/** Ancien id « direct » → corporate. */
export function normalizeLetterTone(tone: string | null | undefined): string {
  const t = (tone || "pro").trim();
  if (t === "direct") return "corporate";
  return t || "pro";
}

export type Job = {
  url: string;
  data: Record<string, unknown>;
  fit_score?: number | null;
  applied?: boolean | null;
  deleted?: boolean | null;
  cv_url?: string | null;
  letter_url?: string | null;
  user_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type BlogArticle = {
  id: string;
  author_id?: string | null;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  cover_image_url?: string | null;
  cover_image_path?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  keywords?: string[] | null;
  status: "draft" | "published";
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** @deprecated Utiliser createClient() depuis @/lib/supabase/client */
export { createClient as supabase } from "@/lib/supabase/client";
