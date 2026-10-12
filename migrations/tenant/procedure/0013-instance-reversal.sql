SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- HUỶ HIỆU LỰC HỒ SƠ ĐÃ HOÀN THÀNH
--
-- Admin huỷ hiệu lực một hồ sơ `completed`: hồ sơ chuyển `reversed`, lịch sử
-- duyệt giữ nguyên (chi tiết người huỷ, lý do nằm trong snapshot). Module liên
-- kết (Workspace, HRM) nhận sự kiện `procedure.instance.reversed` và tự hoàn tác.
-- ===========================================================================
ALTER TABLE procedure_schema.instances
    DROP CONSTRAINT IF EXISTS instances_status_check;
ALTER TABLE procedure_schema.instances
    ADD CONSTRAINT instances_status_check
        CHECK (status IN ('running', 'completed', 'rejected', 'cancelled', 'reversed'));
