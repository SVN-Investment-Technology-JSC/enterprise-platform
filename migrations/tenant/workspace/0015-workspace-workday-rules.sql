SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- THỨ TỰ ƯU TIÊN TÍNH CÔNG (chia thưởng theo dự án)
--
-- Ngày có nhiều đơn trùng nhau chỉ tính theo đơn có ưu tiên cao nhất (rank
-- nhỏ nhất). Dùng chung toàn tenant; quản trị kéo thả để đổi thứ tự và sửa số
-- công mỗi ngày. Dòng `normal` là ngày không có đơn nào: không có rank.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.workday_rules (
    kind        VARCHAR(40) PRIMARY KEY,
    label       VARCHAR(120) NOT NULL,
    rank        INTEGER,
    units       NUMERIC(5,2) NOT NULL,
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_workday_rules_units CHECK (units >= 0 AND units <= 10),
    CONSTRAINT chk_workday_rules_rank CHECK ((kind = 'normal') = (rank IS NULL))
);

INSERT INTO workspace_schema.workday_rules (kind, label, rank, units) VALUES
    ('leave', 'Nghỉ phép', 1, 0),
    ('business_trip', 'Công tác', 2, 1.5),
    ('normal', 'Ngày thường (không có đơn)', NULL, 1)
ON CONFLICT (kind) DO NOTHING;
