import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  REFERRAL_COMMISSION_RATE,
  REFERRAL_DISCOUNT_PERCENT,
  validateReferralCode,
} from "@/lib/referrals";

type ConversionRow = {
  id: string;
  referred_email: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  amount_paid_cents: number;
  commission_cents: number;
  status: string;
  paid_at: string;
};

function money(cents: number): number {
  return Math.round(cents) / 100;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: code, error: codeError } = await admin
    .from("referral_codes")
    .select("id,code,discount_percent,commission_rate,is_active,created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (codeError) {
    return NextResponse.json({ error: codeError.message }, { status: 500 });
  }

  const conversionsQuery = code
    ? admin
        .from("referral_conversions")
        .select(
          "id,referred_email,plan_id,billing_interval,amount_paid_cents,commission_cents,status,paid_at"
        )
        .eq("referrer_user_id", user.id)
        .order("paid_at", { ascending: false })
    : null;

  const { data: conversions, error: conversionsError } = conversionsQuery
    ? await conversionsQuery
    : { data: [], error: null };

  if (conversionsError) {
    return NextResponse.json({ error: conversionsError.message }, { status: 500 });
  }

  const rows = (conversions ?? []) as ConversionRow[];
  const earnedCents = rows
    .filter((row) => row.status === "earned")
    .reduce((sum, row) => sum + row.commission_cents, 0);

  return NextResponse.json({
    code,
    stats: {
      referred_count: new Set(rows.map((row) => row.referred_email).filter(Boolean)).size,
      sales_count: rows.length,
      revenue_cents: rows.reduce((sum, row) => sum + row.amount_paid_cents, 0),
      earned_cents: earnedCents,
      earned_eur: money(earnedCents),
    },
    conversions: rows,
    defaults: {
      discount_percent: REFERRAL_DISCOUNT_PERCENT,
      commission_rate: REFERRAL_COMMISSION_RATE,
    },
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const code = validateReferralCode(String(body?.code ?? ""));
  if (!code) {
    return NextResponse.json(
      { error: "Code invalide : 3 à 24 caractères, lettres, chiffres, _ ou -." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("referral_codes")
    .select("user_id")
    .eq("code", code)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (existing && existing.user_id !== user.id) {
    return NextResponse.json({ error: "Ce code est déjà pris." }, { status: 409 });
  }

  const { data, error } = await admin
    .from("referral_codes")
    .upsert(
      {
        user_id: user.id,
        code,
        discount_percent: REFERRAL_DISCOUNT_PERCENT,
        commission_rate: REFERRAL_COMMISSION_RATE,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("id,code,discount_percent,commission_rate,is_active,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ code: data });
}

