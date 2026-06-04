-- 자기치유 — 아티스트가 실제 음악인인지 Gemini 검증 결과 저장.
-- is_music_artist=false 면 그 아티스트에 연결된 이벤트는 비공연(전시/배우 등)일 확률이 높아
-- 파이프라인이 자동 정리한다(제목 분류기가 놓친 비콘서트를 2차로 잡는 자가교정 루프).
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS is_music_artist BOOLEAN;
