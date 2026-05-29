"""
입력 데이터 유효성 검증 — DB UPSERT 전에 호출.
규칙이 통과하지 못하면 (False, [에러 목록]) 반환 → 저장 건너뜀.
"""

import re
from datetime import date
from typing import Optional

PRICE_RE = re.compile(r"(?:\d{1,3}(?:,\d{3})*원|₩\s*\d[\d,]*|\d+만\s*원)")
TICKET_GRADE_RE = re.compile(r"\b([RSABVIP]석|VIP|스탠딩|STANDING|FLOOR)\b", re.IGNORECASE)
DATE_RE = re.compile(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{4}년\s*\d{1,2}월")
URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)


def _is_garbage(s: str) -> bool:
    stripped = PRICE_RE.sub("", s)
    stripped = TICKET_GRADE_RE.sub("", stripped)
    stripped = DATE_RE.sub("", stripped)
    stripped = re.sub(r"[\s\-·_,]+", "", stripped).strip()
    return len(stripped) <= 1


def validate_event(
    title: str,
    dedup_key: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    source_name: str = "",
) -> tuple[bool, list[str]]:
    errors = []

    if not title or len(title.strip()) < 2:
        errors.append("제목은 최소 2자 이상")
    elif len(title) > 300:
        errors.append("제목은 300자 이하")
    elif URL_RE.search(title):
        errors.append("제목에 URL 포함 불가")

    if not dedup_key:
        errors.append("dedup_key 필수")

    if start_date and end_date and end_date < start_date:
        errors.append("end_date는 start_date 이후여야 함")

    return (len(errors) == 0, errors)


def validate_artist(name: str, avatar_url: Optional[str] = None) -> tuple[bool, list[str]]:
    errors = []

    if not name or len(name.strip()) == 0:
        errors.append("아티스트 이름 필수")
    elif len(name) > 100:
        errors.append("이름은 100자 이하")
    elif URL_RE.search(name):
        errors.append("아티스트 이름에 URL 포함 불가")
    elif name.strip().isdigit():
        errors.append("이름이 숫자만으로 구성됨")

    if avatar_url and not (avatar_url.startswith("http://") or avatar_url.startswith("https://")):
        errors.append("avatar_url이 유효한 URL이 아님")

    return (len(errors) == 0, errors)


def validate_venue(name: str, address: Optional[str] = None) -> tuple[bool, list[str]]:
    errors = []

    if not name or len(name.strip()) < 2:
        errors.append("공연장 이름은 최소 2자 이상")
    elif len(name) > 200:
        errors.append("공연장 이름은 200자 이하")
    elif PRICE_RE.search(name):
        errors.append("공연장 이름에 가격 정보 포함")
    elif TICKET_GRADE_RE.search(name):
        errors.append("공연장 이름에 티켓 등급 포함")
    elif DATE_RE.search(name):
        errors.append("공연장 이름에 날짜 포함")
    elif URL_RE.search(name):
        errors.append("공연장 이름에 URL 포함")
    elif _is_garbage(name):
        errors.append("공연장 이름이 의미 없는 값")

    if address:
        if PRICE_RE.search(address):
            errors.append("주소에 가격 정보 포함")
        elif URL_RE.search(address):
            errors.append("주소에 URL 포함")
        elif address.strip() == name.strip():
            errors.append("주소가 공연장 이름과 동일")

    return (len(errors) == 0, errors)
