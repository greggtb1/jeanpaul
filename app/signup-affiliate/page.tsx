import { Suspense } from "react";
import SignupAffiliateClient from "./SignupAffiliateClient";

export default function SignupAffiliatePage() {
  return (
    <Suspense fallback={null}>
      <SignupAffiliateClient />
    </Suspense>
  );
}

