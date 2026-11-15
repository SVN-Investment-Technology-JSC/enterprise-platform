SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Lịch sử đổi cấu hình Tài chính (ISS-BE-034): trước đây đổi tự duyệt, ngày khoá sổ, số dư đầu kỳ hay "cho phép âm"
-- của tài khoản không để lại dấu vết nào.
--
-- Mỗi trường thay đổi là một dòng, ghi cùng giao dịch với thay đổi dữ liệu:
-- - entity_type: 'SETTINGS' (cấu hình chung, entity_id NULL) hoặc 'ACCOUNT' (tài khoản, entity_id = id tài khoản);
-- - field: tên trường theo API (allowSelfApproval, booksLockedUntil, openingBalance, allowNegative...);
-- - old_value / new_value: giá trị dạng chữ (NULL = trống);
-- - reason: lý do người sửa nhập (bắt buộc khi sửa số dư đầu kỳ của tài khoản đã có bút toán).
-- Bảng mới, chỉ thêm; dữ liệu cũ không có lịch sử (người phụ trách ghi một dòng mốc sau khi deploy).
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance_schema.config_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('SETTINGS', 'ACCOUNT')),
    entity_id UUID,
    field VARCHAR(60) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    actor_id UUID,
    actor_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_config_audit_entity
    ON finance_schema.config_audit (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_config_audit_tenant_time
    ON finance_schema.config_audit (tenant_id, created_at DESC);
