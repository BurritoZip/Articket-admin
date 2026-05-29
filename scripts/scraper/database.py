"""Supabase UPSERT 헬퍼"""
import uuid
from datetime import date, datetime
from typing import Optional

from supabase import Client
from validation import validate_venue, validate_artist, validate_event


def upsert_venue(client: Client, name: str, address: str, phone: Optional[str] = None) -> Optional[str]:
    """공연장 UPSERT. 반환: venue_id (UUID string) 또는 None (검증 실패)"""
    ok, errors = validate_venue(name, address)
    if not ok:
        print(f"  [공연장 검증 실패] {name!r}: {'; '.join(errors)}")
        return None

    existing = (
        client.table("venues")
        .select("id")
        .eq("name", name)
        .eq("address", address)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]

    result = client.table("venues").insert({
        "name": name,
        "address": address,
        "phone_number": phone,
    }).execute()
    return result.data[0]["id"]


def upsert_artist(
    client: Client,
    name: str,
    avatar_url: Optional[str] = None,
    upcoming_event_count: Optional[int] = None,
) -> Optional[str]:
    """아티스트 UPSERT (이름 기준). 반환: artist_id (UUID string) 또는 None (검증 실패)"""
    ok, errors = validate_artist(name, avatar_url)
    if not ok:
        print(f"  [아티스트 검증 실패] {name!r}: {'; '.join(errors)}")
        return None

    existing = client.table("artists").select("id").eq("name", name).execute()
    if existing.data:
        artist_id = existing.data[0]["id"]
        update = {}
        if avatar_url:
            update["avatar_url"] = avatar_url
        if upcoming_event_count is not None:
            update["upcoming_event_count"] = upcoming_event_count
        if update:
            client.table("artists").update(update).eq("id", artist_id).execute()
        return artist_id

    payload: dict = {"name": name}
    if avatar_url:
        payload["avatar_url"] = avatar_url
    if upcoming_event_count is not None:
        payload["upcoming_event_count"] = upcoming_event_count
    result = client.table("artists").insert(payload).execute()
    return result.data[0]["id"]


def upsert_event(
    client: Client,
    *,
    dedup_key: str,
    title: str,
    artist_id: Optional[str],
    venue_id: Optional[str],
    start_date: Optional[date],
    end_date: Optional[date],
    status: str,
    genre: str,
    poster_url: Optional[str] = None,
    ticket_open_date: Optional[datetime] = None,
    ticket_close_date: Optional[datetime] = None,
    ticket_provider: Optional[str] = None,
    organizer: Optional[str] = None,
    source_name: str,
    source_url: Optional[str] = None,
) -> Optional[str]:
    """
    이벤트 UPSERT.
    - 신규: INSERT
    - 기존(dedup_key 충돌): source_urls에 새 출처 추가, crawled_at 갱신
    반환: event_id 또는 None (검증 실패)
    """
    ok, errors = validate_event(title, dedup_key, start_date, end_date, source_name)
    if not ok:
        print(f"  [이벤트 검증 실패] {title!r}: {'; '.join(errors)}")
        return None

    source_entry = {"site": source_name, "url": source_url} if source_url else {"site": source_name}

    # 1차: dedup_key 정확 매칭
    existing = client.table("events").select("id,source_urls").eq("dedup_key", dedup_key).execute()

    # 2차 fallback: venue 없이 스크랩된 보조 사이트를 위해 title+start_date 기준으로 StagePick 이벤트 찾기
    if not existing.data and title and start_date:
        date_str = start_date.isoformat() + "T00:00:00+00:00"
        fallback = (
            client.table("events")
            .select("id,source_urls,venue_id")
            .eq("title", title)
            .eq("start_date", date_str)
            .not_.is_("venue_id", "null")  # StagePick은 venue를 항상 가짐
            .execute()
        )
        if fallback.data:
            existing = fallback

    if existing.data:
        event_id = existing.data[0]["id"]
        current_sources = existing.data[0].get("source_urls") or []
        # 동일 사이트 중복 추가 방지
        if not any(s.get("site") == source_name for s in current_sources):
            current_sources.append(source_entry)
            client.table("events").update({
                "source_urls": current_sources,
                "crawled_at": datetime.utcnow().isoformat(),
            }).eq("id", event_id).execute()
        return event_id

    payload = {
        "title": title,
        "dedup_key": dedup_key,
        "source_urls": [source_entry],
        "crawled_at": datetime.utcnow().isoformat(),
        "status": status,
        "genre": genre,
    }
    if artist_id:
        payload["artist_id"] = artist_id
    if venue_id:
        payload["venue_id"] = venue_id
    if start_date:
        payload["start_date"] = start_date.isoformat() + "T00:00:00+00:00"
    effective_end = end_date or start_date
    if effective_end:
        payload["end_date"] = effective_end.isoformat() + "T23:59:59+00:00"
    if poster_url:
        payload["poster_url"] = poster_url
    if ticket_open_date:
        payload["ticket_open_date"] = ticket_open_date.isoformat()
    if ticket_close_date:
        payload["ticket_close_date"] = ticket_close_date.isoformat()
    if ticket_provider:
        payload["ticket_provider"] = ticket_provider
    if organizer:
        payload["organizer"] = organizer

    result = client.table("events").insert(payload).execute()
    return result.data[0]["id"]
