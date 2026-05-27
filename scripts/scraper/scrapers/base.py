"""스크래퍼 추상 기반 클래스"""
import time
from abc import ABC, abstractmethod
from typing import Any

import requests

from config import HEADERS, REQUEST_DELAY


class BaseScraper(ABC):

    def __init__(self, source_name: str):
        self.source_name = source_name
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def get(self, url: str, **kwargs) -> requests.Response:
        time.sleep(REQUEST_DELAY)
        resp = self.session.get(url, timeout=20, **kwargs)
        resp.raise_for_status()
        return resp

    @abstractmethod
    def scrape(self) -> list[dict[str, Any]]:
        """스크래핑 실행. 반환: 정규화된 이벤트 딕셔너리 리스트"""
        ...