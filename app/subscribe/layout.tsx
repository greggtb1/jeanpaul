import { Suspense } from "react";

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="paywall-page">
          <div className="paywall-card">
            <p>Chargement…</p>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
