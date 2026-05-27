"""네이버 공연 정보 스크래퍼

네이버 검색 결과 및 공연 API에서 콘서트·페스티벌 공연 데이터를 수집한다.

수집 방식:
  1. 네이버 뮤직/공연 API (비공개, User-Agent 필요)
  2. 파싱 실패 시 HTML 검색 결과 fallback

참고: 네이버 검색 API(공개)는 공연 상세 정보가 부족하므로
  undocumented 엔드포인트를 활용하거나 HTML을 파싱한다.
  정책 변경으로 CSS 선택자가 깨질 수 있음을 인지하고 운영.
"""
import re
from typing import Any, Optional
from datetime import date

from bs4 import BeautifulSoup

from config import NAVER
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status, normalize_title, normalize_venue
from utils.dedup import make_dedup_key


# 네이버 공연 섹션 검색 파라미터
_SEARCH_PARAMS_BASE = {
    "where": "nexearch",
    "sm": "top_sug.pre",
    "fbm": "1",
    "acr": "1",
    "acq": "",
    "qdt": "0",
    "ie": "utf8",
    "query": "",
}

# 네이버 스마트블록 — 공연/전시 API (내부용)
_NAVER_PERF_API = "https://api.naver.com/v1/perform/list"

# HTML 파싱 선택자 (변경 가능성 있음 — CSS 구조 변경 감지 시 갱신 필요)
_SELECTORS = {
    "item":       ".sc_new .fds-comps-body-card",    # 공연 카드
    "title":      ".fds-comps-body-card-title",      # 공연명
    "venue":      ".fds-comps-body-card-desc1",      # 공연장
    "date":       ".fds-comps-body-card-desc2",      # 날짜
    "link":       "a.fds-comps-body-card-anchor",    # 상세 링크
    "image":      "img",                             # 포스터
}

# 검색 키워드 (카테고리)
_QUERIES = ["콘서트 2025", "콘서트 2026", "뮤직페스티벌", "페스티벌 2025", "페스티벌 2026"]


class NaverScraper(BaseScraper):
    """네이버 공연 정보 스크래퍼 (HTML 파싱 기반)"""

    BASE_URL = "https://search.naver.com/search.naver"

    def __init__(self):
        super().__init__(NAVER["source_name"])
        # 모바일 UA 사용 — 스마트블록 레이아웃 더 단순
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
            "Referer": "https://search.naver.com/",
            "Accept-Language": "ko-KR,ko;q=0.9",
        })

    # ── 퍼블릭 인터페이스 ────────────────────────────────────────────────────

    def scrape(self) -> list[dict[str, Any]]:
        events: list[dict] = []
        seen_keys: set[str] = set()

        for query in _QUERIES:
            print(f"  [Naver] 검색: '{query}'")
            try:
                new_events = self._search_concerts(query)
                for ev in new_events:
                    key = ev["dedup_key"]
                    if key not in seen_keys:
                        seen_keys.add(key)
                        events.append(ev)
            except Exception as e:
                print(f"  [Naver 검색 오류] '{query}': {e}")

        print(f"  [Naver] 총 {len(events)}개 이벤트 수집")
        return events

    # ── 내부 메서드 ──────────────────────────────────────────────────────────

    def _search_concerts(self, query: str) -> list[dict[str, Any]]:
        """네이버 검색 결과 HTML에서 공연 카드 파싱"""
        params = {**_SEARCH_PARAMS_BASE, "query": query}
        resp = self.get(self.BASE_URL, params=params)
        soup = BeautifulSoup(resp.text, "html.parser")
        events = []

        # 스마트블록 공연 카드 탐색
        cards = soup.select(_SELECTORS["item"])
        if not cards:
            # fallback: 더 넓은 선택자
            cards = soup.find_all("li", class_=re.compile(r"card|item|concert", re.I))

        for card in cards:
            ev = self._parse_card(card)
            if ev:
                events.append(ev)

        return events

    def _parse_card(self, card) -> Optional[dict[str, Any]]:
        """개별 공연 카드 파싱"""
        try:
            # 공연명
            title_el = card.select_one(_SELECTORS["title"])
            if not title_el:
                return None
            title = normalize_title(title_el.get_text(strip=True))
            if not title:
                return None

            # 공연장
            venue_el = card.select_one(_SELECTORS["venue"])
            venue_name = normalize_venue(venue_el.get_text(strip=True)) if venue_el else ""

            # 날짜
            date_el = card.select_one(_SELECTORS["date"])
            date_str = date_el.get_text(strip=True) if date_el else ""
            start_date, end_date = parse_date_range(date_str)

            # 링크
            link_el = card.select_one(_SELECTORS["link"])
            source_url = link_el["href"] if link_el and link_el.get("href") else None
            if source_url and source_url.startswith("/"):
                source_url = f"https://search.naver.com{source_url}"

            # 이미지
            img_el = card.select_one(_SELECTORS["image"])
            image_url = img_el.get("src") or img_el.get("data-src") if img_el else None

            genre = "페스티벌" if "페스티벌" in title or "festival" in title.lower() else "콘서트"
            status = determine_status(start_date, end_date)
            dedup_key = make_dedup_key(title, venue_name, start_date)

            return {
                "title": title,
                "venue_name": venue_name,
                "start_date": start_date,
                "end_date": end_date,
                "genre": genre,
                "status": status,
                "image_url": image_url,
                "source_url": source_url,
                "dedup_key": dedup_key,
                "source_name": self.source_name,
                "artist_name": None,
                "ticket_provider": None,
                "organizer": None,
                "ticket_close_date": None,
            }
        except Exception as e:
            print(f"  [Naver 카드 파싱 오류] {e}")
            return None
