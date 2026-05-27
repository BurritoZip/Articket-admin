#!/usr/bin/env python3
"""
아티스트 프로필 자동 보강 — Wikipedia HTML 인포박스 스크래핑

Claude 불필요. Wikipedia 인포박스에서 직업·생년월일·출생지·소속사를 직접 파싱.
한국어 Wikipedia → 영어 Wikipedia 순으로 시도.

사용법:
  python enrich_artists.py              # dry-run
  python enrich_artists.py --execute    # 실제 DB 업데이트
  python enrich_artists.py --execute --limit 20
  python enrich_artists.py --execute --delete-empty   # 보강 실패 아티스트 삭제

환경 변수 (.env):
  SUPABASE_URL, SUPABASE_SERVICE_KEY
"""
import argparse
import os
import re
import sys
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

_HEADERS = {
    "User-Agent": "Articket-ArtistEnricher/1.0 (shinjw4675@gmail.com)",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
}


# ── Supabase ──────────────────────────────────────────────────────────────────

def get_supabase_client():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if url.endswith("/rest/v1"):
        url = url[: -len("/rest/v1")]
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[오류] .env에 SUPABASE_URL과 SUPABASE_SERVICE_KEY를 설정하세요.")
        sys.exit(1)
    from supabase import create_client
    return create_client(url, key)


def fetch_artists_missing_profile(client, limit=None) -> list[dict]:
    q = (
        client.table("artists")
        .select("id,name,avatar_url,occupation,birth_date,birth_place,related")
        .or_("occupation.is.null,birth_date.is.null")
        .order("name")
    )
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


# ── Wikipedia 인포박스 스크래핑 ────────────────────────────────────────────────

def _scrape_infobox(url: str) -> dict:
    """Wikipedia 페이지 HTML에서 인포박스 테이블 파싱 → {field: value} 반환"""
    try:
        r = requests.get(url, headers=_HEADERS, timeout=10)
        if r.status_code != 200:
            return {}
    except Exception:
        return {}

    soup = BeautifulSoup(r.text, "html.parser")
    infobox = soup.find("table", class_="infobox")
    if not infobox:
        return {}

    data = {}
    for row in infobox.find_all("tr"):
        th = row.find("th")
        td = row.find("td")
        if not (th and td):
            continue
        key = th.get_text(separator=" ", strip=True)
        # 숨겨진 태그(생년 기계 판독용 span 등) 제거 후 텍스트
        for hidden in td.find_all("span", style=re.compile("display:none|display: none")):
            hidden.decompose()
        value = td.get_text(separator=" ", strip=True)
        value = re.sub(r"\s+", " ", value).strip()
        data[key] = value
    return data


def _ko_wiki_url(name: str) -> str:
    return f"https://ko.wikipedia.org/wiki/{urllib.parse.quote(name)}"


def _search_ko_wiki(name: str) -> str | None:
    """이름으로 한국어 Wikipedia 검색 → 가장 관련성 높은 URL 반환"""
    params = {
        "action": "query", "list": "search",
        "srsearch": f"{name} 가수", "srlimit": "3",
        "format": "json", "utf8": "1", "formatversion": "2",
    }
    try:
        r = requests.get("https://ko.wikipedia.org/w/api.php", params=params,
                         headers=_HEADERS, timeout=8)
        results = r.json().get("query", {}).get("search", [])
        if results:
            return f"https://ko.wikipedia.org/wiki/{urllib.parse.quote(results[0]['title'])}"
    except Exception:
        pass
    return None


def get_wiki_infobox(artist_name: str) -> dict:
    """한국어 → 영어 Wikipedia 순으로 인포박스 파싱 시도"""
    # 1. 한국어 직접 조회
    data = _scrape_infobox(_ko_wiki_url(artist_name))
    if data:
        return data

    # 2. 한국어 검색
    url = _search_ko_wiki(artist_name)
    if url:
        data = _scrape_infobox(url)
        if data:
            return data

    # 3. 영어 Wikipedia 직접 조회
    en_url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(artist_name)}"
    return _scrape_infobox(en_url)


# ── 인포박스 데이터 → DB 필드 매핑 ────────────────────────────────────────────

# 한국어 인포박스 필드명 → (DB 컬럼, 처리 방식)
_KO_FIELD_MAP = {
    "직업": "occupation",
    "직종": "occupation",
    "출생": "birth_raw",    # "1993년 5월 16일 ... 서울" 형태 — 분리 필요
    "출생일": "birth_date",
    "출생지": "birth_place",
    "소속사": "related",
    "레이블": "related",
    "음반사": "related",
    "그룹": "related",
    "장르": "genre",        # DB에 없으면 무시
}

_EN_FIELD_MAP = {
    "Born": "birth_raw",
    "Occupation": "occupation",
    "Occupation(s)": "occupation",
    "Origin": "birth_place",
    "Label": "related",
    "Labels": "related",
    "Associated acts": "related",
    "Genre": "genre",
    "Genres": "genre",
}


def _clean_birth_date(raw: str) -> str | None:
    """출생 필드에서 날짜 부분 추출: "1993년 5월 16일 ..." → "1993년 5월 16일" """
    m = re.search(r"\d{4}년\s*\d{1,2}월\s*\d{1,2}일", raw)
    if m:
        return m.group(0)
    m = re.search(r"\d{4}년", raw)
    if m:
        return m.group(0)
    # 영어: "(born January 1, 1990)" or "January 1, 1990"
    m = re.search(r"(\w+ \d{1,2},?\s*\d{4})", raw)
    if m:
        return m.group(1)
    return None


