export type EventStatus = "upcoming" | "on_sale" | "ended";

export type EventRow = {
  id: string;
  title: string;
  normalized_title: string | null;
  dedup_key: string | null;
  artist_id: string;
  venue_id: string;
  poster_url: string | null;
  start_date: string;
  end_date: string | null;
  status: EventStatus;
  genre: string | null;
  duration: string | null;
  age_restriction: string | null;
  ticket_open_date: string | null;
  ticket_provider: string | null;
  notice_text: string | null;
  is_banner: boolean;
  has_timetable: boolean;
};

export type OptionItem = {
  id: string;
  name: string;
};
