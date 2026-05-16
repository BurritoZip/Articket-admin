export type TimetablePerformanceRow = {
  id: string;
  event_id: string;
  artist_id: string | null;
  day_number: number;
  date_string: string;
  start_time: string;
  end_time: string;
  artist_name: string;
  stage_name: string;
  genre: string;
  created_at: string;
};
