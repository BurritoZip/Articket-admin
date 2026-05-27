"""NOL 야놀자 스크래퍼 — SSR HTML 파싱"""
import re
from typing import Any, Optional
from datetime import date

from bs4 import BeautifulSoup

from config import YANOLJA
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status, normalize_title


class YanoljaScaper(BaseScraper):

    def __init__(self):
        super().__init__(YANOLJA["source_name"])

    def scrape(self) -> list[dict[str, Any]]:
        resp = self.get(YANOLJA["list_url"])
        soup = BeautifulSoup(resp.text, "lxml")

        # 공연 카드 링크 수집
        detail_links = []
        for a in soup.select("a[href*='/ticket/places/']"):
            href = a.get("href", "")
            if href and href not in detail_links:
                detail_links.append(href)

        print(f"  [야놀자] 상세 URL {len(detail_links)}개 발견")

        events = []
        for href in detail_links:
            url = YANOLJA["base_url"] + href if href.startswith("/") else href
            event = self._parse_detail(url)
            if event:
                events.append(event)

        print(f"  [야놀자] 총 {len(events)}개 이벤트 수집")
        return events

    def _parse_detail(self, url: str) -> Optional[dict[str, Any]]:
        try:
            resp = self.get(url)
            soup = BeautifulSoup(resp.text, "lxml")

            # 공연명
            title_tag = soup.select_one("h1") or soup.select_one("title")
            if not title_tag:
                return None
            title = title_tag.get_text(strip=True)
            if not title:
                return None

            # 날짜 — "2026.06.06" 또는 "2026. 06. 06" 형태
            date_raw = ""
            date_pat = re.compile(r"2\d{3}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}")
            for tag in soup.find_all(string=date_pat):
                date_raw = tag.strip()
                break
            if not date_raw:
                # og:description이나 메타에서 탐색
                body = soup.get_text(" ", strip=True)
                m = re.search(r"(2\d{3}\s*[.]\s*\d{1,2}\s*[.]\s*\d{1,2})", body)
                if m:
                    date_raw = m.group(1)
            start_date, end_date = parse_date_range(date_raw)

            # 공연장 — placeName JSON 필드 또는 keywords 메타 3번째 항목
            venue_name = ""
            m = re.search(r'"placeName"\s*:\s*"([^"]+)"', resp.text)
            if m:
                venue_name = m.group(1).strip()
            if not venue_name:
                kw = soup.find("meta", attrs={"name": "keywords"})
                if kw and kw.get("content"):
                    parts = [p.strip() for p in kw["content"].split(",")]
                    if len(parts) >= 3:
                        venue_name = parts[2]

            # 포스터 이미지
            image_url = None
            og_img = soup.find("meta", property="og:image")
            if og_img and og_img.get("content"):
                image_url = og_img["content"]
            else:
                img = soup.select_one("img[src*='ticketimage']")
                if img:
                    src = img.get("src", "")
                    image_url = "https:" + src if src.startswith("//") else src

            status = determine_status(start_date, end_date)

            from utils.dedup import make_dedup_key
            dedup_key = make_dedup_key(title, venue_name, start_date)

            return {
                "title": title,
                "venue_name": venue_name,
                "start_date": start_date,
                "end_date": end_date,
                "genre": "콘서트",
                "status": status,
                "image_url": image_url,
                "source_url": url,
                "dedup_key": dedup_key,
                "source_name": self.source_name,
                "artist_name": None,
            }
        except Exception as e:
            print(f"  [야놀자 상세 파싱 오류] {url}: {e}")
            return None
