import { Suspense } from "react";
import AuthProvisioning from "@/components/AuthProvisioning";

export default function SignupCompleteLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AuthProvisioning step="Connexion en cours…" />}>
      {children}
    </Suspense>
  );
}
