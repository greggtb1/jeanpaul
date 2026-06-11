"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SubscribeSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setError("Session de paiement introuvable.");
      return;
    }
    fetch(`/api/stripe/verify?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Vérification échouée");
        if (data.active) {
          router.replace(`/signup?session_id=${encodeURIComponent(sessionId)}`);
        } else {
          setError("Paiement en cours de validation. Réessayez dans quelques secondes.");
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [sessionId, router]);

  return (
    <div className="paywall-page">
      <div className="bg-decor" aria-hidden="true" />
      <div className="paywall-card">
        <h1>{error ? "Un instant…" : "Paiement confirmé ✓"}</h1>
        <p className="paywall-card__lead">
          {error || "Dernière étape : création de votre compte…"}
        </p>
        {error && (
          <button
            type="button"
            className="btn btn--coral btn--full"
            onClick={() => router.replace("/subscribe")}
          >
            Retour
          </button>
        )}
      </div>
    </div>
  );
}
