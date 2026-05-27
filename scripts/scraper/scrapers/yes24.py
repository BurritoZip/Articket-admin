"""Yes24 티켓 스크래퍼 — AJAX API 직접 호출"""
import re
from typing import Any, Optional

from bs4 import BeautifulSoup

from config import YES24
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status


class Yes24Scraper(BaseScraper):

    def __init__(self):
        super().__init__(YES24["source_name"])

    def scrape(self) -> list[dict[str, Any]]:
        events = []
        for genre_code in YES24["genre_codes"]:
            page = 1
            while True:
                items = self._fetch_page(genre_code, page)
                if not items:
                    break
                events.extend(items)
                page += 1
                if page > 20:  # 안전 상한
                    break
        # 이 스크래퍼 내에서 dedup_key로 중복 제거
        seen = set()
        unique = []
        for e in events:
            if e["dedup_key"] not in seen:
                seen.add(e["dedup_key"])
                unique.append(e)
        print(f"  [Yes24] 총 {len(unique)}개 이벤트 수집")
        return unique

    def _fetch_page(self, genre_code: str, page: int) -> list[dict[str, Any]]:
        params = {
            "genre": genre_code,
            "sort": "3",
            "area": "",
            "genretype": "1",
            "pCurPage": str(page),
            "pPageSize": str(YES24["page_size"]),
        }
        resp = self.get(YES24["ajax_url"], params=params)
        soup = BeautifulSoup(resp.text, "lxml")
        items_html = soup.select("a[onclick*='GoToPerfDetail']")
        if not items_html:
            return []

        results = []
        for item in items_html:
            event = self._parse_item(item, genre_code)
            if event:
                results.append(event)
        return results

    def _parse_item(self, item, genre_code: str) -> Optional[dict[str, Any]]:
        try:
            # 공연명: <a title='...'> 속성 우선, 없으면 p.list-b-tit1 텍스트
            title = item.get("title", "")
            if not title:
                tit = item.select_one("p.list-b-tit1")
                title = tit.get_text(strip=True) if tit else ""
            if not title:
                return None

            # 날짜 / 공연장 — 날짜 패턴으로 구분 (순서가 바뀌는 경우 방어)
            info_tags = item.select("p.list-b-tit2")
            date_raw = ""
            venue_name = ""
            for tag in info_tags:
                text = tag.get_text(strip=True)
                if re.search(r"\d{4}[.\-]|\d{4}년", text):
                    date_raw = text
                else:
                    venue_name = text

            start_date, end_date = parse_date_range(date_raw)

            # 포스터 이미지
            img = item.select_one("img.lazyload[data-src]") or item.select_one("img[src]")
            image_url = None
            if img:
                src = img.get("data-src") or img.get("src", "")
                if src.startswith("//"):
                    src = "https:" + src
                image_url = src or None

            # Yes24 공연 ID → 상세 URL (onclick: "jsf_base_GoToPerfDetail(12345)")
            onclick = item.get("onclick", "")
            perf_id_match = re.search(r"GoToPerfDetail\((\d+)\)", onclick)
            source_url = None
            if perf_id_match:
                source_url = f"{YES24['detail_base']}{perf_id_match.group(1)}"

            # 장르
            genre = "페스티벌" if genre_code == "15464" else "콘서트"
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
                "source_url": source_url,
                "dedup_key": dedup_key,
                "source_name": self.source_name,
                "artist_name": None,   # Yes24 목록에서 아티스트명 미제공
            }
        except Exception as e:
            print(f"  [Yes24 파싱 오류] {e}")
            return None
