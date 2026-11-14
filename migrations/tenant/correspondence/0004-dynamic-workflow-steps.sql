-- Quy trình động: giữa ô đầu (văn thư tiếp nhận / phòng ban soạn thảo) và ô cuối (hoàn tất / ban hành, lưu trữ)
-- là các bước cấu hình tự do, mỗi bước một loại: 'process' (phòng ban xử lý), 'check' (văn thư kiểm tra),
-- 'approve' (duyệt). Trước đây "phòng ban xử lý" (đến) và "văn thư kiểm tra" (đi) là bước cứng đứng trước các bước
-- duyệt; file này thêm chúng thành bước đầu của các quy trình đang có để công văn chạy y như cũ, và bổ sung bước
-- tương ứng cho công văn đang chạy dở. Ô đầu, ô cuối đổi được tên theo quy trình.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- --------------------------------------------------------------------------------------------- quy trình
ALTER TABLE correspondence_schema.workflows
    ADD COLUMN IF NOT EXISTS start_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS end_name   VARCHAR(160);

-- Bước cũ không ghi loại là bước duyệt; quy trình chưa có bước phòng ban / văn thư thì thêm bước cứng cũ lên đầu.
UPDATE correspondence_schema.workflows w
   SET steps = jsonb_build_array(
                 CASE w.direction
                   WHEN 'incoming' THEN '{"key": "dept-process", "name": "Phòng ban xử lý", "type": "process"}'::jsonb
                   ELSE '{"key": "clerk-check", "name": "Văn thư kiểm tra", "type": "check"}'::jsonb
                 END)
               || COALESCE((SELECT jsonb_agg((s - 'kind') || '{"type": "approve"}'::jsonb ORDER BY e.ord)
                              FROM jsonb_array_elements(w.steps) WITH ORDINALITY AS e(s, ord)), '[]'::jsonb),
       updated_at = now()
 WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(w.steps) s WHERE s ->> 'type' IN ('process', 'check'));

-- --------------------------------------------------------------------------------------------- bước trên công văn
ALTER TABLE correspondence_schema.letter_steps DROP CONSTRAINT IF EXISTS letter_steps_kind_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letter_steps_kind') THEN
        ALTER TABLE correspondence_schema.letter_steps
            ADD CONSTRAINT chk_correspondence_letter_steps_kind CHECK (kind IN ('direct', 'approve', 'process', 'check'));
    END IF;
END
$$;
-- Bước phòng ban, văn thư không có luật người duyệt.
ALTER TABLE correspondence_schema.letter_steps ALTER COLUMN approver DROP NOT NULL;

-- Công văn đã rời ô đầu theo luồng cũ: đến thì đã giao phòng ban (có lịch sử 'dispatch'), đi thì văn thư đã kiểm
-- tra xong (có 'submit'). Dời các bước duyệt đã chép xuống một số rồi chèn bước cứng cũ vào vị trí 1.
-- Công văn đi đang chờ văn thư kiểm tra làm riêng ở dưới (chép lại cả quy trình).
CREATE TEMP TABLE correspondence_legacy_flow ON COMMIT DROP AS
SELECT l.id,
       l.direction,
       l.stage,
       (SELECT h.actor_user_id FROM correspondence_schema.history h
         WHERE h.letter_id = l.id AND h.action = CASE l.direction WHEN 'incoming' THEN 'dispatch' ELSE 'submit' END
         ORDER BY h.created_at DESC LIMIT 1) AS started_by,
       (SELECT max(a.submitted_at) FROM correspondence_schema.assignments a WHERE a.letter_id = l.id) AS processed_at,
       (SELECT h.created_at FROM correspondence_schema.history h
         WHERE h.letter_id = l.id AND h.action = 'submit' ORDER BY h.created_at DESC LIMIT 1) AS checked_at,
       EXISTS (SELECT 1 FROM correspondence_schema.assignments a WHERE a.letter_id = l.id AND a.status = 'pending') AS has_pending
  FROM correspondence_schema.letters l
 WHERE l.stage NOT IN ('received', 'drafting', 'checking')
   AND EXISTS (SELECT 1 FROM correspondence_schema.history h
                WHERE h.letter_id = l.id AND h.action = CASE l.direction WHEN 'incoming' THEN 'dispatch' ELSE 'submit' END)
   AND NOT EXISTS (SELECT 1 FROM correspondence_schema.letter_steps s WHERE s.letter_id = l.id AND s.kind IN ('process', 'check'));

