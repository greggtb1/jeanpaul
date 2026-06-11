"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { auth } from "@/lib/api";

const NAV = [
  { href: "/dashboard", icon: "⚡", label: "Dashboard" },
  { href: "/dashboard/jobs", icon: "🔍", label: "Offres" },
  { href: "/dashboard/applications", icon: "📄", label: "Candidatures" },
  { href: "/dashboard/profile", icon: "👤", label: "Mon profil" },
  { href: "/dashboard/settings", icon: "⚙️", label: "Paramètres" },
];

export default function Sidebar() {
  const path = usePathname();
  const user = auth.currentUser();

  return (
    <aside className="w-56 flex-shrink-0 border-r border-white/[0.06] flex flex-col py-6 px-3">
      {/* Logo */}
      <div className="px-3 mb-8">
        <span className="font-bold text-lg">JobApply</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {NAV.map((item) => {
          const active = path === item.href || (item.href !== "/dashboard" && path.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="border-t border-white/[0.06] pt-4 px-3">
        {user && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium truncate">{user.email}</div>
              <div className="text-xs text-indigo-400 capitalize">{user.plan}</div>
            </div>
            <button
              onClick={auth.logout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              title="Déconnexion"
            >
              ↪
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
