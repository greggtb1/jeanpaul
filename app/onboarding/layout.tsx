import { Suspense } from "react";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="ob">
          <p>Chargement…</p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
