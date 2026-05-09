export type ArtistRow = {
  id: string;
  name: string;
  avatar_url: string | null;
  followers_count: number;
  upcoming_event_count: number;
  occupation: string | null;
  birth_date: string | null;
  birth_place: string | null;
  related: string | null;
};

export type AlbumRow = {
  id: string;
  artist_id: string;
  title: string;
  cover_url: string | null;
  released_year: string | null;
};

export type MusicVideoRow = {
  id: string;
  artist_id: string;
  title: string;
  thumbnail_url: string | null;
  view_count: string | null;
  like_count: string | null;
  uploaded_at: string | null;
};
