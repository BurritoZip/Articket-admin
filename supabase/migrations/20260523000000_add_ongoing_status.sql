-- events.status CHECK constraint에 'ongoing' 추가
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check
  CHECK (status IN ('upcoming', 'on_sale', 'ongoing', 'ended'));
