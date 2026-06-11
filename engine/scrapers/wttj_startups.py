"""
Scraper de startups/scale-ups tech Paris sur WTTJ.

Cherche des boîtes (pas des postes) en filtrant par taille (15-250 salariés)
et des mots-clés sectoriels. Retourne les profils d'entreprises.
"""

import json
import re
import time
from typing import List, Dict
from rich.console import Console

console = Console()

WTTJ_BASE      = "https://www.welcometothejungle.com"
WTTJ_COMPANIES = "https://www.welcometothejungle.com/fr/companies"

# Mots-clés sectoriels — rotés à chaque run pour varier les boîtes trouvées
# marketplace et mobility en priorité (top fit Gregoire), reste varié
import random as _random

_STARTUP_QUERIES_POOL = [
    # Priorité haute (toujours inclus)
    "marketplace",
    "mobility",
    # Pool varié — on en pioche 8 aléatoirement
    "saas",
    "fintech",
    "proptech",
    "healthtech",
    "legaltech",
    "edtech",
    "automation",
    "logistics",
    "e-commerce",
    "insurtech",
    "retailtech",
    "foodtech",
    "cleantech",
    "b2b",
    "api",
    "no-code",
    "data",
    "payments",
]

def _build_queries() -> list:
    """Toujours marketplace + mobility, puis 8 autres au hasard depuis le pool."""
    priority = ["marketplace", "mobility"]
    pool     = [q for q in _STARTUP_QUERIES_POOL if q not in priority]
    return priority + _random.sample(pool, min(8, len(pool)))

STARTUP_QUERIES = _build_queries()

# Filtres WTTJ : XS (<15), S (15-50) et M (50-250)
# XS = très petites startups early-stage, S = startups, M = scale-ups
_SIZE_PARAMS = (
    "refinementList%5Bsize%5D%5B%5D=XS"
    "&refinementList%5Bsize%5D%5B%5D=S"
    "&refinementList%5Bsize%5D%5B%5D=M"
)

_CONSENT_INIT = """
(function(){
    var ls={
        'wttj_cookie_consent':'true','wttj_cookies_accepted':'all',
        'cookie_consent':'accepted','cookies_accepted':'true',
        'OptanonAlertBoxClosed':'2024-01-15T10:00:00.000Z',
    };
    try{ for(var k in ls) localStorage.setItem(k,ls[k]); }catch(e){}
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    window.chrome=window.chrome||{runtime:{}};
})();
"""

_KILL_MODAL = """
(function(){
    var labels=['Tout accepter','Accepter tout','OK pour moi','Accepter','Accept all'];
    var btns=Array.from(document.querySelectorAll('button,[role=button]'));
    for(var i=0;i<labels.length;i++){
        var b=btns.find(function(b){return(b.textContent||'').trim().startsWith(labels[i]);});
        if(b&&b.offsetParent){b.click();return;}
    }
    document.querySelectorAll('*').forEach(function(el){
        var s=getComputedStyle(el);
        if((s.position==='fixed'||s.position==='sticky')&&parseInt(s.zIndex||0)>100)
            el.remove();
    });
    document.body.style.overflow='auto';
})();
"""


