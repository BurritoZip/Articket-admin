"""Interpark 티켓 스크래퍼 — SSR HTML 파싱"""
import re
from typing import Any, Optional

from bs4 import BeautifulSoup

from config import INTERPARK
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status


class InterparkScraper(BaseScraper):

    def __init__(self):
        super().__init__(INTERPARK["source_name"])

    def scrape(self) -> list[dict[str, Any]]:
        events = []
        for genre_name, url in INTERPARK["genre_urls"].items():
            genre_events = self._scrape_genre(url, genre_name)
            events.extend(genre_events)
            print(f"  [Interpark:{genre_name}] {len(genre_events)}개 수집")

        # dedup
        seen = set()
        unique = []
        for e in events:
            if e["dedup_key"] not in seen:
                seen.add(e["dedup_key"])
                unique.append(e)
        print(f"  [Interpark] 총 {len(unique)}개 이벤트 수집")
        return unique

    def _scrape_genre(self, url: str, genre_name: str) -> list[dict[str, Any]]:
        try:
            resp = self.get(url)
        except Exception as e:
            print(f"  [Interpark 오류] {url}: {e}")
            return []

        soup = BeautifulSoup(resp.text, "lxml")
        events = []

        for item in soup.find_all(class_=lambda c: c and "TicketItem_ticketItem" in c):
            event = self._parse_item(item, genre_name)
            if event:
                events.append(event)

        return events

    def _parse_item(self, item, genre_name: str) -> Optional[dict[str, Any]]:
        try:
            # 공연명
            title_el = item.find(class_=lambda c: c and "TicketItem_goodsName" in c)
            title = title_el.get_text(strip=True) if title_el else item.get("gtm-label", "")
            if not title:
                return None

            # 공연장
            venue_el = item.find(class_=lambda c: c and "TicketItem_placeName" in c)
            venue_name = venue_el.get_text(strip=True) if venue_el else ""

            # 날짜
            date_el = item.find(class_=lambda c: c and "TicketItem_playDate" in c)
            date_raw = date_el.get_text(strip=True) if date_el else ""
            start_date, end_date = parse_date_range(date_raw)

            # 이미지 + goods ID (imageWrap div보다 img 태그를 직접 지정)
            img_el = item.find("img", class_=lambda c: c and "TicketItem_image" in c)
            image_url = None
            goods_id = None
            if img_el:
                src = img_el.get("src", "")
                image_url = src or None
                m = re.search(r"/(\d+)_p\.", src)
                if m:
                    goods_id = m.group(1)

            source_url = f"https://tickets.interpark.com/goods/{goods_id}" if goods_id else None
            genre = "페스티벌" if genre_name == "festival" else "콘서트"
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
            print(f"  [Interpark 파싱 오류] {e}")
            return None