-- Hai lần cập nhật để không đụng ràng buộc (letter_id, seq) duy nhất giữa chừng.
UPDATE correspondence_schema.letter_steps s SET seq = s.seq + 100
  FROM correspondence_legacy_flow f WHERE s.letter_id = f.id;
UPDATE correspondence_schema.letter_steps s SET seq = s.seq - 99
  FROM correspondence_legacy_flow f WHERE s.letter_id = f.id AND s.seq > 100;

INSERT INTO correspondence_schema.letter_steps
       (letter_id, seq, name, kind, approver, status, activated_at, acted_by, acted_at, decision)
SELECT f.id,
       1,
       CASE f.direction WHEN 'incoming' THEN 'Phòng ban xử lý' ELSE 'Văn thư kiểm tra' END,
       CASE f.direction WHEN 'incoming' THEN 'process' ELSE 'check' END,
       NULL,
       CASE
         WHEN f.direction = 'incoming' AND f.stage = 'processing' THEN 'active'
         WHEN f.direction = 'incoming' AND f.stage = 'cancelled' AND f.has_pending THEN 'skipped'
         ELSE 'done'
       END,
       CASE WHEN f.direction = 'incoming' AND f.stage = 'processing' THEN now() END,
       CASE WHEN f.direction = 'outgoing' THEN f.started_by END,
       CASE
         WHEN f.direction = 'outgoing' THEN f.checked_at
         WHEN f.stage = 'processing' THEN NULL
         ELSE f.processed_at
       END,
       CASE
         WHEN f.direction = 'incoming' AND (f.stage = 'processing' OR (f.stage = 'cancelled' AND f.has_pending)) THEN NULL
         ELSE 'approved'
       END
  FROM correspondence_legacy_flow f;

-- Công văn đi đang chờ văn thư kiểm tra: luồng cũ chép bước duyệt lúc văn thư trình, nay chép cả quy trình (bước
-- văn thư kiểm tra đầu tiên, đang chạy) theo quy trình của loại văn bản hay quy trình mặc định của luồng đi.
CREATE TEMP TABLE correspondence_checking ON COMMIT DROP AS
SELECT l.id,
       COALESCE(
         (SELECT w.id FROM correspondence_schema.catalog_items c
            JOIN correspondence_schema.workflows w ON w.id = c.outgoing_workflow_id AND w.is_active AND w.direction = 'outgoing'
           WHERE c.kind = 'letter_type' AND c.code = l.kind LIMIT 1),
         (SELECT w.id FROM correspondence_schema.workflows w WHERE w.direction = 'outgoing' AND w.is_default AND w.is_active LIMIT 1)
       ) AS workflow_id
  FROM correspondence_schema.letters l
 WHERE l.direction = 'outgoing'
   AND l.stage = 'checking'
   AND NOT EXISTS (SELECT 1 FROM correspondence_schema.letter_steps s WHERE s.letter_id = l.id AND s.kind IN ('process', 'check'));

DELETE FROM correspondence_schema.letter_steps s USING correspondence_checking c WHERE s.letter_id = c.id;

INSERT INTO correspondence_schema.letter_steps
       (letter_id, seq, name, kind, approver, reject_to, due_days, status, activated_at)
SELECT c.id,
       e.ord,
       left(e.s ->> 'name', 160),
       COALESCE(e.s ->> 'type', 'approve'),
       CASE WHEN COALESCE(e.s ->> 'type', 'approve') = 'approve' THEN e.s -> 'approver' END,
       NULLIF(e.s ->> 'rejectTo', ''),
       (e.s ->> 'dueDays')::integer,
       CASE WHEN e.ord = 1 THEN 'active' ELSE 'waiting' END,
       CASE WHEN e.ord = 1 THEN now() END
  FROM correspondence_checking c
  JOIN correspondence_schema.workflows w ON w.id = c.workflow_id
 CROSS JOIN LATERAL jsonb_array_elements(w.steps) WITH ORDINALITY AS e(s, ord);

UPDATE correspondence_schema.letters l
   SET workflow_id = w.id, workflow_name = w.name, updated_at = now()
  FROM correspondence_checking c
  JOIN correspondence_schema.workflows w ON w.id = c.workflow_id
 WHERE l.id = c.id;
