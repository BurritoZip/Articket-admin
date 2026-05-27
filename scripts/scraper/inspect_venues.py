#!/usr/bin/env python3
"""
DB 장소(venue) 상태 검토 스크립트

- venue_id가 NULL인 이벤트
- name/address가 비어있는 venue
- 의심스러운 venue (장소명이 아닌 것)
"""
import os
import sys
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


def main():
    client = get_client()

    # 1. 전체 이벤트 수
    all_events = client.table("events").select("id,title,venue_id,artist_id").execute().data or []
    print(f"전체 이벤트: {len(all_events)}개")

    # 2. venue_id가 NULL인 이벤트
    no_venue = [e for e in all_events if not e.get("venue_id")]
    print(f"\n[venue_id 없는 이벤트] {len(no_venue)}개:")
    for e in no_venue[:30]:
        print(f"  • [{e['id'][:8]}] {e.get('title','')[:60]}")
    if len(no_venue) > 30:
        print(f"  ... 외 {len(no_venue)-30}개")

    # 3. 전체 venues 조회
    all_venues = client.table("venues").select("id,name,address").execute().data or []
    print(f"\n전체 Venue: {len(all_venues)}개")

    # 4. name/address 비어있는 venue
    bad_venues = [v for v in all_venues if not (v.get("name") or "").strip() or not (v.get("address") or "").strip()]
    print(f"\n[이름/주소 없는 Venue] {len(bad_venues)}개:")
    for v in bad_venues:
        print(f"  • [{v['id'][:8]}] name='{v.get('name','')}' address='{v.get('address','')}'")

    # 5. 모든 venue 목록 출력 (검토용)
    print(f"\n[전체 Venue 목록]")
    for v in all_venues:
        # 해당 venue를 참조하는 이벤트 수
        count = sum(1 for e in all_events if e.get("venue_id") == v["id"])
        print(f"  [{v['id'][:8]}] '{v.get('name','')}' | '{v.get('address','')}' | 이벤트:{count}개")

    # 6. events에서 참조하지 않는 orphan venues
    referenced_ids = {e["venue_id"] for e in all_events if e.get("venue_id")}
    orphan_venues = [v for v in all_venues if v["id"] not in referenced_ids]
    print(f"\n[미참조 Venue (orphan)] {len(orphan_venues)}개:")
    for v in orphan_venues:
        print(f"  • '{v.get('name','')}' | '{v.get('address','')}'")


if __name__ == "__main__":
    main()