def _clean_birth_place(raw: str) -> str | None:
    """출생 필드에서 지역 부분 추출: "1993년 5월 16일 대한민국 서울" → "서울특별시" """
    # 날짜 패턴 제거
    no_date = re.sub(r"\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^가-힣]*", "", raw)
    no_date = re.sub(r"\(\d{4}-\d{2}-\d{2}\)\(\d+세\)", "", no_date)
    no_date = re.sub(r"\d{4}년\s*\d{1,2}월\s*\d{1,2}일", "", no_date)
    # 대한민국, 한국 이후 지역명 추출
    m = re.search(r"(대한민국|한국)\s*(.+)", no_date)
    if m:
        place = m.group(2).strip()
        # 괄호 안 내용 제거
        place = re.sub(r"\([^)]*\)", "", place).strip()
        if place:
            return f"대한민국 {place.split()[0]}" if place else "대한민국"
    # 외국 도시
    place = no_date.strip()
    if len(place) > 2:
        return place[:30]
    return None


def parse_profile(infobox: dict) -> dict:
    """인포박스 dict → DB 저장용 profile dict"""
    profile: dict = {}

    # 한국어 필드 우선 처리
    for field, mapping in _KO_FIELD_MAP.items():
        if field in infobox and mapping != "genre":
            val = infobox[field]
            if mapping == "birth_raw":
                profile["birth_date"] = _clean_birth_date(val)
                profile["birth_place"] = _clean_birth_place(val)
            elif field not in profile:
                profile[mapping] = val

    # 영어 필드 폴백
    for field, mapping in _EN_FIELD_MAP.items():
        if field in infobox and mapping not in profile and mapping != "genre":
            val = infobox[field]
            if mapping == "birth_raw":
                if "birth_date" not in profile:
                    profile["birth_date"] = _clean_birth_date(val)
                if "birth_place" not in profile:
                    profile["birth_place"] = _clean_birth_place(val)
            else:
                profile[mapping] = val

    # None 및 빈 문자열 제거
    return {k: v for k, v in profile.items() if v and str(v).strip()}


# ── DB 업데이트 ───────────────────────────────────────────────────────────────

def update_artist(client, artist_id: str, profile: dict) -> dict:
    payload = {k: v for k, v in profile.items()
               if k in ("occupation", "birth_date", "birth_place", "related")}
    if payload:
        client.table("artists").update(payload).eq("id", artist_id).execute()
    return payload


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="아티스트 프로필 Wikipedia 자동 보강")
    parser.add_argument("--execute", action="store_true", help="실제 DB 업데이트 (기본: dry-run)")
    parser.add_argument("--limit", type=int, default=None, help="처리 아티스트 수 제한")
    parser.add_argument("--delete-empty", action="store_true",
                        help="Wikipedia 미검색 + 공연 없는 아티스트 삭제 (--execute 필요)")
    args = parser.parse_args()
    dry_run = not args.execute

    client = get_supabase_client()

    print("프로필 미완성 아티스트 조회 중...")
    artists = fetch_artists_missing_profile(client, args.limit)
    print(f"  {len(artists)}명 대상\n")

    enriched, failed = [], []

    for i, artist in enumerate(artists, 1):
        name = artist["name"]
        print(f"[{i}/{len(artists)}] {name}")

        infobox = get_wiki_infobox(name)
        if not infobox:
            print(f"  → Wikipedia 미검색")
            failed.append(artist)
            time.sleep(0.4)
            continue

        profile = parse_profile(infobox)
        if not profile:
            print(f"  → 인포박스 있으나 추출 실패")
            failed.append(artist)
            time.sleep(0.4)
            continue

        parts = [f"{k}: {v}" for k, v in profile.items()]
        print(f"  → {' | '.join(parts)}")

        if not dry_run:
            updated = update_artist(client, artist["id"], profile)
            if updated:
                print(f"     DB 업데이트 완료: {list(updated.keys())}")
        else:
            print(f"     [dry-run] 업데이트 예정")

        enriched.append(artist)
        time.sleep(0.5)

    # 실패 아티스트 삭제 처리
    if args.delete_empty and failed:
        print(f"\n보강 실패 {len(failed)}명 처리:")
        for a in failed:
            has_events = bool(
                client.table("events").select("id").eq("artist_id", a["id"]).limit(1).execute().data
            )
            has_past = bool(
                client.table("artist_past_concerts").select("id").eq("artist_id", a["id"]).limit(1).execute().data
            )
            if has_events or has_past:
                print(f"  {a['name']} — 공연 있어 유지")
            else:
                print(f"  {a['name']} — 삭제{'(dry-run)' if dry_run else ''}")
                if not dry_run:
                    client.table("artists").delete().eq("id", a["id"]).execute()

    print(f"\n{'='*50}")
    print(f"보강 성공: {len(enriched)}명 / 실패: {len(failed)}명")
    if dry_run:
        print("실제 적용: python enrich_artists.py --execute")


if __name__ == "__main__":
    main()
