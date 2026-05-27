"""
정규화 유틸리티 단위 테스트 (P6 파싱 정확도 검증)

목표: parse_date_range / normalize_title / sanitize_venue
      각 10개 이상 케이스 95% 통과
"""

import sys
import os
from datetime import date

import pytest

# scraper 패키지를 sys.path에 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils.normalizer import (
    parse_date_range,
    normalize_title,
    sanitize_venue,
    is_exhibition,
    determine_status,
)


# ─────────────────────────────────────────────
# parse_date_range
# ─────────────────────────────────────────────


class TestParseDateRange:
    """날짜 파싱 — 형식 1~5 + 엣지케이스 커버."""

    def test_dot_range(self):
        start, end = parse_date_range("2026.08.14 ~ 2026.08.16")
        assert start == date(2026, 8, 14)
        assert end == date(2026, 8, 16)

    def test_dot_range_dash_separator(self):
        start, end = parse_date_range("2026.08.14 - 2026.08.16")
        assert start == date(2026, 8, 14)
        assert end == date(2026, 8, 16)

    def test_hyphen_range(self):
        start, end = parse_date_range("2026-08-14 ~ 2026-08-16")
        assert start == date(2026, 8, 14)
        assert end == date(2026, 8, 16)

    def test_dot_with_spaces(self):
        """"2026. 08. 14 ~ 2026. 08. 16" — 공백 포함 점 구분자."""
        start, end = parse_date_range("2026. 08. 14 ~ 2026. 08. 16")
        assert start == date(2026, 8, 14)
        assert end == date(2026, 8, 16)

    def test_single_date(self):
        start, end = parse_date_range("2026.11.20")
        assert start == date(2026, 11, 20)
        assert end is None

    def test_korean_range_same_month(self):
        start, end = parse_date_range("2026년 6월 6~7일 (토~일)")
        assert start == date(2026, 6, 6)
        assert end == date(2026, 6, 7)

    def test_korean_single_date(self):
        start, end = parse_date_range("2026년 6월 6일 (토)")
        assert start == date(2026, 6, 6)
        assert end is None

    def test_korean_with_surrounding_text(self):
        start, end = parse_date_range("공연 일정: 2026년 12월 25일 (금)")
        assert start == date(2026, 12, 25)
        assert end is None

    def test_empty_string(self):
        start, end = parse_date_range("")
        assert start is None
        assert end is None

    def test_garbage_text(self):
        start, end = parse_date_range("날짜 미정")
        assert start is None
        assert end is None

    def test_single_date_no_range(self):
        """단일 날짜는 end=None."""
        start, end = parse_date_range("2025.03.01")
        assert start == date(2025, 3, 1)
        assert end is None

    def test_month_only_range_infers_year(self):
        """연도 없는 MM.DD ~ MM.DD 형식."""
        start, end = parse_date_range("11.20 ~ 11.23")
        assert start is not None
        assert end is not None
        assert start.month == 11 and start.day == 20
        assert end.month == 11 and end.day == 23


# ─────────────────────────────────────────────
# normalize_title
# ─────────────────────────────────────────────


class TestNormalizeTitle:
    """제목 정규화 — dedup 키 생성 일관성 검증."""

    def test_basic_korean(self):
        assert normalize_title("백예린 콘서트") == "백예린콘서트"

    def test_strips_special_chars(self):
        # 특수문자, 괄호, 점 등 제거
        assert normalize_title("[2026] 백예린 Live!") == "2026백예린live"

    def test_lowercase(self):
        assert normalize_title("BTS World Tour") == "btsworldtour"

    def test_nfkc_normalization(self):
        # 전각 문자 → 반각 정규화
        result = normalize_title("ＢＴＳ　콘서트")
        assert result == "bts콘서트"

    def test_numbers_preserved(self):
        assert normalize_title("2026 Tour") == "2026tour"

    def test_empty_string(self):
        assert normalize_title("") == ""

    def test_whitespace_only(self):
        assert normalize_title("   ") == ""

    def test_same_title_different_spacing(self):
        """공백 패턴이 달라도 동일한 키 생성."""
        a = normalize_title("백예린  콘서트")
        b = normalize_title("백예린 콘서트")
        assert a == b

    def test_emoji_stripped(self):
        result = normalize_title("🎵 백예린 콘서트 🎵")
        assert "백예린" in result
        assert "🎵" not in result

    def test_mixed_language(self):
        result = normalize_title("IU 아이유 Concert 2026")
        assert result == "iu아이유concert2026"


# ─────────────────────────────────────────────
# sanitize_venue
# ─────────────────────────────────────────────


class TestSanitizeVenue:
    """공연장 정제 및 동의어 표준화 검증."""

    def test_alias_kspo_dome_variant(self):
        assert sanitize_venue("올림픽체조경기장", "some title") == "KSPO DOME"

    def test_alias_olympic_main_stadium(self):
        assert sanitize_venue("잠실올림픽주경기장", "some title") == "올림픽공원 주경기장"

    def test_alias_gocheok_dome(self):
        assert sanitize_venue("고척돔", "some title") == "고척 스카이돔"

    def test_alias_inspire_arena(self):
        assert sanitize_venue("인스파이어아레나", "some title") == "인스파이어 아레나"

    def test_no_alias_passthrough(self):
        """알 수 없는 공연장명은 그대로 반환."""
        result = sanitize_venue("홍대 V홀", "some title")
        assert result == "홍대 V홀"

    def test_same_as_title_returns_empty(self):
        """venue == title이면 빈 문자열 반환."""
        title = "백예린 콘서트"
        result = sanitize_venue(title, title)
        assert result == ""

    def test_date_pattern_returns_empty(self):
        """날짜 패턴이 venue에 들어오면 빈 문자열."""
        result = sanitize_venue("2026.08.14 ~ 2026.08.16", "콘서트")
        assert result == ""

    def test_empty_venue(self):
        assert sanitize_venue("", "콘서트") == ""

    def test_coex_artium_alias(self):
        assert sanitize_venue("코엑스아티움", "some title") == "코엑스 아티움"

    def test_88_lawn_alias(self):
        assert sanitize_venue("88잔디마당", "some title") == "올림픽공원 88잔디마당"


# ─────────────────────────────────────────────
# is_exhibition (보너스)
# ─────────────────────────────────────────────


class TestIsExhibition:
    def test_exhibition_keyword(self):
        assert is_exhibition("보테로 특별전시") is True

    def test_concert_not_exhibition(self):
        assert is_exhibition("백예린 2026 Live Concert") is False

    def test_musical_filtered(self):
        assert is_exhibition("뮤지컬 레미제라블") is True

    def test_opera_filtered(self):
        assert is_exhibition("오페라 투란도트") is True


# ─────────────────────────────────────────────
# determine_status (보너스)
# ─────────────────────────────────────────────


class TestDetermineStatus:
    def test_future_event(self):
        status = determine_status(date(2099, 1, 1), date(2099, 1, 2))
        assert status == "upcoming"

    def test_past_event(self):
        status = determine_status(date(2000, 1, 1), date(2000, 1, 2))
        assert status == "ended"

    def test_no_start_date(self):
        assert determine_status(None, None) == "upcoming"
