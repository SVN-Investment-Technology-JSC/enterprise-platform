-- Bán hàng (crm) · luồng mẫu "Chào thầu" (GĐ E, P2E-03, quyết định P2-D13): luồng profile TENDER với sáu giai đoạn
-- (Thu thập HSMT, Chuẩn bị hồ sơ, Chờ duyệt phương án, Đã nộp, Trúng, Trượt), bước chuyển tuần tự (Chờ duyệt phương án
-- có thể trả về Chuẩn bị hồ sơ), Trượt từ mọi giai đoạn mở, và điều kiện chuyển mặc định (đều bắt buộc):
--   Chờ duyệt phương án: hồ sơ pháp lý (LEGAL_DOSSIER) và dự toán (ESTIMATE);
--   Đã nộp: phương án chào thầu đã duyệt (TENDER_PLAN_APPROVED) và hình thức nộp (TENDER_FIELD submissionMethod);
--   Trúng: giá trúng (TENDER_FIELD winningPrice); Trượt: lý do (REASON).
-- Luồng KHÔNG đặt làm mặc định (is_default = false). Chạy lại được: ON CONFLICT DO NOTHING; luồng đã có (người dùng
-- đã sửa cấu hình) thì không bị ghi đè.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO crm_schema.pipelines (code, name, profile, is_default, sort_order)
VALUES ('TENDER_STANDARD', 'Chào thầu', 'TENDER', false, 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO crm_schema.pipeline_stages (pipeline_id, code, name, semantic, sort_order, default_probability, assignee_rule)
SELECT p.id, s.code, s.name, s.semantic, s.sort_order, s.probability, s.assignee_rule
  FROM crm_schema.pipelines p
 CROSS JOIN (VALUES
     ('HSMT',        'Thu thập HSMT',          'OPEN', 10,   5, 'PROJECT_OWNER'),
     ('PREPARE',     'Chuẩn bị hồ sơ',         'OPEN', 20,  20, 'PROJECT_OWNER'),
     ('PLAN_REVIEW', 'Chờ duyệt phương án',    'OPEN', 30,  40, 'PROJECT_OWNER'),
     ('SUBMITTED',   'Đã nộp',                 'OPEN', 40,  60, 'PROJECT_OWNER'),
     ('WON',         'Trúng',                  'WON',  50, 100, 'NONE'),
     ('LOST',        'Trượt',                  'LOST', 60,   0, 'NONE')
 ) AS s (code, name, semantic, sort_order, probability, assignee_rule)
 WHERE p.code = 'TENDER_STANDARD'
ON CONFLICT (pipeline_id, code) DO NOTHING;

INSERT INTO crm_schema.pipeline_stage_transitions (from_stage_id, to_stage_id)
SELECT f.id, t.id
  FROM crm_schema.pipelines p
  JOIN crm_schema.pipeline_stages f ON f.pipeline_id = p.id
  JOIN crm_schema.pipeline_stages t ON t.pipeline_id = p.id
  JOIN (VALUES
     ('HSMT', 'PREPARE'), ('HSMT', 'LOST'),
     ('PREPARE', 'HSMT'), ('PREPARE', 'PLAN_REVIEW'), ('PREPARE', 'LOST'),
     ('PLAN_REVIEW', 'PREPARE'), ('PLAN_REVIEW', 'SUBMITTED'), ('PLAN_REVIEW', 'LOST'),
     ('SUBMITTED', 'WON'), ('SUBMITTED', 'LOST')
  ) AS m (from_code, to_code) ON m.from_code = f.code AND m.to_code = t.code
 WHERE p.code = 'TENDER_STANDARD'
ON CONFLICT DO NOTHING;

INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order)
SELECT s.id, r.kind, r.ref, true, r.message, r.sort_order
  FROM crm_schema.pipelines p
  JOIN crm_schema.pipeline_stages s ON s.pipeline_id = p.id
  JOIN (VALUES
     ('PLAN_REVIEW', 'DOCUMENT_TYPE',        'LEGAL_DOSSIER',    'Cần có hồ sơ pháp lý trước khi chuyển sang Chờ duyệt phương án.', 10),
     ('PLAN_REVIEW', 'DOCUMENT_TYPE',        'ESTIMATE',         'Cần có dự toán trước khi chuyển sang Chờ duyệt phương án.', 20),
     ('SUBMITTED',   'TENDER_PLAN_APPROVED', '',                 'Phương án chào thầu cần được duyệt trước khi chuyển sang Đã nộp.', 10),
     ('SUBMITTED',   'TENDER_FIELD',         'submissionMethod', 'Cần chọn hình thức nộp thầu trước khi chuyển sang Đã nộp.', 20),
     ('WON',         'TENDER_FIELD',         'winningPrice',     'Cần ghi giá trúng thầu khi chuyển sang Trúng.', 10),
     ('LOST',        'REASON',               '',                 'Phải ghi lý do trượt thầu.', 10)
  ) AS r (stage_code, kind, ref, message, sort_order) ON r.stage_code = s.code
 WHERE p.code = 'TENDER_STANDARD'
ON CONFLICT (stage_id, kind, ref) DO NOTHING;
