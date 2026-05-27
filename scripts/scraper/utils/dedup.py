"""dedup_key 생성"""
import hashlib
from datetime import date
from typing import Optional

from utils.normalizer import normalize_title, normalize_venue


def make_dedup_key(title: str, venue: str, start_date: Optional[date]) -> str:
    """
    SHA256(normalize(title)|normalize(venue)|YYYYMMDD)[:32]
    start_date가 없으면 "00000000"으로 대체
    """
    date_str = start_date.strftime("%Y%m%d") if start_date else "00000000"
    raw = f"{normalize_title(title)}|{normalize_venue(venue)}|{date_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
