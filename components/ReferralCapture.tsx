"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { persistReferralCode } from "@/lib/referral-storage";

function ReferralCaptureInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) persistReferralCode(ref);
  }, [pathname, searchParams]);

  return null;
}

/** Capture ?ref= sur n’importe quelle page et le garde pour le checkout. */
export default function ReferralCapture() {
  return (
    <Suspense fallback={null}>
      <ReferralCaptureInner />
    </Suspense>
  );
}
