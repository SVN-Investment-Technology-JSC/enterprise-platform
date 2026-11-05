-- Lý do vướng mắc của công việc.
--  · work_items.blocked_reason, standalone_tasks.blocked_reason: lý do người thực hiện ghi khi chuyển việc sang
--    "Vướng mắc" (TEXT, cho phép rỗng). Chỉ có giá trị khi status = 'blocked'; rời trạng thái đó thì ứng dụng xoá.
--  · Bản app cũ không biết cột này: nó vẫn đổi trạng thái bình thường, chỉ không ghi/xoá lý do (lùi image không cần
--    lùi schema).
--  · Việc cũ ĐANG ở Vướng mắc: chép ghi chú của dòng nhật ký mới nhất chuyển sang 'blocked' (nếu có ghi chú).
--    Chỉ chạm việc chưa có lý do nên chạy lại không đè lên lý do đã sửa.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

ALTER TABLE workspace_schema.standalone_tasks
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

UPDATE workspace_schema.work_items w
   SET blocked_reason = h.note
  FROM (
        SELECT DISTINCT ON (work_item_id) work_item_id, btrim(note) AS note
          FROM workspace_schema.work_item_status_history
         WHERE to_status = 'blocked'
           AND work_item_id IS NOT NULL
           AND btrim(COALESCE(note, '')) <> ''
         ORDER BY work_item_id, created_at DESC, id DESC
       ) h
 WHERE w.id = h.work_item_id
   AND w.status = 'blocked'
   AND w.blocked_reason IS NULL;

UPDATE workspace_schema.standalone_tasks t
   SET blocked_reason = h.note
  FROM (
        SELECT DISTINCT ON (task_id) task_id, btrim(note) AS note
          FROM workspace_schema.standalone_task_history
         WHERE to_status = 'blocked'
           AND btrim(COALESCE(note, '')) <> ''
         ORDER BY task_id, created_at DESC, id DESC
       ) h
 WHERE t.id = h.task_id
   AND t.status = 'blocked'
   AND t.blocked_reason IS NULL;
