import type Stripe from "stripe";

const TEST_PROMO_CODE = "greg";

/** Coupon 100 % — tests uniquement (code « greg » sur la page Stripe). */
export async function ensureGregPromoCode(stripe: Stripe): Promise<void> {
  const existing = await stripe.promotionCodes.list({
    code: TEST_PROMO_CODE,
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) return;

  const inactive = await stripe.promotionCodes.list({
    code: TEST_PROMO_CODE,
    limit: 1,
  });
  if (inactive.data.length > 0) {
    await stripe.promotionCodes.update(inactive.data[0].id, { active: true });
    return;
  }

  const coupon = await stripe.coupons.create({
    percent_off: 100,
    duration: "once",
    name: "JEAN PAUL test greg",
    metadata: { purpose: "internal_test" },
  });

  await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: TEST_PROMO_CODE,
    active: true,
    metadata: { purpose: "internal_test" },
  });
}
