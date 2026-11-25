SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Nhật ký đổi chính sách duyệt chứng từ kho (cài đặt `documents.approval`: chế độ duyệt, cho phép tự duyệt).
-- Chính sách này nới kiểm soát nội bộ (ISS-BE-006) nên mỗi lần đổi phải có lý do và người đổi.
-- Chỉ thêm bảng mới; bản app cũ không đọc bảng này.
CREATE TABLE IF NOT EXISTS inventory_schema.approval_policy_log (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(120) NOT NULL,
    previous    JSONB        NOT NULL,
    current     JSONB        NOT NULL,
    reason      TEXT         NOT NULL,
    changed_by  UUID,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_approval_policy_log_changed_at
    ON inventory_schema.approval_policy_log (changed_at DESC);
