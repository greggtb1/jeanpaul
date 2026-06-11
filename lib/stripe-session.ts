import { getStripe, isCheckoutSessionActive } from "@/lib/stripe";
import { parsePlanId } from "@/lib/plans";

export type CheckoutSessionInfo = {
  active: boolean;
  status: string | null;
  email: string | null;
  fullName: string | null;
  planId: ReturnType<typeof parsePlanId>;
  draftId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  pending: boolean;
  userId: string | null;
};

export function sessionBelongsToUser(
  info: CheckoutSessionInfo,
  user: { id: string; email?: string | null }
): boolean {
  if (info.userId && info.userId !== user.id && !info.pending) {
    return false;
  }
  if (info.email && user.email && !info.pending) {
    if (info.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

export async function getCheckoutSessionInfo(sessionId: string): Promise<CheckoutSessionInfo> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer", "subscription"],
  });

  const customer =
    typeof session.customer === "string"
      ? await stripe.customers.retrieve(session.customer)
      : session.customer;

  const email =
    session.customer_details?.email ??
    (customer && !("deleted" in customer) ? customer.email : null) ??
    session.metadata?.email ??
    null;

  const fullName =
    session.customer_details?.name ??
    (customer && !("deleted" in customer) ? customer.name : null) ??
    null;

  const pending = session.metadata?.pending === "true";
  const userId = session.client_reference_id || session.metadata?.supabase_user_id || null;
  const active = isCheckoutSessionActive(session);

  return {
    active,
    status: active ? "active" : session.payment_status ?? null,
    email,
    fullName,
    planId: parsePlanId(session.metadata?.plan_id),
    draftId: session.metadata?.draft_id ?? null,
    customerId:
      typeof session.customer === "string"
        ? session.customer
        : customer && !("deleted" in customer)
          ? customer.id
          : null,
    subscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null,
    pending,
    userId,
  };
}

export async function attachCheckoutToUser(
  sessionId: string,
  userId: string,
  userEmail: string,
  prefetched?: CheckoutSessionInfo
) {
  const stripe = getStripe();
  const info = prefetched ?? (await getCheckoutSessionInfo(sessionId));

  if (!info.active) {
    throw new Error("Paiement non confirmé");
  }

  if (info.email && !info.pending) {
    const paid = info.email.trim().toLowerCase();
    const user = userEmail.trim().toLowerCase();
    if (paid !== user) {
      throw new Error("L'email du compte doit correspondre à celui du paiement");
    }
  }

  if (info.userId && info.userId !== userId && !info.pending) {
    throw new Error("Session déjà rattachée à un autre compte");
  }

  const metadata = {
    supabase_user_id: userId,
    plan_id: info.planId,
    draft_id: info.draftId ?? "",
  };

  const tasks: Promise<unknown>[] = [
    stripe.checkout.sessions.update(sessionId, {
      metadata: { ...metadata, pending: "false" },
    }),
  ];

  if (info.customerId) {
    tasks.push(stripe.customers.update(info.customerId, { metadata }));
  }

  if (info.subscriptionId) {
    tasks.push(
      stripe.subscriptions.update(info.subscriptionId, { metadata })
    );
  }

  await Promise.all(tasks);

  return info;
}
