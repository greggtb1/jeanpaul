"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { activateAccount } from "@/lib/activate-account";
import AuthProvisioning from "@/components/AuthProvisioning";

export default function SignupCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? "";
  const [step, setStep] = useState("Vérification de votre compte…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sessionId) {
      router.replace("/onboarding");
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user?.id) {
        router.replace(`/signup?session_id=${encodeURIComponent(sessionId)}`);
        return;
      }

      try {
        await activateAccount(sessionId, { onStep: setStep });
        setStep("Ouverture de votre espace…");
        router.replace("/dashboard");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }, [sessionId, router]);

  if (error) {
    return (
      <div className="auth-page">
        <div className="bg-decor" aria-hidden="true" />
        <div className="auth-card">
          <h1>Activation impossible</h1>
          <p className="auth-card__lead">{error}</p>
        </div>
      </div>
    );
  }

  return <AuthProvisioning step={step} />;
}
