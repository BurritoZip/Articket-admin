/** 금액 패턴: "110,000원", "50000원", "₩50,000", "5만원" */
export const PRICE_RE = /(?:\d{1,3}(?:,\d{3})*원|₩\s*\d[\d,]*|\d+만\s*원)/;

/** 티켓 등급: R석, S석, A석, VIP, 스탠딩 등 */
export const TICKET_GRADE_RE = /\b([RSABVIP]석|VIP|스탠딩|STANDING|FLOOR)\b/i;

/** 날짜 패턴 */
export const DATE_RE = /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{4}년\s*\d{1,2}월/;

/** URL 패턴 */
export const URL_RE = /https?:\/\/|www\./i;

/** 한국 주소 키워드 */
export const ADDRESS_KEYWORDS_RE = /시|구|동|로|길|번지|특별시|광역시|도\s|읍|면/;

/** 공연장 이름처럼 보이는 키워드 (address 컬럼에 있으면 이상) */
export const VENUE_LIKE_RE =
  /홀$|관$|돔$|구장$|경기장$|아레나$|센터$|HALL$|DOME$|ARENA$/i;
