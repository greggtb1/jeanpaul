"""
Routes Stripe — checkout, portail client, webhooks.
"""
import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db, AsyncSessionLocal
from app.models import User, BillingEvent, PlanType
from app.core.auth import get_current_user
from app.core.config import settings

router = APIRouter(prefix="/api/billing", tags=["billing"])
stripe.api_key = settings.STRIPE_SECRET_KEY

PLAN_TO_PRICE = {
    "pro": settings.STRIPE_PRICE_PRO,
    "unlimited": settings.STRIPE_PRICE_UNLIMITED,
}

PRICE_TO_PLAN = {v: k for k, v in PLAN_TO_PRICE.items()}


@router.post("/checkout")
async def create_checkout(
    plan: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if plan not in PLAN_TO_PRICE:
        raise HTTPException(400, "Plan invalide.")

    price_id = PLAN_TO_PRICE[plan]

    # Crée ou récupère le customer Stripe
    if not user.stripe_customer_id:
        customer = stripe.Customer.create(email=user.email, name=user.full_name)
        user.stripe_customer_id = customer.id
        await db.commit()

    session = stripe.checkout.Session.create(
        customer=user.stripe_customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=f"{settings.ALLOWED_ORIGINS[0]}/dashboard?upgraded=1",
        cancel_url=f"{settings.ALLOWED_ORIGINS[0]}/pricing",
        metadata={"user_id": str(user.id)},
    )
    return {"checkout_url": session.url}


@router.post("/portal")
async def customer_portal(
    user: User = Depends(get_current_user),
):
    if not user.stripe_customer_id:
        raise HTTPException(400, "Pas de compte de facturation.")
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=f"{settings.ALLOWED_ORIGINS[0]}/dashboard/settings",
    )
    return {"portal_url": session.url}


@router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Signature Stripe invalide.")

    # Déduplique
    existing = await db.execute(
        select(BillingEvent).where(BillingEvent.stripe_event_id == event["id"])
    )
    if existing.scalar_one_or_none():
        return {"ok": True}

    ev = BillingEvent(stripe_event_id=event["id"], type=event["type"], payload=dict(event))
    db.add(ev)

    # Mise à jour du plan
    if event["type"] in ("customer.subscription.created", "customer.subscription.updated"):
        sub = event["data"]["object"]
        price_id = sub["items"]["data"][0]["price"]["id"]
        plan_name = PRICE_TO_PLAN.get(price_id, "free")
        await _update_user_plan(sub["customer"], plan_name, sub["id"], db)

    elif event["type"] == "customer.subscription.deleted":
        sub = event["data"]["object"]
        await _update_user_plan(sub["customer"], "free", None, db)

    await db.commit()
    return {"ok": True}


async def _update_user_plan(stripe_customer_id: str, plan: str, sub_id, db: AsyncSession):
    result = await db.execute(
        select(User).where(User.stripe_customer_id == stripe_customer_id)
    )
    user = result.scalar_one_or_none()
    if user:
        user.plan = plan
        user.stripe_subscription_id = sub_id
        await db.flush()
