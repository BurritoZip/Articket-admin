#!/usr/bin/env python3
"""
DB 오염 데이터 일괄 정리 스크립트

삭제 기준:
  1. 제목에 전시/미술/갤러리 등 비콘서트 키워드 포함
  2. 공연 기간이 90일 초과인 장기 전시성 이벤트
  3. title 길이가 0 또는 공백뿐인 이벤트

사용법:
  python cleanup_db.py            # dry-run (삭제 없이 대상만 출력)
  python cleanup_db.py --execute  # 실제 삭제 실행
  python cleanup_db.py --execute --fix-venues  # venues 오기입도 정리
"""
import argparse
import os
import sys
from datetime import datetime, date

from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# 삭제 기준 키워드 (title 소문자 포함 여부)
# ──────────────────────────────────────────────
_DELETE_KEYWORDS = (
    # 전시/미술 관련
    "전시", "전시회", "전람회", "전람", "전시관",
    "갤러리", "gallery", "exhibition", "expo",
    "개인전", "기획전", "특별전", "상설전", "기념전", "회고전",
    # 특정 작가/장르
    "워홀", "warhol", "모네", "monet", "피카소", "picasso",
    "반고흐", "van gogh", "다빈치", "da vinci",
    "미술관", "박물관", "museum", "뮤지엄",
    "르누아르", "마티스", "드가", "세잔",
    "보테로", "botero", "롯데뮤지엄",
    # 뮤지컬/연극/클래식
    "뮤지컬", "musical", "연극", "오페라", "발레",
    "킨더콘체르트", "관현악", "심포니", "필하모닉",
    # 강연/세미나/체험
    "세미나", "강연", "특강", "포럼", "토크쇼",
    "마술사의 방",
)

# 위 키워드가 포함돼도 이 키워드도 포함되면 콘서트로 판정해 면제
_CONCERT_EXCEPTION_KEYWORDS = (
    "콘서트", "단독콘서트", "concert", "페스티벌", "festival",
    "내한", "시즌권", "정기공연", "투어", "tour", "라이브", "live",
)

_MAX_DURATION_DAYS = 90


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
            .select("id,title,start_date,end_date,venue_id")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def parse_date(date_str: str | None) -> date | None:
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    except Exception:
        return None


def should_delete(event: dict) -> str | None:
    """삭제 대상이면 이유 반환, 아니면 None"""
    title = (event.get("title") or "").strip()

    # 빈 제목
    if not title:
        return "제목 없음"

    title_lower = title.lower()
    is_concert = any(k in title_lower for k in _CONCERT_EXCEPTION_KEYWORDS)

    # 키워드 매칭 — 단, 제목에 콘서트/페스티벌 등이 명시돼 있으면 면제
    if not is_concert:
        for kw in _DELETE_KEYWORDS:
            if kw in title_lower:
                return f"키워드 '{kw}' 포함"

    # 기간 90일 초과 — 콘서트/시즌권 키워드 있으면 면제
    start = parse_date(event.get("start_date"))
    end = parse_date(event.get("end_date"))
    if start and end and (end - start).days > _MAX_DURATION_DAYS:
        if not is_concert:
            return f"공연기간 {(end - start).days}일 초과"

    return None


def delete_events(client, ids: list[str]) -> int:
    """이벤트 배치 삭제. 반환: 삭제 건수"""
    deleted = 0
    batch = 50
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        client.table("events").delete().in_("id", chunk).execute()
        deleted += len(chunk)
    return deleted


def cleanup_orphan_venues(client, dry_run: bool) -> int:
    """events에 참조되지 않는 venue 삭제"""
    all_venues = client.table("venues").select("id,name").execute().data or []
    referenced = set(
        r["venue_id"]
        for r in (client.table("events").select("venue_id").execute().data or [])
        if r.get("venue_id")
    )
    orphans = [v for v in all_venues if v["id"] not in referenced]
    if dry_run:
        print(f"\n[미사용 Venue] {len(orphans)}개 (dry-run — 실제 삭제 안 함)")
        for v in orphans[:10]:
            print(f"  - {v['name']}")
        if len(orphans) > 10:
            print(f"  ... 외 {len(orphans)-10}개")
        return 0

    ids = [v["id"] for v in orphans]
    if ids:
        for i in range(0, len(ids), 50):
            client.table("venues").delete().in_("id", ids[i:i+50]).execute()
    print(f"  → 미사용 Venue {len(ids)}개 삭제 완료")
    return len(ids)


