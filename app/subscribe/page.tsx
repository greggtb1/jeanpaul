"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import BrandName from "@/components/BrandName";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/useAuth";
import {
  FREE_DISCOVERY_OFFER,
  displayPrice,
  PLANS_LIST,
  type BillingInterval,
  type PlanId,
} from "@/lib/plans";
import { getOrCreateDraftId, loadDraft, saveDraft } from "@/lib/onboarding-draft";
import { parseApiJson } from "@/lib/parse-api-json";
import {
  getStoredReferralCode,
  resolveReferralCode,
} from "@/lib/referral-storage";
import { trackEvent } from "@/lib/umami";
import CurrentDiscoveryPlanCard from "@/components/CurrentDiscoveryPlanCard";

export default function SubscribePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { uid, loading: authLoading } = useAuth();
  const [loadingPlanId, setLoadingPlanId] = useState<PlanId | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [error, setError] = useState("");
  const [trialNotice, setTrialNotice] = useState(false);

  // Si l'utilisateur arrive ici depuis l'onboarding déjà rempli, on a un brouillon
  // avec au moins les postes visés : dans ce cas on lance direct le scan découverte
  // plutôt que de le renvoyer se re-taper l'onboarding depuis le début.
  const existingDraft = loadDraft();
  const hasOnboardingDraft = !!existingDraft?.target_roles?.length;

  async function startDiscovery() {
    setDiscoveryLoading(true);
    setError("");
    try {
      trackEvent("pricing_plan_click", {
        plan: FREE_DISCOVERY_OFFER.id,
        billing: "free",
        source: "subscribe_page",
        cta_label: FREE_DISCOVERY_OFFER.cta,
      });

      const supabase = createClient();
      const draft = existingDraft ?? loadDraft() ?? {};
      let userId = uid;
      if (!userId) {
        const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError || !anon.user) throw anonError ?? new Error("Session anonyme refusée");
        userId = anon.user.id;
      }

      let trialDraft = draft;
      try {
        const { uploadPendingCvForUser } = await import("@/lib/onboarding-cv");
        const cv = await uploadPendingCvForUser(userId);
        if (cv) {
          trialDraft = saveDraft({ cv_url: cv.url, cv_filename: cv.filename, cv_path: cv.path });
        }
      } catch {
        /* CV optionnel : le scan démarre sans */
      }

      const shouldPrepareBeforeScan = !trialDraft.cv_url || trialDraft.cv_url === "local";
      const res = await fetch("/api/trial/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: trialDraft,
          prepare_only: shouldPrepareBeforeScan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.redirectTo === "/dashboard") {
          router.push("/dashboard");
          return;
        }
        if (data.trialUsed) {
          setTrialNotice(true);
          setError(data.error || "Votre essai découverte a déjà été utilisé.");
          setDiscoveryLoading(false);
          router.replace("/subscribe?trial_used=1");
          return;
        }
        throw new Error(data.error || "Recherche indisponible");
      }
      if (data.existingSession && data.redirectTo) {
        router.push(data.redirectTo);
        return;
      }
      trackEvent(
        shouldPrepareBeforeScan ? "trial_scan_prepared_without_cv" : "trial_scan_started",
        { plan: "test", source: "subscribe_page" }
      );
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message || "Impossible de démarrer la recherche.");
      setDiscoveryLoading(false);
    }
  }

  const cancelled = searchParams.get("cancelled") === "1";
  const scanFallback = searchParams.get("fallback") === "1";
  const trialUsedFromUrl = searchParams.get("trial_used") === "1";
  const refFromUrl = searchParams.get("ref")?.trim() || "";

  const billing: BillingInterval = "monthly";

  useEffect(() => {
    if (trialUsedFromUrl) setTrialNotice(true);
  }, [trialUsedFromUrl]);

  useEffect(() => {
    // Parrainage limité au parcours en cours : on ne réinjecte pas un code issu
    // d'un ancien brouillon persistant, uniquement le ?ref= / la session active.
    resolveReferralCode(refFromUrl);
  }, [refFromUrl]);

  useEffect(() => {
    if (authLoading || !uid) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("subscription_status, trial_used, first_search_done")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        setTrialNotice(
          data?.subscription_status === "trial" ||
            !!data?.trial_used ||
            !!data?.first_search_done
        );
      });
  }, [authLoading, uid]);

  function activeReferralCode(): string {
    return getStoredReferralCode() || "";
  }

  async function subscribe(planId: PlanId) {
    setLoadingPlanId(planId);
    setError("");
    try {
      const plan = PLANS_LIST.find((p) => p.id === planId)!;
      const isSubscription = plan.kind === "subscription";
      const selectedBilling = isSubscription ? billing : "one_time";
      const code = activeReferralCode();

      trackEvent("checkout_started", {
        plan: planId,
        billing: selectedBilling,
        source: "subscribe_page",
        referral_code: code || undefined,
      });

      const current = saveDraft({
        ...(loadDraft() ?? {}),
        plan_id: planId,
        draft_id: getOrCreateDraftId(),
      });

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          billing: isSubscription ? billing : undefined,
          email: current.email || undefined,
          full_name: current.full_name || undefined,
          draft_id: current.draft_id,
          referral_code: code || undefined,
        }),
      });
      const data = await parseApiJson<{ url?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Impossible de lancer le paiement");
      if (data.url) {
        trackEvent("checkout_redirected", { plan: planId, billing: selectedBilling });
        window.location.href = data.url;
      }
      else throw new Error("URL de paiement manquante");
    } catch (e) {
      trackEvent("checkout_error", { plan: planId });
      setError((e as Error).message);
      setLoadingPlanId(null);
    }
  }

  return (
    <div className="paywall-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="paywall-card paywall-card--plans">
        <div className="paywall-card__brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <BrandName />
        </div>
        <span className="paywall-card__badge">Étape 2 sur 3</span>
        <h1>Choisissez votre formule</h1>

        {scanFallback && (
          <p className="paywall-card__fallback" role="status">
            La recherche gratuite n&apos;a pas pu démarrer automatiquement. Choisissez une formule
            ou réessayez sans payer ci-dessous.
          </p>
        )}

        {trialNotice && (
          <p className="paywall-card__trial-hint" role="status">
            Passez à une formule payante pour débloquer la suite de votre recherche.
          </p>
        )}

        <div className="pricing__grid paywall-card__plans">
          {trialNotice && <CurrentDiscoveryPlanCard />}
          {PLANS_LIST.map((plan) => {
            const price = displayPrice(
              plan,
              plan.kind === "one_time" ? "weekly" : billing
            );
            const loading = loadingPlanId === plan.id;
            const busy = loadingPlanId !== null || discoveryLoading;

            return (
              <article
                key={plan.id}
                className={`pricing-card${plan.featured ? " pricing-card--featured" : ""}`}
              >
                {plan.featured && (
                  <span className="pricing-card__badge">Le plus populaire</span>
                )}

                <h3 className="pricing-card__title">{plan.name}</h3>
                <p className="pricing-card__tagline">{plan.tagline}</p>

                <div className="pricing-card__price">
                  <strong>{price.amount} €</strong>
                  <span>{price.suffix}</span>
                </div>

                <div className="pricing-card__savings-slot" />

                <p className="pricing-card__desc">{plan.description}</p>

                <div className="pricing-card__cta-wrap">
                  <button
                    type="button"
                    className={`btn pricing-card__cta${plan.featured ? " btn--accent" : " btn--outline"}`}
                    disabled={busy}
                    onClick={() => {
                      trackEvent("pricing_plan_click", {
                        plan: plan.id,
                        billing: plan.kind === "subscription" ? billing : "one_time",
                        source: "subscribe_page",
                      });
                      subscribe(plan.id);
                    }}
                  >
                    {loading
                      ? "Redirection…"
                      : plan.kind === "one_time"
                        ? "Choisir l'offre Start"
                        : `Choisir ${plan.name}`}
                  </button>
                </div>

                <ul className="pricing-card__features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        {cancelled && (
          <p className="paywall-card__warn">Paiement annulé. Vous pouvez réessayer quand vous voulez.</p>
        )}
        {error && <p className="paywall-card__error">{error}</p>}

        {!trialNotice && (
          <p className="paywall-card__free-trial">
            Pas envie de payer tout de suite ?{" "}
            {hasOnboardingDraft ? (
              <button
                type="button"
                className="paywall-card__free-trial-link"
                disabled={discoveryLoading || loadingPlanId !== null}
                onClick={startDiscovery}
              >
                {discoveryLoading ? "Lancement…" : "Essayez gratuitement"}
              </button>
            ) : (
              <Link
                href={FREE_DISCOVERY_OFFER.href}
                className="paywall-card__free-trial-link"
                onClick={() =>
                  trackEvent("pricing_plan_click", {
                    plan: FREE_DISCOVERY_OFFER.id,
                    billing: "free",
                    source: "subscribe_page_free_link",
                  })
                }
              >
                Essayez gratuitement
              </Link>
            )}
          </p>
        )}

        <p className="paywall-card__foot">
          Paiement sécurisé par Stripe · création de compte juste après
        </p>
      </div>
    </div>
  );
}
