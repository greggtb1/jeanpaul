"""
LinkedIn job scraper — utilise l'API publique "jobs-guest" de LinkedIn.
Pas besoin de compte, pas de cookies. Limite : ~25 offres par requête.

Pour plus de résultats, on pagine avec start=0, 25, 50...
"""

import time
import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Optional
from rich.console import Console

console = Console()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
}

LI_SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
LI_JOB_BASE = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting"


class LinkedInScraper:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def search(self, query: str, location: str = "Paris", max_results: int = 10, recent_days: int = 0) -> List[Dict]:
        """Scrape les offres LinkedIn via l'API publique guest."""
        results = []
        start = 0
        batch = 25  # LinkedIn retourne 25 par page

        # Filtre LinkedIn par date de publication (r86400 = 24h, r259200 = 3j, r604800 = 7j)
        f_tpr = f"r{recent_days * 86400}" if recent_days > 0 else ""

        while len(results) < max_results:
            params = {
                "keywords": query,
                "location": location,
                "f_TPR": f_tpr,
                "position": 1,
                "pageNum": 0,
                "start": start,
            }

            try:
                resp = self.session.get(LI_SEARCH, params=params, timeout=15)
                if resp.status_code == 429:
                    console.print("[yellow]LinkedIn rate limit — pause 10s...[/yellow]")
                    time.sleep(10)
                    continue
                resp.raise_for_status()
            except requests.RequestException as e:
                console.print(f"[red]LinkedIn request error: {e}[/red]")
                break

            jobs = self._parse_search_page(resp.text, query)
            if not jobs:
                break

            results.extend(jobs)
            start += batch
            time.sleep(3)

        return results[:max_results]

    def _parse_search_page(self, html: str, query: str) -> List[Dict]:
        """Parse le HTML retourné par l'API guest LinkedIn."""
        soup = BeautifulSoup(html, "lxml")
        jobs = []

        for card in soup.select("li"):
            try:
                # Extraire les éléments typiques d'une carte LinkedIn
                title_el = card.select_one(".base-search-card__title, h3")
                company_el = card.select_one(".base-search-card__subtitle, h4, .hidden-nested-link")
                location_el = card.select_one(".job-search-card__location, .base-search-card__metadata span")
                link_el = card.select_one("a[href*='/jobs/view/']")
                job_id_el = card.select_one("[data-entity-urn]")

                if not title_el:
                    continue

                url = ""
                if link_el:
                    url = link_el.get("href", "").split("?")[0]

                job_id = ""
                if job_id_el:
                    urn = job_id_el.get("data-entity-urn", "")
                    job_id = urn.split(":")[-1] if urn else ""

                # Date de publication (attribut datetime sur <time>)
                time_el = card.select_one("time")
                published_at = time_el.get("datetime", "") if time_el else ""

                jobs.append({
                    "id": job_id,
                    "title": title_el.get_text(strip=True),
                    "company": company_el.get_text(strip=True) if company_el else "N/A",
                    "location": location_el.get_text(strip=True) if location_el else "Paris",
                    "url": url,
                    "contract": "",
                    "salary": "",
                    "description": "",
                    "platform": "linkedin",
                    "query": query,
                    "published_at": published_at,
                })
            except Exception:
                continue

        return jobs

    def fetch_description(self, job_id: str) -> str:
        """Récupère la description complète d'une offre LinkedIn via son ID."""
        if not job_id:
            return ""
        try:
            url = f"{LI_JOB_BASE}/{job_id}"
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")

            desc_el = soup.select_one(
                ".description__text, "
                ".show-more-less-html__markup, "
                "[class*='description']"
            )
            if desc_el:
                return desc_el.get_text(separator="\n").strip()

        except Exception as e:
            console.print(f"[yellow]LinkedIn description error: {e}[/yellow]")

        return ""

    def search_new(self, query: str, seen: set,
                   location: str = "Paris",
                   target_new: int = 10,
                   max_pages: int = 8,
                   exclude_keywords: list = None,
                   start_offset: int = 0,
                   recent_days: int = 0) -> tuple:
        """
        Pagine LinkedIn jusqu'à trouver target_new offres absentes de seen.
        Repart depuis start_offset pour ne jamais re-fetcher des pages déjà traitées.

        Retourne (new_jobs, next_start) pour que l'appelant puisse persister
        la position et éviter de recommencer depuis la page 1 au prochain run.
        """
        exclude_keywords = [k.lower() for k in (exclude_keywords or [])]
        new_jobs: List[Dict] = []
        start = start_offset   # <-- repart là où on s'était arrêté
        batch = 25
        pages_tried = 0
        empty_pages = 0
        skipped_seen = 0

        while len(new_jobs) < target_new and pages_tried < max_pages:
            # f_TPR : r86400=24h, r259200=3j, r604800=7j
            f_tpr = f"r{recent_days * 86400}" if recent_days > 0 else ""
            params = {
                "keywords":  query,
                "location":  location,
                "f_TPR":     f_tpr,
                "position":  1,
                "pageNum":   0,
                "start":     start,
            }
            try:
                resp = self.session.get(LI_SEARCH, params=params, timeout=15)
                if resp.status_code == 429:
                    console.print("[yellow]LinkedIn rate limit — pause 15s...[/yellow]")
                    time.sleep(15)
                    continue
                resp.raise_for_status()
            except requests.RequestException as e:
                console.print(f"[dim]LinkedIn error ({query}): {e}[/dim]")
                break

            batch_jobs = self._parse_search_page(resp.text, query)
            if not batch_jobs:
                empty_pages += 1
                if empty_pages >= 2:
                    break   # plus rien à paginer
                start += batch
                pages_tried += 1
                time.sleep(2)
                continue

            empty_pages = 0

            for job in batch_jobs:
                url_key = job.get("url") or f"{job.get('title','')}|{job.get('company','')}".lower()
                if url_key in seen:
                    skipped_seen += 1
                    continue   # déjà vu
                title_low = job.get("title", "").lower()
                if any(ex in title_low for ex in exclude_keywords):
                    continue   # mot exclu
                new_jobs.append(job)
                if len(new_jobs) >= target_new:
                    break

            start += batch
            pages_tried += 1
            time.sleep(3)

        if skipped_seen:
            console.print(f"  [dim]↳ {skipped_seen} offres déjà vues sautées (pagination start={start})[/dim]")

        return new_jobs, start   # next_start permet de reprendre ici au prochain run

    def fetch_description_from_url(self, url: str) -> str:
        """Fetch description depuis une URL complète LinkedIn."""
        if not url:
            return ""
        # Extraire l'ID depuis l'URL
        # Format : /jobs/view/1234567890/
        import re
        match = re.search(r"/jobs/view/(\d+)", url)
        if match:
            return self.fetch_description(match.group(1))
        return ""
