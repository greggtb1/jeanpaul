import type Stripe from "stripe";
import { resolveStripeProductIdForPlan } from "@/lib/stripe-prices";

const TEST_PROMO_CODE = "greg";
const GREG_COUPON_ID = "aiapply_greg_test";

function promoCouponId(promo: Stripe.PromotionCode): string | undefined {
  const promotion = promo.promotion as { coupon?: string | Stripe.Coupon } | undefined;
  const coupon = promotion?.coupon;
  if (typeof coupon === "string") return coupon;
  return coupon?.id;
}

/** Coupon 100 % — tests uniquement, formule Start (code « greg » sur Stripe Checkout). */
export async function ensureGregPromoCode(stripe: Stripe): Promise<void> {
  const productId = await resolveStripeProductIdForPlan(stripe, "test");
  if (!productId) {
    console.warn(
      "[stripe-promo] Produit Start introuvable (STRIPE_PRICE_TEST ou STRIPE_PRODUCT_TEST) — greg non configuré."
    );
    return;
  }

  try {
    await stripe.coupons.retrieve(GREG_COUPON_ID);
  } catch {
    await stripe.coupons.create({
      id: GREG_COUPON_ID,
      percent_off: 100,
      duration: "once",
      name: "Test greg — Start uniquement",
      applies_to: { products: [productId] },
      metadata: { purpose: "internal_test", plan_id: "test" },
    });
  }

  const promos = await stripe.promotionCodes.list({
    code: TEST_PROMO_CODE,
    limit: 20,
  });

  const onCorrectCoupon = promos.data.find(
    (p) => p.active && promoCouponId(p) === GREG_COUPON_ID
  );
  if (onCorrectCoupon) return;

  for (const promo of promos.data) {
    if (promo.active) {
      await stripe.promotionCodes.update(promo.id, { active: false });
    }
  }

  await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: GREG_COUPON_ID },
    code: TEST_PROMO_CODE,
    active: true,
    metadata: { purpose: "internal_test", plan_id: "test" },
  });
}
