"use client";
import Link from "next/link";

const STEPS = [
  { icon: "🔍", title: "On scrape pour toi", desc: "LinkedIn, WTTJ, Indeed — chaque matin, les nouvelles offres qui matchent ton profil arrivent automatiquement." },
  { icon: "🧠", title: "Claude les score", desc: "Chaque offre reçoit un score de fit /10. Tu vois seulement ce qui vaut vraiment ton temps." },
  { icon: "📄", title: "CV + lettre générés", desc: "Un CV PDF adapté et une lettre personnalisée pour chaque offre retenue. En 30 secondes." },
  { icon: "🤖", title: "Le formulaire est rempli", desc: "Le navigateur s'ouvre, tous les champs sont remplis. Toi tu relis et tu cliques Submit." },
];

const PRICING = [
  {
    name: "Pro",
    price: "29€",
    desc: "Pour la recherche active",
    features: [
      "50 candidatures / mois",
      "Scraping LinkedIn + WTTJ",
      "CV + lettre générés par Claude",
      "Autofill des formulaires",
      "Dashboard de suivi",
    ],
    cta: "Démarrer — 29€/mois",
    highlight: true,
  },
  {
    name: "Unlimited",
    price: "49€",
    desc: "Sans limites",
    features: [
      "Candidatures illimitées",
      "Tout le plan Pro",
      "Priorité support",
      "Accès aux nouvelles features en avant-première",
    ],
    cta: "Démarrer — 49€/mois",
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] sticky top-0 z-50 backdrop-blur-md bg-black/40">
        <span className="font-bold text-lg tracking-tight">JobApply</span>
        <div className="flex items-center gap-4">
          <Link href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Tarifs</Link>
          <Link href="/auth/login" className="text-sm text-gray-400 hover:text-white transition-colors">Se connecter</Link>
          <Link href="/auth/signup" className="btn-primary text-sm">Commencer gratuitement</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-28 pb-20 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-3 py-1 mb-8">
          <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
          Disponible maintenant — 50+ utilisateurs en beta
        </div>
        <h1 className="text-5xl font-bold tracking-tight leading-tight mb-6">
          Arrête de postuler.<br />
          <span className="text-indigo-400">Commence à être choisi.</span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          JobApply scrape les offres, score chaque poste avec l'IA, génère ton CV et ta lettre — et remplit les formulaires à ta place. Toi tu arrives, tu relis, tu cliques Submit.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/auth/signup" className="btn-primary text-base px-8 py-3">
            Démarrer gratuitement →
          </Link>
          <span className="text-sm text-gray-500">Aucune carte requise</span>
        </div>
      </section>

      {/* Démo visuelle */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
          {/* Fausse barre de terminal */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-black/20">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
            <span className="ml-2 text-xs text-gray-500 font-mono">JobApply Dashboard</span>
          </div>
          {/* Faux dashboard */}
          <div className="p-6 grid grid-cols-3 gap-4">
            {[
              { label: "Nouvelles offres", value: "12", color: "text-indigo-400" },
              { label: "Candidatures générées", value: "8", color: "text-green-400" },
              { label: "Entretiens obtenus", value: "3", color: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label} className="card text-center">
                <div className={`text-4xl font-bold mb-1 ${s.color}`}>{s.value}</div>
                <div className="text-sm text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="px-6 pb-6 space-y-2">
            {[
              { company: "Alan", role: "Operations Coordinator", score: 9, status: "Rempli — prêt à soumettre", color: "score-high" },
              { company: "Qonto", role: "Head of Ops", score: 8, status: "CV + lettre générés", color: "score-high" },
              { company: "Payfit", role: "RevOps Manager", score: 7, status: "Analysé", color: "score-mid" },
              { company: "Mirakl", role: "Strategy Manager", score: 6, status: "Nouveau", color: "score-mid" },
            ].map((j) => (
              <div key={j.company} className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-4 py-3">
                <div>
                  <span className="font-medium text-sm">{j.company}</span>
                  <span className="text-gray-500 text-sm"> — {j.role}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`pill ${j.color}`}>{j.score}/10</span>
                  <span className="text-xs text-gray-500">{j.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="max-w-4xl mx-auto px-6 pb-28">
        <h2 className="text-3xl font-bold text-center mb-4">Comment ça marche</h2>
        <p className="text-center text-gray-400 mb-14">Quatre étapes. Zéro galère.</p>
        <div className="grid grid-cols-2 gap-6">
          {STEPS.map((s, i) => (
            <div key={i} className="card flex gap-4">
              <div className="text-3xl flex-shrink-0">{s.icon}</div>
              <div>
                <h3 className="font-semibold mb-1">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-3xl mx-auto px-6 pb-28">
        <h2 className="text-3xl font-bold text-center mb-4">Tarifs simples</h2>
        <p className="text-center text-gray-400 mb-14">Pas d'engagement. Résilie quand tu veux.</p>
        <div className="grid grid-cols-2 gap-6">
          {PRICING.map((p) => (
            <div key={p.name} className={`card flex flex-col ${p.highlight ? "border-indigo-500/40 bg-indigo-500/5" : ""}`}>
              <div className="mb-6">
                <div className="text-sm text-gray-400 mb-1">{p.name}</div>
                <div className="text-4xl font-bold mb-1">{p.price}<span className="text-base font-normal text-gray-400">/mois</span></div>
                <div className="text-sm text-gray-500">{p.desc}</div>
              </div>
              <ul className="space-y-2 mb-8 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-300">
                    <span className="text-green-400">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className={p.highlight ? "btn-primary text-center" : "text-center border border-white/10 hover:border-white/20 text-gray-300 hover:text-white px-5 py-2.5 rounded-lg transition-colors"}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 text-center text-sm text-gray-600">
        © 2025 JobApply — Fait avec ☕ et Claude
      </footer>
    </div>
  );
}
