"""
Welcome to the Jungle scraper — Playwright, 1 phase directe

Charge /fr/jobs?query=... et attend que les cards d'offres soient
rendues en JS, puis les extrait depuis le DOM.
Pas de détour par les entreprises.
"""

import json
import re
import time
import unicodedata
from typing import List, Dict
from rich.console import Console

console = Console()

WTTJ_BASE = "https://www.welcometothejungle.com"
WTTJ_JOBS = "https://www.welcometothejungle.com/fr/jobs"

# Sélecteurs de job cards sur la page de recherche WTTJ
# Les offres ont toutes un lien /fr/companies/{co}/jobs/{slug}
_JOB_LINK_SEL = "a[href*='/companies/'][href*='/jobs/']"

_CONSENT_INIT = """
(function(){
    var ls={
        'wttj_cookie_consent':'true','wttj_cookies_accepted':'all',
        'cookie_consent':'accepted','cookies_accepted':'true',
        'OptanonAlertBoxClosed':'2024-01-15T10:00:00.000Z',
        'axeptio_cookies':'{"$$complete":true}',
    };
    try{ for(var k in ls) localStorage.setItem(k,ls[k]); }catch(e){}
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    window.chrome=window.chrome||{runtime:{}};
})();
"""

_KILL_MODAL = """
(function(){
    var labels=['Tout accepter','Accepter tout','Accepter','OK pour moi','Accept all'];
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


class WTTJScraper:
    def __init__(self):
        self._browser = None
        self._pw_ctx  = None

    # ── Browser ───────────────────────────────────────────────────────────────

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
            {"name": "OptanonAlertBoxClosed", "value": "2024-01-15T10:00:00.000Z",
             "domain": ".welcometothejungle.com", "path": "/"},
        ])
        return ctx

    def _handle_modal(self, page) -> None:
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

    # ════════════════════════════════════════════════════════════════════════
    # SEARCH — charge la page de résultats et attend les job cards
    # ════════════════════════════════════════════════════════════════════════

    def search(self, query: str, location: str = "Paris",
               max_results: int = 10, recent_days: int = 0) -> List[Dict]:
        self._ensure_browser()
        console.print(f"[dim]WTTJ → '{query}'[/dim]")

        ctx  = self._new_context()
        page = ctx.new_page()

        encoded_q = query.replace(" ", "%20")
        url = (f"{WTTJ_JOBS}"
               f"?query={encoded_q}"
               f"&aroundQuery={location.replace(' ', '%20')}"
               f"&refinementList%5Bcontract_type%5D%5B%5D=FULL_TIME")

        # ── Chargement ───────────────────────────────────────────────────────
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as e:
            console.print(f"[yellow]  goto: {e}[/yellow]")

        # Ferme le modal si présent
        time.sleep(1.5)
        self._handle_modal(page)

        # ── Attente des job cards (JS rendering) ─────────────────────────────
        # WTTJ charge les cards en client-side JS après domcontentloaded
        cards_found = False
        for timeout in [6_000, 4_000]:
            try:
                page.wait_for_selector(_JOB_LINK_SEL, timeout=timeout)
                cards_found = True
                break
            except Exception:
                # Peut-être le modal bloque — on réessaie après le killer JS
                self._handle_modal(page)

        if not cards_found:
            console.print("[yellow]  cards non trouvées après attente[/yellow]")

        # Scroll pour charger plus de résultats
        for _ in range(4):
            try: page.evaluate("window.scrollBy(0, window.innerHeight)")
            except Exception: break
            time.sleep(0.5)

        # Attente finale après scroll
        try:
            page.wait_for_selector(_JOB_LINK_SEL, timeout=4_000)
        except Exception:
            pass
        time.sleep(0.8)

        # ── Extraction des cards ──────────────────────────────────────────────
        jobs_raw = self._extract_cards(page)

        try: ctx.close()
        except Exception: pass

        if not jobs_raw:
            console.print(f"[yellow]WTTJ → 0 offres ('{query}')[/yellow]")
            return []

        console.print(f"[dim]  {len(jobs_raw)} cards extraites[/dim]")

        # Normalise et déduplique
        seen_urls: set = set()
        result = []
        for raw in jobs_raw:
            j = self._normalize(raw, location)
            u = j.get("url") or j.get("title", "")
            if u and u not in seen_urls:
                seen_urls.add(u)
                result.append(j)

        result = result[:max_results]
        console.print(f"[green]WTTJ → {len(result)} offres[/green]")
        return result

    # ── Extraction des cards depuis le DOM ────────────────────────────────────

    @staticmethod
    def _extract_cards(page) -> List[dict]:
        """
        Extrait les offres depuis les links /companies/{co}/jobs/{slug}.
        Chaque lien = une offre. On remonte au container parent pour le titre.
        """
        jobs = []
        try:
            links = page.query_selector_all(_JOB_LINK_SEL)
            seen_hrefs: set = set()

            for link in links:
                try:
                    href = link.get_attribute("href") or ""
                    if not href or href in seen_hrefs:
                        continue
                    # Filtre : exclure les liens qui pointent vers la page company
                    # (sans /jobs/{slug} après)
                    m = re.search(r"/companies/([^/]+)/jobs/([^/?#]+)", href)
                    if not m:
                        continue
                    seen_hrefs.add(href)

                    co_slug = m.group(1)
                    j_slug  = m.group(2)
                    full_url = href if href.startswith("http") else WTTJ_BASE + href

                    # Cherche le titre dans le lien ou son conteneur
                    title = ""
                    # 1) texte du lien lui-même s'il contient un h2/h3
                    for sel in ["h2", "h3", "[class*='title']", "[class*='Title']",
                                "[class*='name']"]:
                        el = link.query_selector(sel)
                        if el:
                            t = el.inner_text().strip()
                            if t and len(t) > 2:
                                title = t
                                break
                    # 2) sinon remonte au li/article parent
                    if not title:
                        parent = link.evaluate_handle(
                            "el => el.closest('li') || el.closest('article') "
                            "|| el.closest('[class*=\"Card\"]') || el.parentElement"
                        )
                        if parent:
                            for sel in ["h2", "h3", "[class*='title']", "[class*='Title']"]:
                                el = parent.query_selector(sel)
                                if el:
                                    t = el.inner_text().strip()
                                    if t and len(t) > 2:
                                        title = t
                                        break
                    # 3) texte brut du lien en dernier recours
                    if not title:
                        title = link.inner_text().strip()[:100]

                    if not title:
                        continue

                    # Company name
                    company = ""
                    parent_el = link.evaluate_handle(
                        "el => el.closest('li') || el.closest('article') "
                        "|| el.closest('[class*=\"Card\"]') || el.parentElement"
                    )
                    if parent_el:
                        for sel in ["[class*='company']", "[class*='Company']",
                                    "[class*='organization']", "span + span", "p"]:
                            el = parent_el.query_selector(sel)
                            if el:
                                t = el.inner_text().strip()
                                if t and len(t) > 1 and t != title:
                                    company = t
                                    break

                    jobs.append({
                        "title":        title,
                        "slug":         j_slug,
                        "organization": {"name": company or co_slug, "slug": co_slug},
                        "url":          full_url,
                    })
                except Exception:
                    continue

        except Exception as e:
            console.print(f"[yellow]  extract error: {e}[/yellow]")

        return jobs

    # ── Normalisation ─────────────────────────────────────────────────────────

    def _normalize(self, raw: dict, location: str = "Paris") -> Dict:
        def g(*keys):
            for k in keys:
                v = raw.get(k)
                if v: return v
            return ""

        org = raw.get("organization", {})
        if not isinstance(org, dict):
            org = {}
        company  = org.get("name", "") or org.get("title", "")
        slug_org = org.get("slug", "")

        title = g("title", "job_title", "name")
        slug  = g("slug", "reference", "id", "objectID")
        url   = (raw.get("url") or
                 (f"{WTTJ_BASE}/fr/companies/{slug_org}/jobs/{slug}"
                  if slug_org and slug else ""))

        salary     = raw.get("salary_minimum") or raw.get("salary_min", "")
        salary_max = raw.get("salary_maximum") or raw.get("salary_max", "")
        if salary and salary_max:
            salary = f"{salary}–{salary_max}"

        desc = g("description", "content", "body", "summary")
        if desc and "<" in str(desc):
            desc = re.sub(r"<[^>]+>", " ", str(desc)).strip()

        return {
            "id":           str(g("id", "objectID", "uuid", "reference")),
            "title":        title,
            "company":      company,
            "url":          url,
            "location":     g("office", "location", "city") or location,
            "contract":     g("contract_type", "contractType", "contract"),
            "salary":       str(salary) if salary else "",
            "description":  str(desc) if desc else "",
            "platform":     "wttj",
            "published_at": str(g("published_at", "publishedAt", "created_at")) or "",
            "raw":          raw,
        }

    # ── Description complète ──────────────────────────────────────────────────

    def fetch_description(self, url: str) -> str:
        if not url:
            return ""
        self._ensure_browser()
        ctx  = self._new_context()
        page = ctx.new_page()
        desc = ""

        def on_resp(r):
            nonlocal desc
            if r.status == 200 and "/jobs/" in r.url:
                try:
                    body  = r.json()
                    job   = (body.get("job") or
                             (body.get("data") or {}).get("job") or {})
                    raw_d = job.get("description", job.get("content", ""))
                    if raw_d:
                        desc = re.sub(r"<[^>]+>", "\n", str(raw_d)).strip()
                except Exception:
                    pass

        page.on("response", on_resp)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=20_000)
        except Exception:
            pass
        time.sleep(1)
        self._handle_modal(page)

        if not desc:
            for sel in ["[data-testid='job-description']",
                        "[class*='JobDescription']",
                        "[class*='description']",
                        "main"]:
                el = page.query_selector(sel)
                if el:
                    txt = el.inner_text().strip()
                    if len(txt) > 80:
                        desc = txt
                        break

        try: ctx.close()
        except Exception: pass
        return desc

    def __del__(self):
        self._close_browser()
