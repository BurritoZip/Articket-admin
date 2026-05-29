"""FestivalLife 스크래퍼 — imweb SSR HTML 파싱"""
import re
from datetime import date
from typing import Any, Optional
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from config import FESTIVALLIFE
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status


class FestivalLifeScraper(BaseScraper):

    def __init__(self):
        super().__init__(FESTIVALLIFE["source_name"])

    def scrape(self) -> list[dict[str, Any]]:
        events = []
        for cat_name, base_url in FESTIVALLIFE["categories"].items():
            cat_events = self._scrape_category(cat_name, base_url)
            events.extend(cat_events)
            print(f"  [FestivalLife:{cat_name}] {len(cat_events)}개 수집")

        # 미래 공연만 필터
        today = date.today()
        upcoming = [e for e in events if e["end_date"] is None or e["end_date"] >= today]
        print(f"  [FestivalLife] 총 {len(upcoming)}개 upcoming 이벤트 수집 (전체 {len(events)}개 중)")

        # dedup
        seen = set()
        unique = []
        for e in upcoming:
            if e["dedup_key"] not in seen:
                seen.add(e["dedup_key"])
                unique.append(e)
        return unique

    def _scrape_category(self, cat_name: str, base_url: str) -> list[dict[str, Any]]:
        events = []
        page = 1
        while True:
            query = urlencode({
                "q": FESTIVALLIFE["list_q"],
                "bmode": "list",
                "t": "board",
                "page": page,
            })
            url = f"{base_url}?{query}"
            try:
                resp = self.get(url)
            except Exception:
                break

            soup = BeautifulSoup(resp.text, "lxml")
            idx_links = soup.select("a[href*='bmode=view'][href*='idx=']")
            if not idx_links:
                break

            for a in idx_links:
                href = a.get("href", "")
                detail_url = href if href.startswith("http") else f"{base_url.rstrip('/')}/{href.lstrip('/')}"
                event = self._parse_detail(detail_url, cat_name)
                if event:
                    events.append(event)

            page += 1
            if page > 50:  # 안전 상한 (약 750개)
                break

        return events

    def _parse_detail(self, url: str, category: str) -> Optional[dict[str, Any]]:
        try:
            resp = self.get(url)
            soup = BeautifulSoup(resp.text, "lxml")

            # 공연명
            title_tag = soup.select_one("h1") or soup.select_one(".board-title") or soup.select_one("title")
            if not title_tag:
                return None
            title = title_tag.get_text(strip=True)
            if len(title) < 2:
                return None

            # 본문 텍스트에서 날짜/공연장 추출
            body_text = soup.get_text(" ", strip=True)

            # 날짜 파싱 — 가격처럼 보이는 패턴(숫자+원) 바로 앞이면 건너뜀
            DATE_PAT = re.compile(
                r"(\d{4}년\s*\d{1,2}월\s*\d{1,2}[~～\-]\d{1,2}일"
                r"|\d{4}년\s*\d{1,2}월\s*\d{1,2}일"
                r"|\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\s*[~～]\s*\d{4}[.\-]\d{1,2}[.\-]\d{1,2}"
                r"|\d{4}[.\-]\d{1,2}[.\-]\d{1,2})"
            )
            PRICE_CONTEXT = re.compile(r"\d[\d,]*\s*원")
            date_raw = ""
            for m in DATE_PAT.finditer(body_text):
                # 매칭 앞뒤 30자에 가격 패턴이 있으면 건너뜀
                ctx = body_text[max(0, m.start() - 30):m.end() + 30]
                if PRICE_CONTEXT.search(ctx):
                    continue
                date_raw = m.group(0)
                break
            start_date, end_date = parse_date_range(date_raw)

            # 공연장
            venue_name = ""
            venue_patterns = [
                r"장소\s*[：:]\s*([^\n]+)",
                r"공연장\s*[：:]\s*([^\n]+)",
                r"venue\s*[：:]\s*([^\n]+)",
            ]
            for pattern in venue_patterns:
                m = re.search(pattern, body_text, re.IGNORECASE)
                if m:
                    venue_name = m.group(1).strip()[:50]
                    break

            # 포스터 이미지
            image_url = None
            og_img = soup.find("meta", property="og:image")
            if og_img and og_img.get("content"):
                image_url = og_img["content"]
            else:
                img = soup.select_one("img[src*='cdn.imweb.me']")
                if img:
                    image_url = img.get("src")

            genre = "페스티벌" if "festival" in category else "콘서트"
            status = determine_status(start_date, end_date)

            from utils.dedup import make_dedup_key
            dedup_key = make_dedup_key(title, venue_name, start_date)

            return {
                "title": title,
                "venue_name": venue_name,
                "start_date": start_date,
                "end_date": end_date,
                "genre": genre,
                "status": status,
                "image_url": image_url,
                "source_url": url,
                "dedup_key": dedup_key,
                "source_name": self.source_name,
                "artist_name": None,
            }
        except Exception as e:
            print(f"  [FestivalLife 파싱 오류] {url}: {e}")
            return None
