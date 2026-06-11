"""
Indeed job scraper — utilise Playwright (navigateur headless) pour contourner
les protections anti-bot d'Indeed.

Pagination via start=0, 10, 20... (10 offres par page).
Mots-clés organisés en tiers comme LinkedIn pour élargir progressivement.
"""

import re
import time
import random
from typing import List, Dict, Tuple
from rich.console import Console

console = Console()

INDEED_BASE   = "https://fr.indeed.com"
INDEED_SEARCH = "https://fr.indeed.com/jobs"

# Tiers de requetes -- meme logique que LinkedIn, plus large
INDEED_TIERS = [
    # Tier 1 -- coeur ops/strategy
    [
        "ops manager", "operations manager", "head of ops", "chief of staff",
        "business operations", "revenue operations", "responsable operations",
        "directeur operations", "head of strategy", "strategy manager",
    ],
    # Tier 2 -- product + growth + bizdev
    [
        "product operations", "growth operations", "product manager",
        "operations lead", "revops", "bizdev manager",
        "business development manager", "responsable business development",
        "head of growth", "growth manager",
    ],
    # Tier 3 -- roles adjacents pertinents
    [
        "head of product", "COO", "project manager", "programme manager",
        "transformation manager", "general manager", "country manager",
        "partnerships manager", "marketplace manager", "platform manager",
        "responsable partenariats", "responsable transformation",
    ],
]

_CONSENT_INIT = """
(function(){
    var ls = {
        'indeed_gdpr_consent': 'true',
        'ccpa-notice-viewed': 'true',
    };
    try { for (var k in ls) localStorage.setItem(k, ls[k]); } catch(e) {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
})();
"""

_KILL_MODAL = """
(function(){
    var labels = ['Tout accepter', 'Accept all', 'Accepter', 'OK', 'Accepter et continuer',
                  "J'accepte", 'Continuer', 'Agree'];
    var btns = Array.from(document.querySelectorAll('button,[role=button]'));
    for (var i = 0; i < labels.length; i++) {
        var b = btns.find(function(b){
            return (b.textContent || '').trim().toLowerCase().startsWith(labels[i].toLowerCase());
        });
        if (b && b.offsetParent) { b.click(); return; }
    }
    // Supprime les overlays fixes
    document.querySelectorAll('*').forEach(function(el) {
        var s = getComputedStyle(el);
        if ((s.position === 'fixed' || s.position === 'sticky') && parseInt(s.zIndex || 0) > 100)
            el.remove();
    });
    document.body.style.overflow = 'auto';
})();
"""


