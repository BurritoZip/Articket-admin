"""텍스트 정규화 및 한국어 날짜 파싱"""
import re
import unicodedata
from datetime import date, datetime
from typing import Optional, Tuple

# 공연장 동의어 매핑 — 동일 공연장의 다양한 표기를 표준 명칭으로 통일
# key: 정규화된 별칭(normalize_venue 적용 후), value: 표준 공연장명
_VENUE_ALIASES: dict[str, str] = {
    # 올림픽공원
    "서울올림픽주경기장":         "올림픽공원 주경기장",
    "잠실올림픽주경기장":         "올림픽공원 주경기장",
    "잠실주경기장":               "올림픽공원 주경기장",
    "올림픽주경기장":             "올림픽공원 주경기장",
    "올림픽공원주경기장":         "올림픽공원 주경기장",
    "올림픽공원88잔디마당":       "올림픽공원 88잔디마당",
    "88잔디마당":                 "올림픽공원 88잔디마당",
    # KSPO DOME (구 올림픽체조경기장)
    "kspo돔":                     "KSPO DOME",
    "올림픽체조경기장":           "KSPO DOME",
    "체조경기장":                 "KSPO DOME",
    # 고척 스카이돔
    "고척스카이돔":               "고척 스카이돔",
    "고척돔":                     "고척 스카이돔",
    # 잠실실내체육관
    "잠실실내체육관":             "잠실실내체육관",
    "잠실체육관":                 "잠실실내체육관",
    # 코엑스
    "코엑스아티움":               "코엑스 아티움",
    "코엑스홀":                   "코엑스 홀",
    # 인스파이어
    "인스파이어아레나":           "인스파이어 아레나",
    # 기타
    "잠실야구장":                 "잠실 야구장",
    "수원월드컵경기장":           "수원 월드컵 경기장",
}


_EXHIBITION_KEYWORDS = (
    "전시", "전시회", "전람회", "전람", "전시관", "갤러리",
    "exhibition", "expo", "gallery",
    "개인전", "기획전", "특별전", "상설전", "기념전", "회고전",
    "미술관", "박물관", "museum", "뮤지엄",
    "보테로", "botero", "롯데뮤지엄",
    "사진전", "작품전", "예술관",
    "뮤지컬", "musical", "연극", "오페라", "발레",
    "킨더콘체르트", "관현악", "심포니", "필하모닉",
    "세미나", "강연", "특강", "포럼",
)

_DATE_PATTERN = re.compile(r"^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}")


def is_exhibition(title: str) -> bool:
    """전시/갤러리 등 공연이 아닌 콘텐츠 여부 판별"""
    title_lower = title.lower()
    return any(kw in title_lower for kw in _EXHIBITION_KEYWORDS)


def sanitize_venue(venue_name: str, title: str) -> str:
    """venue_name 정제 및 동의어 표준화.
    - title과 동일하거나 날짜 패턴이면 빈 문자열 반환
    - _VENUE_ALIASES 매핑으로 표준 공연장명으로 치환
    """
    if not venue_name:
        return ""
    if normalize_title(venue_name) == normalize_title(title):
        return ""
    if _DATE_PATTERN.match(venue_name.strip()):
        return ""
    # 동의어 표준화
    norm_key = normalize_venue(venue_name)
    if norm_key in _VENUE_ALIASES:
        return _VENUE_ALIASES[norm_key]
    return venue_name


# 제목 정규화 (dedup 키 생성용)
def normalize_title(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.lower()
    text = re.sub(r"[^\w가-힣]", "", text, flags=re.UNICODE)
    return text.strip()


def normalize_venue(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.lower()
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^\w가-힣]", "", text, flags=re.UNICODE)
    return text.strip()


def parse_date_range(raw: str) -> Tuple[Optional[date], Optional[date]]:
    """
    지원 형식:
      "2026.08.14 ~ 2026.08.16"   "2026.08.14 - 2026.08.16"
      "2026. 08. 14 ~ 2026. 08. 16"  (공백 포함)
      "2026년 6월 6~7일 (토~일)"   "2026년 6월 6일 (토)"
      "2026-08-14 ~ 2026-08-16"
    """
    raw = raw.strip()
    # 구분자 사이 공백 정규화: "2026. 06. 06" → "2026.06.06"
    raw = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", raw)

    # 형식 1: "YYYY.MM.DD ~ YYYY.MM.DD" / "YYYY.MM.DD - YYYY.MM.DD"
    m = re.search(
        r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s*[~～\-]\s*(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})",
        raw
    )
    if m:
        y1, mo1, d1, y2, mo2, d2 = (int(x) for x in m.groups())
        return _safe_date(y1, mo1, d1), _safe_date(y2, mo2, d2)

    # 형식 2: "YYYY.MM.DD" (단일)
    m = re.search(r"(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})", raw)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _safe_date(y, mo, d), None

    # 형식 3: "YYYY년 MM월 DD~DD일"
    m = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})[~～](\d{1,2})일", raw)
    if m:
        y, mo, d1, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return _safe_date(y, mo, d1), _safe_date(y, mo, d2)

    # 형식 4: "YYYY년 MM월 DD일"
    m = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일", raw)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _safe_date(y, mo, d), None

    # 형식 5: "MM.DD ~ MM.DD" (연도 없음 → 올해 또는 내년)
    m = re.search(r"(\d{1,2})[.\-](\d{1,2})\s*[~～]\s*(\d{1,2})[.\-](\d{1,2})", raw)
    if m:
        mo1, d1, mo2, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        year = _infer_year(mo1)
        return _safe_date(year, mo1, d1), _safe_date(year, mo2, d2)

    return None, None


def _safe_date(y: int, mo: int, d: int) -> Optional[date]:
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def _infer_year(month: int) -> int:
    today = date.today()
    if month >= today.month:
        return today.year
    return today.year + 1


def determine_status(start: Optional[date], end: Optional[date]) -> str:
    if start is None:
        return "upcoming"
    today = date.today()
    if end and today > end:
        return "ended"
    if today >= start:
        return "on_sale"
    return "upcoming"
