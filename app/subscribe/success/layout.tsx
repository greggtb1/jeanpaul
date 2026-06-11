import { Suspense } from "react";

export default function SubscribeSuccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="paywall-page">
          <div className="paywall-card">
            <p>Vérification du paiement…</p>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
