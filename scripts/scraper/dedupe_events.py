#!/usr/bin/env python3
"""
중복 이벤트 정리 스크립트

중복 판별 기준:
  - 같은 제목 + 날짜 범위가 겹치는 이벤트 → 동일 공연으로 판단
  - 같은 venue, 같은 제목 → 동일 공연
  - 다른 지역 투어(제목에 지역명 포함)는 유지

사용법:
  python dedupe_events.py            # dry-run
  python dedupe_events.py --execute  # 실제 삭제
"""
import argparse
import os
from collections import defaultdict
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


def get_client():
    from supabase import create_client
    return create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])


def fetch_all(client) -> list[dict]:
    all_rows = []
    offset = 0
    while True:
        resp = client.table("events").select(
            "id,title,venue_id,artist_id,start_date,end_date,poster_url,source_urls,dedup_key"
        ).range(offset, offset + 999).execute()
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows


def fetch_venues(client) -> dict[str, str]:
    """venue_id → name 매핑"""
    rows = client.table("venues").select("id,name").execute().data or []
    return {r["id"]: r.get("name", "") for r in rows}


def parse_date(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        return None


def dates_overlap(e1, e2) -> bool:
    s1, e1e = parse_date(e1.get("start_date")), parse_date(e1.get("end_date"))
    s2, e2e = parse_date(e2.get("start_date")), parse_date(e2.get("end_date"))
    if s1 and s2:
        start1 = s1
        end1 = e1e or s1
        start2 = s2
        end2 = e2e or s2
        return start1 <= end2 and start2 <= end1
    return False


def score(e: dict) -> int:
    return (
        bool(e.get("poster_url")) * 4
        + bool(e.get("artist_id")) * 3
        + bool(e.get("start_date")) * 2
        + len(e.get("source_urls") or [])
    )


def batch_delete(client, ids):
    deleted = 0
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        client.table("events").delete().in_("id", chunk).execute()
        deleted += len(chunk)
    return deleted


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = not args.execute

    client = get_client()
    print("조회 중...")
    events = fetch_all(client)
    venues = fetch_venues(client)
    print(f"  이벤트: {len(events)}개, 베뉴: {len(venues)}개\n")

    title_groups: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        title_groups[(e.get("title") or "").strip()].append(e)

    to_delete: list[str] = []
    details: list[str] = []

    for title, group in title_groups.items():
        if len(group) < 2:
            continue

        # 그룹 내에서 진짜 중복 찾기
        # 판별: 날짜가 겹치는 쌍 → 같은 공연. 더 적은 정보 가진 쪽 삭제
        n = len(group)
        is_dup = [False] * n
        for i in range(n):
            for j in range(i + 1, n):
                e1, e2 = group[i], group[j]
                same_venue = e1.get("venue_id") == e2.get("venue_id")
                overlap = dates_overlap(e1, e2)
                v1 = venues.get(e1.get("venue_id", ""), "")
                v2 = venues.get(e2.get("venue_id", ""), "")
                if same_venue or overlap:
                    # 더 낮은 score인 것 삭제
                    if score(e1) >= score(e2):
                        is_dup[j] = True
                    else:
                        is_dup[i] = True
                    vdesc = f"{v1} vs {v2}" if not same_venue else v1
                    reason = "same venue" if same_venue else "날짜 겹침"
                    details.append(f"  [{reason}] '{title[:55]}' | {vdesc[:50]}")

        for idx, e in enumerate(group):
            if is_dup[idx]:
                to_delete.append(e["id"])

    print(f"삭제 대상 중복 이벤트: {len(to_delete)}개")
    for d in details[:40]:
        print(d)
    if len(details) > 40:
        print(f"  ... 외 {len(details)-40}건")

    if dry_run:
        print(f"\n[dry-run] 실제 삭제하려면: python dedupe_events.py --execute")
        return

    if to_delete:
        deleted = batch_delete(client, to_delete)
        print(f"\n  → {deleted}개 삭제 완료")
    else:
        print("\n삭제할 중복 없음")


if __name__ == "__main__":
    main()