def cleanup_unlinked_stagepick(client, dry_run: bool) -> int:
    """StagePick source 중 artist_id가 NULL인 이벤트 삭제"""
    resp = (
        client.table("events")
        .select("id,title,source_urls")
        .is_("artist_id", "null")
        .execute()
    )
    rows = resp.data or []
    stagepick_rows = [
        r for r in rows
        if any(s.get("site") == "stagepick" for s in (r.get("source_urls") or []))
    ]

    print(f"\n[StagePick 미연결 이벤트] {len(stagepick_rows)}개")
    for r in stagepick_rows[:20]:
        print(f"  • {r['title'][:70]}")
    if len(stagepick_rows) > 20:
        print(f"  ... 외 {len(stagepick_rows)-20}개")

    if dry_run or not stagepick_rows:
        return 0

    ids = [r["id"] for r in stagepick_rows]
    for i in range(0, len(ids), 50):
        client.table("events").delete().in_("id", ids[i:i+50]).execute()
    print(f"  → {len(ids)}개 삭제 완료")
    return len(ids)


def cleanup_empty_artists(client, dry_run: bool) -> int:
    """avatar_url 없는 아티스트 삭제"""
    resp = client.table("artists").select("id,name,avatar_url").execute()
    rows = resp.data or []
    empty = [r for r in rows if not r.get("avatar_url")]

    print(f"\n[빈 아티스트 (avatar 없음)] {len(empty)}개")
    for r in empty[:20]:
        print(f"  • {r['name']}")
    if len(empty) > 20:
        print(f"  ... 외 {len(empty)-20}개")

    if dry_run or not empty:
        return 0

    ids = [r["id"] for r in empty]
    for i in range(0, len(ids), 50):
        client.table("artists").delete().in_("id", ids[i:i+50]).execute()
    print(f"  → {len(ids)}개 아티스트 삭제 완료")
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description="DB 오염 데이터 정리")
    parser.add_argument("--execute", action="store_true", help="실제 삭제 실행 (기본: dry-run)")
    parser.add_argument("--fix-venues", action="store_true", help="미사용 Venue도 함께 정리")
    parser.add_argument("--unlinked-stagepick", action="store_true", help="StagePick 중 artist 미연결 이벤트 삭제")
    parser.add_argument("--empty-artists", action="store_true", help="avatar_url 없는 아티스트 삭제")
    args = parser.parse_args()
    dry_run = not args.execute

    client = get_client()

    print("전체 이벤트 조회 중...")
    events = fetch_all_events(client)
    print(f"  총 {len(events)}개 이벤트")

    targets: list[tuple[str, str, str]] = []  # (id, title, reason)
    for ev in events:
        reason = should_delete(ev)
        if reason:
            targets.append((ev["id"], ev.get("title", ""), reason))

    print(f"\n삭제 대상: {len(targets)}개")
    if targets:
        from collections import defaultdict
        by_reason: dict[str, list[str]] = defaultdict(list)
        for _, title, reason in targets:
            key = reason.split("'")[1] if "키워드" in reason else reason
            by_reason[key].append(title)

        for reason, titles in sorted(by_reason.items()):
            print(f"\n  [{reason}] {len(titles)}개:")
            for t in titles[:5]:
                print(f"    • {t[:60]}")
            if len(titles) > 5:
                print(f"    ... 외 {len(titles)-5}개")

    if dry_run:
        print(f"\n[dry-run] 위 {len(targets)}개가 삭제될 예정입니다.")
        print("실제 삭제하려면: python cleanup_db.py --execute")
    else:
        if not targets:
            print("삭제할 대상이 없습니다.")
        else:
            ids = [t[0] for t in targets]
            deleted = delete_events(client, ids)
            print(f"\n  → 이벤트 {deleted}개 삭제 완료")

    if args.fix_venues:
        cleanup_orphan_venues(client, dry_run)

    if args.unlinked_stagepick:
        cleanup_unlinked_stagepick(client, dry_run)

    if args.empty_artists:
        cleanup_empty_artists(client, dry_run)

    print("\n완료!")


if __name__ == "__main__":
    main()
