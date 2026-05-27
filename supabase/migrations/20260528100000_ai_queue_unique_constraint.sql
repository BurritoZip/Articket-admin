-- ai_processing_queue: entity_id + task_type 중복 방지 유니크 제약 추가
-- (upsert ON CONFLICT 구문에 필요)
ALTER TABLE ai_processing_queue
  ADD CONSTRAINT uq_ai_queue_entity_task UNIQUE (entity_id, task_type);
