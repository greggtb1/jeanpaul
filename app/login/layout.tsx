import { Suspense } from "react";
import LoginPage from "./page";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="auth-page"><div className="auth-card"><p>Chargement…</p></div></div>}>{children}</Suspense>;
}
