import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export const REFERRAL_DISCOUNT_PERCENT = 15;
export const REFERRAL_COMMISSION_RATE = 0.35;
export const REFERRAL_COUPON_ID = "aiapply_referral_15";

export type ReferralCodeRow = {
  id: string;
  user_id: string;
  code: string;
  discount_percent: number;
  commission_rate: number;
};

export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function validateReferralCode(value: string): string | null {
  const code = normalizeReferralCode(value);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return null;
  return code;
}

export function commissionCents(amountPaidCents: number, rate = REFERRAL_COMMISSION_RATE): number {
  return Math.round(Math.max(0, amountPaidCents) * rate);
}

export async function ensureReferralCoupon(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(REFERRAL_COUPON_ID);
    return REFERRAL_COUPON_ID;
  } catch {
    await stripe.coupons.create({
      id: REFERRAL_COUPON_ID,
      name: "Code ambassadeur -15%",
      percent_off: REFERRAL_DISCOUNT_PERCENT,
      duration: "forever",
    });
    return REFERRAL_COUPON_ID;
  }
}

export async function findReferralCode(
  admin: SupabaseClient,
  rawCode: string
): Promise<ReferralCodeRow | null> {
  const code = validateReferralCode(rawCode);
  if (!code) return null;

  const { data, error } = await admin
    .from("referral_codes")
    .select("id,user_id,code,discount_percent,commission_rate")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return (data as ReferralCodeRow | null) ?? null;
}

