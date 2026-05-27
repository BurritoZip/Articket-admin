#!/usr/bin/env python3
"""
아티스트 이름 ↔ 이벤트 제목 매칭으로 artist_id 연결

로직:
  1. artists 테이블 전체 조회
  2. artist_id가 NULL인 events 전체 조회
  3. event.title에 artist.name이 포함되면 UPDATE events SET artist_id = ?
  4. 결과 리포트

사용법:
  python link_artists.py            # dry-run
  python link_artists.py --execute  # 실제 업데이트
"""
import argparse
import os
import re
import sys
import unicodedata

from dotenv import load_dotenv

load_dotenv()


def get_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[오류] .env 파일에 SUPABASE_URL과 SUPABASE_SERVICE_KEY를 설정하세요.")
        sys.exit(1)
    from supabase import create_client
    return create_client(url, key)


def normalize(text: str) -> str:
    """매칭용 정규화: 소문자 + 공백/특수문자 제거"""
    text = unicodedata.normalize("NFKC", text)
    text = text.lower()
    text = re.sub(r"[\s\-_·•]", "", text)
    return text


def title_contains_artist(title: str, artist_name: str) -> bool:
    """아티스트 이름이 공연 제목에 포함되는지 확인.
    짧은 이름(3자 이하)은 단어 경계 매칭으로 오탐 방지."""
    title_norm = normalize(title)
    name_norm = normalize(artist_name)

    if len(name_norm) <= 3:
        # 짧은 이름: 원본 텍스트에서 단어 경계 기반 매칭
        pattern = r'(?<![a-z가-힣])' + re.escape(artist_name.lower()) + r'(?![a-z가-힣])'
        return bool(re.search(pattern, title.lower()))
    else:
        return name_norm in title_norm


def fetch_all(client, table: str, select: str) -> list[dict]:
    rows = []
    offset = 0
    while True:
        resp = client.table(table).select(select).range(offset, offset + 999).execute()
        rows.extend(resp.data or [])
        if len(resp.data or []) < 1000:
            break
        offset += 1000
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="실제 UPDATE 실행 (기본: dry-run)")
    args = parser.parse_args()
    dry_run = not args.execute

    client = get_client()

    print("아티스트 목록 조회 중...")
    artists = fetch_all(client, "artists", "id,name")
    print(f"  {len(artists)}명")

    # 이름 길이 내림차순 정렬 (긴 이름 우선 매칭 → 부분일치 오탐 방지)
    artists.sort(key=lambda a: len(a["name"]), reverse=True)

    # 정규화된 이름 → artist_id 매핑
    norm_map: dict[str, tuple[str, str]] = {}  # normalized → (id, original_name)
    for a in artists:
        norm = normalize(a["name"])
        if len(norm) >= 2:  # 1글자 이름은 오탐 위험
            norm_map[norm] = (a["id"], a["name"])

    print("\nartist_id 없는 이벤트 조회 중...")
    events = fetch_all(client, "events", "id,title,artist_id")
    unlinked = [e for e in events if not e.get("artist_id")]
    print(f"  {len(unlinked)}개 (전체 {len(events)}개 중)")

    matched: list[tuple[str, str, str]] = []  # (event_id, artist_id, artist_name)
    for ev in unlinked:
        title = ev.get("title", "")
        for norm, (artist_id, artist_name) in norm_map.items():
            if title_contains_artist(title, artist_name):
                matched.append((ev["id"], artist_id, artist_name))
                break  # 첫 번째 매칭만 사용

    print(f"\n매칭 결과: {len(matched)}개 이벤트에 아티스트 연결")
    for ev_id, art_id, art_name in matched[:30]:
        title = next((e["title"] for e in unlinked if e["id"] == ev_id), "?")
        print(f"  [{art_name}] {title[:60]}")
    if len(matched) > 30:
        print(f"  ... 외 {len(matched)-30}개")

    if dry_run:
        print(f"\n[dry-run] {len(matched)}개가 업데이트될 예정.")
        print("실제 실행: python link_artists.py --execute")
        return

    # 배치 UPDATE
    updated = 0
    for i in range(0, len(matched), 50):
        chunk = matched[i:i + 50]
        for ev_id, artist_id, _ in chunk:
            client.table("events").update({"artist_id": artist_id}).eq("id", ev_id).execute()
            updated += 1
    print(f"\n→ {updated}개 이벤트 artist_id 연결 완료")


if __name__ == "__main__":
    main()