class IndeedScraper:
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
            args=[
                "--no-sandbox", "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
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
            locale="fr-FR",
            timezone_id="Europe/Paris",
            viewport={"width": 1440, "height": 900},
            java_script_enabled=True,
            bypass_csp=True,
        )
        ctx.add_init_script(_CONSENT_INIT)
        return ctx

    def _handle_modal(self, page):
        """Ferme les bandeaux de consentement Indeed."""
        for selector in [
            "button:has-text('Tout accepter')",
            "button:has-text('Accept all')",
            "button:has-text('Accepter')",
            "button[id*='onetrust-accept']",
            "#onetrust-accept-btn-handler",
            "button:has-text('Continuer')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1_500):
                    btn.click()
                    time.sleep(0.8)
                    return
            except Exception:
                pass
        try:
            page.evaluate(_KILL_MODAL)
        except Exception:
            pass

    # ── Recherche de base ─────────────────────────────────────────────────────

    def search(self, query: str, location: str = "Paris",
               max_results: int = 10) -> List[Dict]:
        """Scrape Indeed via Playwright — simple, sans filtre seen."""
        self._ensure_browser()
        results = []
        start   = 0
        batch   = 10

        while len(results) < max_results:
            jobs = self._fetch_page(query, location, start)
            if not jobs:
                break
            results.extend(jobs)
            start += batch
            time.sleep(random.uniform(2, 3))

        self._close_browser()
        return results[:max_results]

    # ── Recherche avec filtre "déjà vus" + pagination mémorisée ──────────────

    def search_new(self, query: str, seen: set,
                   location: str = "Paris",
                   target_new: int = 10,
                   max_pages: int = 8,
                   exclude_keywords: list = None,
                   start_offset: int = 0,
                   recent_days: int = 0) -> Tuple[List[Dict], int]:
        """
        Pagine Indeed depuis start_offset jusqu'à trouver target_new offres
        absentes de seen.

        Retourne (new_jobs, next_start) pour persister la position.
        """
        self._ensure_browser()
        exclude_keywords = [k.lower() for k in (exclude_keywords or [])]
        new_jobs: List[Dict] = []
        start       = start_offset
        batch       = 10
        pages_tried = 0
        empty_pages = 0
        skipped     = 0

        while len(new_jobs) < target_new and pages_tried < max_pages:
            batch_jobs = self._fetch_page(query, location, start, recent_days=recent_days)

            if not batch_jobs:
                empty_pages += 1
                if empty_pages >= 2:
                    break
                start += batch
                pages_tried += 1
                time.sleep(random.uniform(3, 5))
                continue

            empty_pages = 0

            for job in batch_jobs:
                url_key = job.get("url") or f"{job.get('title','')}|{job.get('company','')}".lower()
                if url_key in seen:
                    skipped += 1
                    continue
                title_low = job.get("title", "").lower()
                if any(ex in title_low for ex in exclude_keywords):
                    continue
                new_jobs.append(job)
                if len(new_jobs) >= target_new:
                    break

            start += batch
            pages_tried += 1
            time.sleep(random.uniform(2, 4))

        if skipped:
            console.print(f"  [dim]↳ {skipped} offres déjà vues sautées (Indeed start={start})[/dim]")

        return new_jobs, start

    # ── Fetch d'une page via Playwright ──────────────────────────────────────

    def _fetch_page(self, query: str, location: str, start: int,
                    recent_days: int = 0) -> List[Dict]:
        """Charge une page Indeed avec Playwright et retourne les jobs parsés."""
        ctx  = self._new_context()
        page = ctx.new_page()
        jobs = []

        # fromage=N : offres des N derniers jours (Indeed parametre natif)
        fromage = f"&fromage={recent_days}" if recent_days > 0 else ""
        url = (
            f"{INDEED_SEARCH}"
            f"?q={query.replace(' ', '+')}"
            f"&l={location.replace(' ', '+')}"
            f"&start={start}"
            f"{fromage}"
        )

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
        except Exception as e:
            console.print(f"[dim]Indeed goto error: {e}[/dim]")
            try: ctx.close()
            except Exception: pass
            return []

        time.sleep(random.uniform(1.5, 2.5))
        self._handle_modal(page)
        time.sleep(1)

        # Scroll léger pour déclencher le lazy-load
        try:
            page.evaluate("window.scrollBy(0, 400)")
            time.sleep(0.5)
            page.evaluate("window.scrollBy(0, 400)")
            time.sleep(0.5)
        except Exception:
            pass

        # Vérifie si Indeed bloque (captcha, page d'erreur)
        try:
            blocked = page.evaluate("""() => {
                var t = document.title || '';
                var b = document.body ? document.body.innerText : '';
                return (
                    t.includes('Robot') || t.includes('captcha') ||
                    b.includes('unusual traffic') ||
                    b.includes('not a robot') ||
                    document.querySelector('form[action*="captcha"]') !== null
                );
            }""")
            if blocked:
                console.print("[yellow]⚠️  Indeed détecte un bot — captcha actif[/yellow]")
                try: ctx.close()
                except Exception: pass
                return []
        except Exception:
            pass

        # Extraction des cartes
        jobs = self._extract_jobs_from_page(page, query)

        try: ctx.close()
        except Exception: pass
        return jobs

    # ── Extraction DOM ────────────────────────────────────────────────────────

    def _extract_jobs_from_page(self, page, query: str) -> List[Dict]:
        """Extrait les offres depuis la page Indeed chargée par Playwright."""
        jobs = []
        try:
            raw = page.evaluate("""() => {
                var results = [];
                // Indeed 2024 : cartes avec data-jk
                var cards = Array.from(document.querySelectorAll('[data-jk]'));
                // Fallback : job cards classiques
                if (!cards.length) {
                    cards = Array.from(document.querySelectorAll(
                        '.job_seen_beacon, .tapItem, [class*="jobCard"], [class*="JobCard"]'
                    ));
                }

                cards.forEach(function(card) {
                    try {
                        var jk = card.getAttribute('data-jk') || '';

                        // Titre
                        var titleEl = (
                            card.querySelector('[data-testid="jobTitle"] span') ||
                            card.querySelector('h2.jobTitle span') ||
                            card.querySelector('.jobTitle span') ||
                            card.querySelector('h2 a span') ||
                            card.querySelector('h2 span')
                        );
                        var title = titleEl ? titleEl.innerText.trim() : '';
                        if (!title) return;

                        // Entreprise
                        var coEl = (
                            card.querySelector('[data-testid="company-name"]') ||
                            card.querySelector('.companyName') ||
                            card.querySelector('[class*="companyName"]') ||
                            card.querySelector('[class*="company"]')
                        );
                        var company = coEl ? coEl.innerText.trim() : 'N/A';

                        // Lieu
                        var locEl = (
                            card.querySelector('[data-testid="text-location"]') ||
                            card.querySelector('.companyLocation') ||
                            card.querySelector('[class*="location"]')
                        );
                        var location = locEl ? locEl.innerText.trim() : '';

                        // Salaire
                        var salEl = (
                            card.querySelector('[data-testid="attribute_snippet_testid"]') ||
                            card.querySelector('.salary-snippet-container') ||
                            card.querySelector('[class*="salary"]') ||
                            card.querySelector('[class*="Salary"]')
                        );
                        var salary = salEl ? salEl.innerText.trim() : '';

                        // Date
                        var dateEl = (
                            card.querySelector('[data-testid="myJobsStateDate"]') ||
                            card.querySelector('.date') ||
                            card.querySelector('[class*="date"]') ||
                            card.querySelector('span[class*="Posted"]')
                        );
                        var date = dateEl ? dateEl.innerText.trim() : '';

                        // URL
                        var url = jk ? ('https://fr.indeed.com/viewjob?jk=' + jk) : '';
                        if (!url) {
                            var aEl = card.querySelector('a[href*="/rc/clk"], a[href*="viewjob"], h2 a');
                            if (aEl) {
                                var href = aEl.getAttribute('href') || '';
                                if (href.startsWith('/')) href = 'https://fr.indeed.com' + href;
                                url = href;
                            }
                        }

                        results.push({
                            id: jk, title: title, company: company,
                            location: location, url: url,
                            salary: salary, published_at: date
                        });
                    } catch(e) {}
                });
                return results;
            }""")

            for item in (raw or []):
                if not item.get("title"):
                    continue
                jobs.append({
                    "id":           item.get("id", ""),
                    "title":        item.get("title", ""),
                    "company":      item.get("company", "N/A"),
                    "location":     item.get("location", "Paris"),
                    "url":          item.get("url", ""),
                    "salary":       item.get("salary", ""),
                    "contract":     "",
                    "description":  "",
                    "platform":     "indeed",
                    "query":        query,
                    "published_at": item.get("published_at", ""),
                })
        except Exception as e:
            console.print(f"[dim]Indeed extraction error: {e}[/dim]")

        return jobs

    # ── Description complète ─────────────────────────────────────────────────

    def fetch_description(self, job_id: str) -> str:
        """Récupère la description complète d'une offre via son ID Indeed."""
        if not job_id:
            return ""
        self._ensure_browser()
        ctx  = self._new_context()
        page = ctx.new_page()
        desc = ""

        try:
            url = f"https://fr.indeed.com/viewjob?jk={job_id}"
            page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            time.sleep(1.5)
            self._handle_modal(page)
            time.sleep(0.8)

            desc = page.evaluate("""() => {
                var el = (
                    document.querySelector('#jobDescriptionText') ||
                    document.querySelector('[data-testid="jobDescription"]') ||
                    document.querySelector('.jobsearch-jobDescriptionText') ||
                    document.querySelector('[class*="description"]')
                );
                return el ? el.innerText.trim() : '';
            }""") or ""
        except Exception as e:
            console.print(f"[yellow]Indeed description error: {e}[/yellow]")
        finally:
            try: ctx.close()
            except Exception: pass

        return desc

    def __del__(self):
        self._close_browser()
