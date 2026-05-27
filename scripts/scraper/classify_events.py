#!/usr/bin/env python3
"""
Claude AI로 DB 이벤트 분류 — 미술전시/비공연 일괄 삭제

사용법:
  python classify_events.py            # dry-run (삭제 대상 출력만)
  python classify_events.py --execute  # 실제 삭제 실행

환경 변수:
  SUPABASE_URL, SUPABASE_SERVICE_KEY
  ANTHROPIC_API_KEY
"""
import argparse
import json
import os
import sys
import time
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

_SYSTEM_PROMPT = """당신은 공연/이벤트 분류 전문가입니다.
각 이벤트 제목을 보고 아래 기준으로 분류하세요.

[유지] 가수, 밴드, DJ 등 음악 아티스트의 라이브 공연:
- 콘서트, 단독공연, 내한공연, 페스티벌, 음악 페스티벌, 투어 공연
- K-POP, 팝, 록, 힙합, R&B, EDM, 인디 등 모든 장르의 음악 공연

[삭제] 음악 공연이 아닌 모든 이벤트:
- 미술 전시회, 갤러리, 사진전, 작품전 (개인전, 기획전, 회고전 등)
- 뮤지컬, 연극, 오페라, 발레, 무용
- 클래식 음악회 (오케스트라, 심포니, 필하모닉, 챔버)
- 전통공연 (국악, 판소리 등)
- 강연, 세미나, 포럼, 토크쇼
- 어린이/가족 공연 (킨더콘체르트 등)
- 체험 행사, 마켓, 축제 (음악 없는)
- 영화, 영상 이벤트

애매한 경우: 제목에 특정 가수/밴드 이름이 명확히 보이면 [유지], 아니면 [삭제]."""


def get_supabase_client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[오류] SUPABASE_URL / SUPABASE_SERVICE_KEY 환경 변수가 없습니다.")
        sys.exit(1)
    from supabase import create_client
    return create_client(url, key)


def get_anthropic_client():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        print("[오류] ANTHROPIC_API_KEY 환경 변수가 없습니다.")
        sys.exit(1)
    import anthropic
    return anthropic.Anthropic(api_key=key)


def fetch_all_events(client) -> list[dict]:
    rows = []
    offset = 0
    while True:
        resp = (
            client.table("events")
            .select("id,title,genre,artist_id")
            .range(offset, offset + 999)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def classify_batch(
    anthropic_client,
    events: list[dict],
) -> list[str]:
    """
    events 리스트를 Claude에 전달해 삭제해야 할 event id 목록 반환.
    최대 100개씩 배치 처리.
    """
    numbered = [f"{i+1}. [id:{e['id']}] {e['title']}" for i, e in enumerate(events)]
    user_msg = (
        "다음 이벤트들을 분류해주세요.\n"
        "음악 공연이 아닌 것들의 id를 JSON 배열로만 반환하세요. 설명 없이.\n"
        "예시: [\"uuid1\", \"uuid2\"]\n\n"
        + "\n".join(numbered)
    )

    response = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = response.content[0].text.strip()
    # 응답에서 JSON 배열만 추출
    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start == -1 or end == 0:
        print(f"  [경고] Claude 응답 파싱 실패: {raw[:200]}")
        return []
    try:
        return json.loads(raw[start:end])
    except json.JSONDecodeError:
        print(f"  [경고] JSON 디코드 실패: {raw[:200]}")
        return []


def delete_events(client, ids: list[str]) -> int:
    deleted = 0
    batch = 50
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        client.table("events").delete().in_("id", chunk).execute()
        deleted += len(chunk)
    return deleted


def main():
    parser = argparse.ArgumentParser(description="Claude AI로 비공연 이벤트 분류 삭제")
    parser.add_argument("--execute", action="store_true", help="실제 삭제 (기본: dry-run)")
    parser.add_argument("--batch-size", type=int, default=80, help="Claude 한 번에 처리할 이벤트 수 (기본: 80)")
    args = parser.parse_args()
    dry_run = not args.execute

    supabase = get_supabase_client()
    anthropic = get_anthropic_client()

    print("DB 이벤트 전체 조회 중...")
    events = fetch_all_events(supabase)
    print(f"  총 {len(events)}개 이벤트")

    # artist_id가 이미 연결된 이벤트는 음악 아티스트 공연으로 간주 → 분류 제외
    unlinked = [e for e in events if not e.get("artist_id")]
    linked_count = len(events) - len(unlinked)
    print(f"  artist_id 연결됨: {linked_count}개 (분류 제외)")
    print(f"  분류 대상 (artist_id 없음): {len(unlinked)}개")

    to_delete: list[str] = []
    batch_size = args.batch_size
    total_batches = (len(unlinked) + batch_size - 1) // batch_size

    for batch_idx in range(total_batches):
        batch = unlinked[batch_idx * batch_size:(batch_idx + 1) * batch_size]
        print(f"\n  배치 {batch_idx + 1}/{total_batches} 분류 중... ({len(batch)}개)")
        delete_ids = classify_batch(anthropic, batch)
        to_delete.extend(delete_ids)
        print(f"    → 삭제 대상 {len(delete_ids)}개 (누계: {len(to_delete)}개)")
        if batch_idx < total_batches - 1:
            time.sleep(1)  # API rate limit

    print(f"\n분류 완료 — 총 삭제 대상: {len(to_delete)}개")

    # 제목 미리보기
    id_to_title = {e["id"]: e["title"] for e in unlinked}
    for eid in to_delete[:20]:
        print(f"  • {id_to_title.get(eid, eid)[:70]}")
    if len(to_delete) > 20:
        print(f"  ... 외 {len(to_delete)-20}개")

    if dry_run:
        print(f"\n[dry-run] 위 {len(to_delete)}개가 삭제될 예정입니다.")
        print("실제 삭제: python classify_events.py --execute")
    else:
        if not to_delete:
            print("삭제할 대상 없음.")
        else:
            deleted = delete_events(supabase, to_delete)
            print(f"\n→ {deleted}개 이벤트 삭제 완료")
    print("\n완료!")


if __name__ == "__main__":
    main()
