"""Melon 티켓 스크래퍼 — AJAX JSON API"""
from typing import Any

from config import MELON
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status


class MelonScraper(BaseScraper):

    CDN_BASE = "https://cdnticket.melon.co.kr"
    DETAIL_BASE = "https://ticket.melon.com/performance/index.htm?prodId="

    def __init__(self):
        super().__init__(MELON["source_name"])
        self.session.headers.update({
            "Referer": "https://ticket.melon.com/concert/index.htm?genreType=GENRE_CON",
            "X-Requested-With": "XMLHttpRequest",
        })

    def scrape(self) -> list[dict[str, Any]]:
        events = []
        for genre_code in MELON["genre_codes"]:
            genre_events = self._fetch_genre(genre_code)
            events.extend(genre_events)
            print(f"  [Melon:{genre_code}] {len(genre_events)}개 수집")

        # dedup
        seen = set()
        unique = []
        for e in events:
            if e["dedup_key"] not in seen:
                seen.add(e["dedup_key"])
                unique.append(e)
        print(f"  [Melon] 총 {len(unique)}개 이벤트 수집")
        return unique

    def _fetch_genre(self, genre_code: str) -> list[dict[str, Any]]:
        try:
            resp = self.get(
                MELON["ajax_url"],
                params={
                    "commCode": "",
                    "sortType": "",
                    "perfGenreCode": genre_code,
                    "perfThemeCode": "",
                    "filterCode": "FILTER_ALL",
                    "v": "1",
                },
            )
            data = resp.json()
        except Exception as e:
            print(f"  [Melon:{genre_code} 오류] {e}")
            return []

        if data.get("result") != 0:
            return []

        events = []
        for item in data.get("data", []):
            event = self._parse_item(item, genre_code)
            if event:
                events.append(event)
        return events

    def _parse_item(self, item: dict, genre_code: str) -> dict | None:
        try:
            title = item.get("title", "").strip()
            if not title:
                return None

            venue_name = item.get("placeName", "").strip()
            date_raw = item.get("periodInfo", "")   # "2026.07.24 - 2026.07.26"
            start_date, end_date = parse_date_range(date_raw)

            prod_id = item.get("prodId")
            poster_path = item.get("posterImg", "")
            image_url = f"{self.CDN_BASE}{poster_path}" if poster_path else None
            source_url = f"{self.DETAIL_BASE}{prod_id}" if prod_id else None

            genre = "페스티벌" if "FES" in genre_code else "콘서트"
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
                "artist_name": None,
            }
        except Exception as e:
            print(f"  [Melon 파싱 오류] {e}")
            return None
