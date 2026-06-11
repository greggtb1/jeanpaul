import { Suspense } from "react";

export default function FacturationLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="db-panel">
          <p>Chargement…</p>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
