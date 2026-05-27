#!/usr/bin/env python3
"""
DB 정리 스크립트 — 두 가지 작업
1. venue_id가 NULL인 이벤트 전체 삭제
2. 제목+venue_id 기준 완전 중복 이벤트 삭제 (하나 남기고 나머지 제거)

사용법:
  python cleanup_venue_and_dupes.py            # dry-run
  python cleanup_venue_and_dupes.py --execute  # 실제 삭제
"""
import argparse
import os
import sys
from collections import defaultdict

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


def fetch_all_events(client) -> list[dict]:
    """events 테이블 전체 조회 (페이지네이션)"""
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            client.table("events")
            .select("id,title,venue_id,artist_id,start_date,end_date,poster_url,source_urls,created_at")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def batch_delete(client, ids: list[str], table: str = "events") -> int:
    deleted = 0
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        client.table(table).delete().in_("id", chunk).execute()
        deleted += len(chunk)
    return deleted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = not args.execute

    client = get_client()

    print("전체 이벤트 조회 중 (페이지네이션)...")
    events = fetch_all_events(client)
    print(f"  총 {len(events)}개\n")

    # ── 1. venue_id NULL 이벤트 ──────────────────────────────
    no_venue = [e for e in events if not e.get("venue_id")]
    print(f"[1] venue_id 없는 이벤트: {len(no_venue)}개")
    for e in no_venue[:20]:
        print(f"  • {e.get('title','')[:70]}")
    if len(no_venue) > 20:
        print(f"  ... 외 {len(no_venue)-20}개")

    # ── 2. 완전 중복 탐지 (title + venue_id 동일) ────────────
    # venue_id가 있는 이벤트에서만 중복 체크
    venue_events = [e for e in events if e.get("venue_id")]
    key_groups: dict[str, list[dict]] = defaultdict(list)
    for e in venue_events:
        key = f"{(e.get('title') or '').strip()}|{e.get('venue_id')}"
        key_groups[key].append(e)

    dup_to_delete: list[str] = []
    dup_summary: list[tuple[str, int]] = []
    for key, group in key_groups.items():
        if len(group) > 1:
            # 정보가 가장 많은 것 하나 남기고 나머지 삭제
            group_sorted = sorted(
                group,
                key=lambda x: (
                    bool(x.get("poster_url")),
                    bool(x.get("artist_id")),
                    bool(x.get("start_date")),
                    len(x.get("source_urls") or []),
                ),
                reverse=True,
            )
            keep = group_sorted[0]
            to_del = [x["id"] for x in group_sorted[1:]]
            dup_to_delete.extend(to_del)
            title = key.split("|")[0]
            dup_summary.append((title[:60], len(group)))

    print(f"\n[2] 완전 중복 이벤트 (title+venue 동일): {len(dup_summary)}그룹, 삭제 대상 {len(dup_to_delete)}개")
    for title, cnt in dup_summary[:20]:
        print(f"  • '{title}' — {cnt}개 중 {cnt-1}개 삭제")
    if len(dup_summary) > 20:
        print(f"  ... 외 {len(dup_summary)-20}그룹")

    total_to_delete = len(no_venue) + len(dup_to_delete)
    print(f"\n삭제 예정 합계: {total_to_delete}개 (venue NULL {len(no_venue)} + 중복 {len(dup_to_delete)})")

    if dry_run:
        print("\n[dry-run] 실제 삭제하려면: python cleanup_venue_and_dupes.py --execute")
        return

    # ── 실제 삭제 ────────────────────────────────────────────
    print("\n--- 실제 삭제 시작 ---")

    if no_venue:
        ids = [e["id"] for e in no_venue]
        deleted = batch_delete(client, ids)
        print(f"  venue NULL 이벤트 {deleted}개 삭제 완료")
    else:
        print("  venue NULL 이벤트 없음")

    if dup_to_delete:
        deleted = batch_delete(client, dup_to_delete)
        print(f"  중복 이벤트 {deleted}개 삭제 완료")
    else:
        print("  중복 이벤트 없음")

    print("\n완료!")


if __name__ == "__main__":
    main()
