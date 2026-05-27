"""사이트별 설정"""

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
}

REQUEST_DELAY = 0.8   # 요청 간격 (초) — 서버 부하 방지

YANOLJA = {
    "list_url": "https://nol.yanolja.com/sub-home/entertainment?verticalCategory=LOCAL_ENTERTAINMENT",
    "base_url": "https://nol.yanolja.com",
    "source_name": "yanolja",
}

YES24 = {
    "ajax_url": "https://ticket.yes24.com/New/Genre/Ajax/GenreList_Data.aspx",
    "detail_base": "https://ticket.yes24.com/Perf/",
    "genre_codes": ["15456", "15464"],  # 콘서트전체, 페스티벌
    "page_size": 20,
    "source_name": "yes24",
}

FESTIVALLIFE = {
    "categories": {
        "concert": "https://www.festivallife.kr/concert/",
        "festival": "https://www.festivallife.kr/festival/",
        "concert_k": "https://www.festivallife.kr/concert_k/",
    },
    "list_q": "YToxOntzOjEyOiJrZXl3b3JkX3R5cGUiO3M6MzoiYWxsIjt9",
    "source_name": "festivallife",
    "page_size": 15,
}

INTERPARK = {
    "genre_urls": {
        "concert": "https://tickets.interpark.com/contents/genre/concert",
    },
    "source_name": "interpark",
}

MELON = {
    "ajax_url": "https://ticket.melon.com/performance/ajax/prodList.json",
    "genre_codes": ["GENRE_CON_ALL"],  # 전체 콘서트
    "source_name": "melon",
}

STAGEPICK = {
    "api_base": "https://api.stagepick.co.kr/v1",
    "source_name": "stagepick",
}

NAVER = {
    # 네이버 뮤직 공연 탭 (콘서트/페스티벌 카테고리)
    "list_url": "https://m.search.naver.com/search.naver",
    "concert_query": "콘서트",
    "festival_query": "페스티벌",
    "source_name": "naver",
}
