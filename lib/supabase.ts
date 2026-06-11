"use client";

import { createClient } from "@/lib/supabase/client";

export type Profile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  target_roles?: string[] | null;
  target_locations?: string[] | null;
  contract_type?: string[] | null;
  salary_min?: number | null;
  remote_pref?: string[] | null;
  cv_url?: string | null;
  cv_filename?: string | null;
  summary?: string | null;
  letter_tone?: string | null;
  letter_sample?: string | null;
  onboarding_done?: boolean | null;
  first_search_done?: boolean | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  plan_id?: string | null;
};

export const LETTER_TONES = [
  { id: "pro", label: "Professionnel & posé", tagline: "Classique, rassurant" },
  { id: "direct", label: "Direct & efficace", tagline: "Court, sans détour" },
  { id: "enthousiaste", label: "Enthousiaste & énergique", tagline: "Motivé, pas forcé" },
  { id: "story", label: "Personnel & narratif", tagline: "Accroche parcours" },
  { id: "concis", label: "Ultra-court & percutant", tagline: "3 phrases max" },
] as const;

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

/** @deprecated Utiliser createClient() depuis @/lib/supabase/client */
export { createClient as supabase } from "@/lib/supabase/client";
