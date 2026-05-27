"""StagePick 스크래퍼 — 목록 API + 상세 페이지 HTML"""
import html
import json
from typing import Any, Optional

from bs4 import BeautifulSoup

from config import STAGEPICK
from scrapers.base import BaseScraper
from utils.normalizer import parse_date_range, determine_status

_SKIP_KW = ("뮤지컬", "연극", "클래식", "오페라", "발레", "전시", "세미나", "강연", "포럼")
_FESTIVAL_KW = ("페스티벌", "festival", "kcon", "fest")


class StagepickScraper(BaseScraper):

    BASE_API = "https://api.stagepick.co.kr/v1"
    BASE_WEB = "https://www.stagepick.co.kr"

    def __init__(self):
        super().__init__(STAGEPICK["source_name"])
        self.session.headers.update({
            "Origin": "https://www.stagepick.co.kr",
            "Referer": "https://www.stagepick.co.kr/",
            "Accept-Language": "ko-KR,ko;q=0.9",
        })

    def scrape(self) -> list[dict[str, Any]]:
        events = self._fetch_performances()

        seen = set()
        unique = []
        for e in events:
            if e["dedup_key"] not in seen:
                seen.add(e["dedup_key"])
                unique.append(e)
        print(f"  [StagePick] 총 {len(unique)}개 이벤트 수집")
        return unique

    def scrape_artists(self) -> list[dict[str, Any]]:
        """아티스트 목록 수집 (main.py에서 별도 저장)"""
        artists = []
        seen_ids: set[str] = set()

        try:
            resp = self.get(f"{self.BASE_API}/artists", params={"page": 1})
            data = resp.json()
        except Exception as e:
            print(f"  [StagePick 아티스트 오류] {e}")
            return []

        for item in data.get("upcoming", []) + data.get("popular", []):
            artist_id = str(item.get("id", ""))
            if artist_id in seen_ids:
                continue
            seen_ids.add(artist_id)
            name = item.get("name", "").strip()
            if name:
                artists.append({
                    "name": name,
                    "avatar_url": item.get("image_url"),
                    "upcoming_event_count": item.get("upcoming_performances"),
                })

        print(f"  [StagePick] 아티스트 {len(artists)}명 수집")
        return artists

    # ── 목록 API ──────────────────────────────────────────────────────────────

    def _fetch_performances(self) -> list[dict[str, Any]]:
        events = []
        page = 1
        while True:
            params: dict = {"page": page}
            if page > 1:
                params["offset"] = 20 * (page - 1)

            try:
                resp = self.get(f"{self.BASE_API}/performances", params=params)
                data = resp.json()
            except Exception as e:
                print(f"  [StagePick 오류] page {page}: {e}")
                break

            for item in data.get("performances", []):
                event = self._parse_performance(item)
                if event:
                    events.append(event)

            print(f"  [StagePick] page {page} — {len(events)}개 누적")
            if not data.get("has_next_page"):
                break
            page += 1

        return events

    # ── 상세 페이지 파싱 ──────────────────────────────────────────────────────

    def _fetch_detail(self, perf_id: int) -> dict:
        """
        상세 HTML 파싱 결과:
          artist_infos: [{"name": str, "image_url": str}, ...]
          venue_name: str | None
          start_date: date | None
          end_date: date | None
          poster_url: str | None  (og:image — 고화질)
        """
        result: dict[str, Any] = {
            "artist_infos": [],
            "venue_name": None,
            "start_date": None,
            "end_date": None,
            "poster_url": None,
            "organizer": None,
            "ticket_close_date": None,
        }
        try:
            url = f"{self.BASE_WEB}/performances/detail/{perf_id}"
            resp = self.get(url)
            soup = BeautifulSoup(resp.text, "html.parser")

            # 아티스트 목록 — follow-button-container data 속성
            for div in soup.find_all("div", class_="follow-button-container"):
                name = div.get("data-artist-name", "").strip()
                image = div.get("data-artist-image", "").strip()
                if name:
                    result["artist_infos"].append({"name": name, "image_url": image or None})

            # 날짜 — JSON-LD (ISO 8601)
            ld_tag = soup.find("script", type="application/ld+json")
            if ld_tag and ld_tag.string:
                try:
                    ld = json.loads(ld_tag.string)
                    from datetime import datetime as _dt
                    def _parse_iso(s: str):
                        try:
                            return _dt.fromisoformat(s.replace("Z", "+00:00")).date()
                        except Exception:
                            return None
                    result["start_date"] = _parse_iso(ld.get("startDate", ""))
                    result["end_date"] = _parse_iso(ld.get("endDate", ""))
                except Exception:
                    pass

            # 공연 장소
            for p_tag in soup.find_all("p"):
                if p_tag.get_text(strip=True) == "공연 장소":
                    a_tag = p_tag.find_next("a", href=lambda h: h and "/venues/detail/" in h)
                    if a_tag:
                        name_p = a_tag.find("p", class_="font-medium")
                        if name_p:
                            result["venue_name"] = name_p.get_text(strip=True)
                    break

            # 포스터 이미지 (og:image — 고화질 버전)
            og = soup.find("meta", property="og:image")
            if og and og.get("content"):
                result["poster_url"] = og["content"]

            # 주최/주관사 — '주최', '주관' 레이블 다음 텍스트
            _ORGANIZER_LABELS = ("주최", "주관", "주관사", "기획사", "주최사")
            for p_tag in soup.find_all("p"):
                txt = p_tag.get_text(strip=True)
                if txt in _ORGANIZER_LABELS:
                    # 다음 형제 또는 인접 p 태그에서 값 추출
                    sibling = p_tag.find_next_sibling("p")
                    if not sibling:
                        sibling = p_tag.find_next("p")
                    if sibling:
                        val = sibling.get_text(strip=True)
                        if val and val not in _ORGANIZER_LABELS:
                            existing = result["organizer"]
                            result["organizer"] = (
                                f"{existing}, {val}" if existing else val
                            )
                    break

            # 티켓팅 종료일 — JSON-LD의 'offers.availabilityEnds' 또는 페이지 내 날짜 파싱
            ld_tag2 = soup.find("script", type="application/ld+json")
            if ld_tag2 and ld_tag2.string:
                try:
                    ld2 = json.loads(ld_tag2.string)
                    offers = ld2.get("offers", {})
                    if isinstance(offers, list):
                        offers = offers[0] if offers else {}
                    avail_end = offers.get("availabilityEnds", "")
                    if avail_end:
                        from datetime import datetime as _dt2
                        try:
                            result["ticket_close_date"] = _dt2.fromisoformat(
                                avail_end.replace("Z", "+00:00")
                            )
                        except Exception:
                            pass
                except Exception:
                    pass

        except Exception as e:
            print(f"  [StagePick 상세 오류] {perf_id}: {e}")
        return result

    # ── 이벤트 파싱 ───────────────────────────────────────────────────────────

    def _parse_performance(self, item: dict) -> Optional[dict[str, Any]]:
        try:
            title = html.unescape(item.get("title", "").strip())
            if not title:
                return None

            title_lower = title.lower()
            if any(kw in title_lower for kw in _SKIP_KW):
                return None

            perf_id = item.get("id")

            # 상세 페이지에서 아티스트·장소·날짜·이미지 추출
            detail = self._fetch_detail(perf_id) if perf_id else {}

            artist_infos: list[dict] = detail.get("artist_infos", [])
            venue_name = detail.get("venue_name") or item.get("venue", "").strip()

            start_date = detail.get("start_date")
            end_date = detail.get("end_date")
            if not start_date:
                start_date, end_date = parse_date_range(item.get("formatted_date", ""))

            poster_url = detail.get("poster_url") or item.get("image_url")
            source_url = f"{self.BASE_WEB}/performances/{perf_id}" if perf_id else None
            genre = "페스티벌" if any(k in title_lower for k in _FESTIVAL_KW) else "콘서트"
            status = determine_status(start_date, end_date)

            from utils.dedup import make_dedup_key
            dedup_key = make_dedup_key(title, venue_name, start_date)

            # 단독 공연이면 artist_name 직접 세팅, 페스티벌(다수)이면 None → link_artists.py에서 연결
            artist_name = artist_infos[0]["name"] if len(artist_infos) == 1 else None

            return {
                "title": title,
                "venue_name": venue_name,
                "start_date": start_date,
                "end_date": end_date,
                "genre": genre,
                "status": status,
                "image_url": poster_url,
                "source_url": source_url,
                "dedup_key": dedup_key,
                "source_name": self.source_name,
                "artist_name": artist_name,
                "artist_infos": artist_infos,  # main.py에서 DB 저장 시 사용
                "ticket_provider": "stagepick",
                "organizer": detail.get("organizer"),
                "ticket_close_date": detail.get("ticket_close_date"),
            }
        except Exception as e:
            print(f"  [StagePick 파싱 오류] {e}")
            return None
