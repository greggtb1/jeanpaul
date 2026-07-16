"""
HelloWork job scraper — pages de recherche SSR, parse HTML + JSON-LD sur la fiche.
"""

import json
import re
import time
import random
from html import unescape
from typing import List, Dict, Tuple
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup
from rich.console import Console

from utils.helpers import is_job_seen

console = Console()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
}

HW_BASE = "https://www.hellowork.com"
HW_SEARCH = f"{HW_BASE}/fr-fr/emploi/recherche.html"


class HelloWorkScraper:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def search(self, query: str, location: str = "Paris", max_results: int = 10) -> List[Dict]:
        results: List[Dict] = []
        page = 1
        while len(results) < max_results:
            jobs = self._fetch_page(query, location, page)
            if not jobs:
                break
            results.extend(jobs)
            page += 1
            time.sleep(random.uniform(1.0, 2.0))
        return results[:max_results]

    def search_new(
        self,
        query: str,
        seen: set,
        location: str = "Paris",
        target_new: int = 10,
        max_pages: int = 8,
        exclude_keywords: list = None,
        start_offset: int = 0,
        recent_days: int = 0,
    ) -> Tuple[List[Dict], int]:
        exclude_keywords = [k.lower() for k in (exclude_keywords or [])]
        new_jobs: List[Dict] = []
        page = max(1, (start_offset // 20) + 1) if start_offset else 1
        pages_tried = 0
        empty_pages = 0
        skipped = 0

        while len(new_jobs) < target_new and pages_tried < max_pages:
            batch_jobs = self._fetch_page(query, location, page, recent_days=recent_days)
            if not batch_jobs:
                empty_pages += 1
                if empty_pages >= 2:
                    break
                page += 1
                pages_tried += 1
                time.sleep(random.uniform(1.5, 2.5))
                continue

            empty_pages = 0
            for job in batch_jobs:
                if is_job_seen(job, seen):
                    skipped += 1
                    continue
                title_low = job.get("title", "").lower()
                if any(ex in title_low for ex in exclude_keywords):
                    continue
                new_jobs.append(job)
                if len(new_jobs) >= target_new:
                    break

            page += 1
            pages_tried += 1
            time.sleep(random.uniform(1.0, 2.0))

        if skipped:
            console.print(f"  [dim]↳ {skipped} offres déjà vues sautées (HelloWork p={page})[/dim]")

        return new_jobs, (page - 1) * 20

    def _fetch_page(
        self, query: str, location: str, page: int, recent_days: int = 0
    ) -> List[Dict]:
        date_param = self._date_param(recent_days)
        url = (
            f"{HW_SEARCH}?k={quote_plus(query)}"
            f"&l={quote_plus(location)}"
            f"&st=relevance&d={date_param}&p={page}"
        )
        try:
            resp = self.session.get(url, timeout=20)
            resp.raise_for_status()
        except requests.RequestException as e:
            console.print(f"[dim]HelloWork error ({query}): {e}[/dim]")
            return []

        return self._parse_search_page(resp.text, query)

    @staticmethod
    def _date_param(recent_days: int) -> str:
        if recent_days <= 1:
            return "1"
        if recent_days <= 3:
            return "3"
        if recent_days <= 7:
            return "7"
        return "all"

    def _parse_search_page(self, html: str, query: str) -> List[Dict]:
        soup = BeautifulSoup(html, "lxml")
        jobs: List[Dict] = []

        for li in soup.select("li[data-id-storage-item-id]"):
            job_id = li.get("data-id-storage-item-id", "").strip()
            if not job_id:
                continue

            hide_form = li.select_one('form[action*="hideoffermodalframeview"]')
            title = ""
            company = ""
            if hide_form:
                title_in = hide_form.select_one('input[name="title"]')
                company_in = hide_form.select_one('input[name="company"]')
                title = unescape(title_in.get("value", "").strip()) if title_in else ""
                company = unescape(company_in.get("value", "").strip()) if company_in else ""

            if not title:
                title_el = li.select_one('[data-cy="offerTitle"] p.typo-l, [data-cy="offerTitle"] h3 p')
                if title_el:
                    title = title_el.get_text(strip=True)

            if not company:
                company_el = li.select_one('[data-cy="offerTitle"] p.typo-s')
                if company_el:
                    company = company_el.get_text(strip=True)

            if not title:
                continue

            loc_el = li.select_one('[data-cy="localisationCard"]')
            contract_el = li.select_one('[data-cy="contractCard"]')
            date_el = li.select_one(".text-grey-500")

            job_url = f"{HW_BASE}/fr-fr/emplois/{job_id}.html"
            jobs.append({
                "id": job_id,
                "title": title,
                "company": company or "N/A",
                "location": loc_el.get_text(strip=True) if loc_el else "",
                "url": job_url,
                "salary": "",
                "contract": contract_el.get_text(strip=True) if contract_el else "",
                "description": "",
                "platform": "hellowork",
                "query": query,
                "published_at": date_el.get_text(strip=True) if date_el else "",
            })

        return jobs

    def fetch_description(self, job_id: str) -> str:
        if not job_id:
            return ""
        job_id = str(job_id).strip()
        if job_id.startswith("http"):
            match = re.search(r"/emplois/(\d+)\.html", job_id)
            if not match:
                return ""
            job_id = match.group(1)

        url = f"{HW_BASE}/fr-fr/emplois/{job_id}.html"
        try:
            resp = self.session.get(url, timeout=20)
            resp.raise_for_status()
        except requests.RequestException as e:
            console.print(f"[yellow]HelloWork description error: {e}[/yellow]")
            return ""

        for script in BeautifulSoup(resp.text, "lxml").select('script[type="application/ld+json"]'):
            try:
                data = json.loads(script.string or "")
            except (json.JSONDecodeError, TypeError):
                continue
            posting = self._find_job_posting(data)
            if posting and posting.get("description"):
                desc = posting["description"]
                if "<" in desc:
                    desc = BeautifulSoup(desc, "lxml").get_text("\n", strip=True)
                return desc.strip()
        return ""

    @staticmethod
    def _find_job_posting(node):
        if not node:
            return None
        if isinstance(node, list):
            for item in node:
                found = HelloWorkScraper._find_job_posting(item)
                if found:
                    return found
            return None
        if not isinstance(node, dict):
            return None
        jtype = node.get("@type")
        types = jtype if isinstance(jtype, list) else [jtype]
        if any(str(t).lower() == "jobposting" for t in types if t):
            return node
        if "@graph" in node:
            return HelloWorkScraper._find_job_posting(node["@graph"])
        return None