class WTTJStartupScraper:
    def __init__(self):
        self._browser = None
        self._pw_ctx  = None

    def _ensure_browser(self):
        if self._browser:
            return
        from playwright.sync_api import sync_playwright
        self._pw_ctx  = sync_playwright().__enter__()
        self._browser = self._pw_ctx.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                  "--disable-blink-features=AutomationControlled"],
        )

    def _close_browser(self):
        if self._browser:
            try: self._browser.close()
            except Exception: pass
            self._browser = None
        if self._pw_ctx:
            try: self._pw_ctx.__exit__(None, None, None)
            except Exception: pass
            self._pw_ctx = None

    def _new_context(self):
        ctx = self._browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="fr-FR", timezone_id="Europe/Paris",
            viewport={"width": 1440, "height": 900},
            java_script_enabled=True, bypass_csp=True,
        )
        ctx.add_init_script(_CONSENT_INIT)
        ctx.add_cookies([
            {"name": "wttj_cookie_consent", "value": "true",
             "domain": ".welcometothejungle.com", "path": "/"},
            {"name": "cookies_accepted",    "value": "true",
             "domain": ".welcometothejungle.com", "path": "/"},
        ])
        return ctx

    def _handle_modal(self, page):
        for selector in [
            "button:has-text('Tout accepter')",
            "button:has-text('OK pour moi')",
            "button:has-text('Accepter')",
            "button:has-text('Accept all')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1_000):
                    btn.click()
                    time.sleep(0.6)
                    return
            except Exception:
                pass
        try: page.evaluate(_KILL_MODAL)
        except Exception: pass

    # ── Recherche de startups ─────────────────────────────────────────────────

    def search_startups(self, max_companies: int = 30,
                        location: str = "Paris",
                        skip_slugs: set = None) -> List[Dict]:
        """
        Cherche des startups tech Paris (15-250 salariés) sur WTTJ.
        Parcourt tous les mots-clés sectoriels.
        skip_slugs : slugs à ignorer (déjà traités).
        Retourne une liste de profils d'entreprises dédupliqués.
        """
        self._ensure_browser()
        skip_slugs = skip_slugs or set()
        all_companies: Dict[str, dict] = {}  # slug → company

        for query in STARTUP_QUERIES:
            console.print(f"[dim]  Startups '{query}'...[/dim]")
            found = self._search_query(query, location)
            for co in found:
                slug = co.get("slug", "")
                if slug and slug not in all_companies and slug not in skip_slugs:
                    all_companies[slug] = co
            time.sleep(0.3)
            # Stop dès qu'on a assez (buffer 2x pour laisser de la marge)
            if len(all_companies) >= max_companies * 2:
                break

        result = list(all_companies.values())[:max_companies]
        console.print(f"[green]WTTJ Startups → {len(result)} nouvelles boîtes[/green]")
        return result

    def _search_query(self, query: str, location: str) -> List[Dict]:
        """Charge la page company search et extrait les cards."""
        companies: List[Dict] = []
        ctx  = self._new_context()
        page = ctx.new_page()

        # Interception Algolia pour récupérer les données structurées
        algolia_companies: List[Dict] = []

        def on_response(resp):
            if resp.status != 200 or "algolia" not in resp.url:
                return
            try:
                body = resp.json()
                hits = body.get("hits", [])
                if not hits and "results" in body:
                    for r in body.get("results", []):
                        hits.extend(r.get("hits", []))
                for h in hits:
                    slug = h.get("slug") or h.get("reference", "")
                    if not slug:
                        continue
                    algolia_companies.append({
                        "slug":        slug,
                        "name":        h.get("name", ""),
                        "description": h.get("description", h.get("summary", "")),
                        "size":        h.get("nb_employees", h.get("size", "")),
                        "industry":    h.get("sector", h.get("industry", "")),
                        "tags":        h.get("tags", []),
                        "website":     h.get("website", ""),
                        "url":         f"{WTTJ_BASE}/fr/companies/{slug}",
                    })
            except Exception:
                pass

        page.on("response", on_response)

        encoded_q = query.replace(" ", "%20")
        url = (f"{WTTJ_COMPANIES}"
               f"?query={encoded_q}"
               f"&aroundQuery={location.replace(' ', '%20')}"
               f"&{_SIZE_PARAMS}")

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
        except Exception:
            pass

        time.sleep(1.5)
        self._handle_modal(page)
        time.sleep(1.5)

        # Scroll pour charger les cards
        for _ in range(2):
            try: page.evaluate("window.scrollBy(0, window.innerHeight)")
            except Exception: break
            time.sleep(0.5)
        time.sleep(0.8)

        # Priorité : données Algolia (plus complètes)
        if algolia_companies:
            companies = algolia_companies
        else:
            # Fallback : extraction DOM des cards company
            companies = self._dom_extract_companies(page)

        try: ctx.close()
        except Exception: pass
        return companies

    @staticmethod
    def _dom_extract_companies(page) -> List[Dict]:
        """Fallback DOM si Algolia ne répond pas."""
        companies = []
        try:
            links = page.query_selector_all("a[href*='/fr/companies/']")
            for link in links:
                try:
                    href = link.get_attribute("href") or ""
                    m = re.search(r"/companies/([^/?#]+)$", href)
                    if not m:
                        continue
                    slug = m.group(1)
                    if slug in ("", "explore"):
                        continue
                    name_el = link.query_selector("h2,h3,[class*='name'],[class*='Name']")
                    name    = name_el.inner_text().strip() if name_el else slug
                    desc_el = link.query_selector("p,[class*='desc'],[class*='Desc']")
                    desc    = desc_el.inner_text().strip() if desc_el else ""
                    companies.append({
                        "slug":        slug,
                        "name":        name,
                        "description": desc,
                        "size":        "",
                        "industry":    "",
                        "tags":        [],
                        "website":     "",
                        "url":         f"https://www.welcometothejungle.com/fr/companies/{slug}",
                    })
                except Exception:
                    continue
        except Exception:
            pass
        return companies

    # ── Vérifie qu'une page entreprise est vivante ────────────────────────────

    def is_alive(self, slug: str) -> bool:
        """
        Charge /fr/companies/{slug} et vérifie qu'il ne renvoie pas une
        page d'erreur (404, 504, "It's not you. It's us.").
        Rapide : pas d'extraction de données.
        """
        self._ensure_browser()
        ctx  = self._new_context()
        page = ctx.new_page()
        url  = f"{WTTJ_BASE}/fr/companies/{slug}"
        alive = True
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            time.sleep(1.2)
            status = resp.status if resp else 0
            dead = page.evaluate("""() => {
                var b = document.body ? document.body.innerText : '';
                var t = document.title || '';
                return (
                    t.includes('404') || t.includes('504') ||
                    b.includes("It's not you. It's us") ||
                    (b.includes('Sorry') && b.includes('went wrong'))
                );
            }""")
            if status >= 400 or dead:
                alive = False
        except Exception:
            pass   # timeout = on garde par sécurité
        try: ctx.close()
        except Exception: pass
        return alive

    # ── Vérifie si la candidature spontanée est possible ─────────────────────

    def check_apply_options(self, slug: str) -> Dict:
        """
        Charge la page entreprise et vérifie les options de candidature.
        Retourne {'has_spontaneous': bool, 'has_jobs': bool, 'apply_url': str}
        """
        self._ensure_browser()
        ctx  = self._new_context()
        page = ctx.new_page()
        url  = f"{WTTJ_BASE}/fr/companies/{slug}"
        result = {"has_spontaneous": False, "has_jobs": False, "apply_url": ""}
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            time.sleep(1.5)
            self._handle_modal(page)
            time.sleep(0.8)

            info = page.evaluate("""() => {
                var text = document.body.innerText || '';
                var links = Array.from(document.querySelectorAll('a[href]'));

                // Cherche un lien/bouton candidature spontanée
                var spontKeywords = ['spontan', 'candidature spontanée', 'open application',
                                     'postuler spontanément', 'spontaneous'];
                var hasSpontan = spontKeywords.some(k =>
                    text.toLowerCase().includes(k.toLowerCase())
                );
                var spontUrl = '';
                var spontLink = links.find(a =>
                    spontKeywords.some(k => (a.textContent + a.href).toLowerCase().includes(k))
                );
                if (spontLink) spontUrl = spontLink.href;

                // Cherche des offres d'emploi listées
                var jobKeywords = ['jobs', 'offres', 'postes', '/jobs/', '/offres/'];
                var hasJobs = (
                    document.querySelectorAll('[data-testid*="job"], .jobs-list, [class*="JobCard"]').length > 0 ||
                    jobKeywords.some(k => text.toLowerCase().includes(k))
                );

                return { hasSpontan, spontUrl, hasJobs };
            }""")

            result["has_spontaneous"] = info.get("hasSpontan", False)
            result["has_jobs"]        = info.get("hasJobs", False)
            result["apply_url"]       = info.get("spontUrl", "")
        except Exception:
            pass
        try: ctx.close()
        except Exception: pass
        return result

    # ── Profil complet d'une entreprise ──────────────────────────────────────

    def get_company_profile(self, slug: str) -> Dict:
        """
        Charge la page /fr/companies/{slug} et extrait toutes les infos.
        Retourne un dict enrichi avec mission, valeurs, stack, taille, etc.
        """
        self._ensure_browser()
        ctx  = self._new_context()
        page = ctx.new_page()

        profile = {"slug": slug, "url": f"{WTTJ_BASE}/fr/companies/{slug}"}
        api_data: Dict = {}

        def on_response(resp):
            nonlocal api_data
            if resp.status != 200:
                return
            url = resp.url
            if f"/companies/{slug}" not in url and slug not in url:
                return
            try:
                body = resp.json()
                if isinstance(body, dict) and (
                    body.get("name") or body.get("description")
                    or (body.get("data") or {}).get("name")
                ):
                    api_data = body.get("data", body)
            except Exception:
                pass

        page.on("response", on_response)

        try:
            page.goto(profile["url"], wait_until="domcontentloaded", timeout=20_000)
        except Exception:
            pass

        time.sleep(1.2)
        self._handle_modal(page)
        time.sleep(1)

        # ── Détecte les pages mortes (404 / 504 / "It's us") ─────────────────
        try:
            is_dead = page.evaluate("""() => {
                var title = document.title || '';
                var body  = document.body ? document.body.innerText : '';
                return (
                    title.includes('404') || title.includes('504') ||
                    body.includes("It's not you. It's us") ||
                    body.includes('Sorry') && body.includes('went wrong') ||
                    document.querySelector('h1[class*="error"], [class*="error-page"]') !== null
                );
            }""")
            if is_dead:
                console.print(f"[dim]    ⚠ Page morte ({slug}) — ignorée[/dim]")
                profile["_dead"] = True
                try: ctx.close()
                except Exception: pass
                return profile
        except Exception:
            pass

        # Extraction depuis __NEXT_DATA__
        try:
            raw = page.evaluate("""() => {
                var pp = ((window.__NEXT_DATA__ || {}).props || {}).pageProps || {};
                var co = pp.company || pp.organization || pp.data || {};
                return Object.keys(co).length ? JSON.stringify(co) : null;
            }""")
            if raw:
                nd = json.loads(raw)
                profile.update({
                    "name":        nd.get("name", ""),
                    "description": nd.get("description", nd.get("summary", nd.get("pitch", ""))),
                    "mission":     nd.get("mission", nd.get("why_join_us", "")),
                    "size":        nd.get("nb_employees", nd.get("size", "")),
                    "industry":    nd.get("sector", nd.get("industry", "")),
                    "founded":     nd.get("founded_at", nd.get("creation_year", "")),
                    "website":     nd.get("website", ""),
                    "tags":        nd.get("tags", []),
                    "values":      nd.get("values", []),
                })
        except Exception:
            pass

        # Fallback DOM si __NEXT_DATA__ vide
        if not profile.get("name"):
            try:
                h1 = page.query_selector("h1")
                if h1:
                    profile["name"] = h1.inner_text().strip()
                for sel in ["[class*='description']", "[class*='mission']",
                            "[class*='about']", "main p"]:
                    el = page.query_selector(sel)
                    if el:
                        txt = el.inner_text().strip()
                        if len(txt) > 30:
                            profile["description"] = txt
                            break
            except Exception:
                pass

        # Merge API data si dispo
        if api_data and not profile.get("description"):
            profile.update({
                "name":        api_data.get("name", profile.get("name", "")),
                "description": api_data.get("description", api_data.get("summary", "")),
                "size":        api_data.get("nb_employees", ""),
            })

        try: ctx.close()
        except Exception: pass
        return profile

    def __del__(self):
        self._close_browser()
