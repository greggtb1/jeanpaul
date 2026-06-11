import { Suspense } from "react";

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="auth-page">
          <div className="auth-card">
            <p>Chargement…</p>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
