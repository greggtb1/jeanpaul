import DashboardShell from "@/components/DashboardShell";

// Pages auth : pas de pré-render au build (Supabase pas dispo sur hPanel build)
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
