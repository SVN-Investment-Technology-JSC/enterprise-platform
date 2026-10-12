-- Mục danh mục có ký hiệu (code) để form tham chiếu giá trị ổn định (VD: WEEKDAY, DOMESTIC).
-- fixed_items: loại danh mục mà hệ thống tính toán theo mã (VD: loại OT theo hệ số) nên chỉ
-- được bật/tắt, đổi tên hiển thị; không thêm hoặc xoá mục.
ALTER TABLE hrm_schema.request_reasons ADD COLUMN IF NOT EXISTS code varchar(50);
ALTER TABLE hrm_schema.request_reason_categories ADD COLUMN IF NOT EXISTS fixed_items boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_request_reasons_code
  ON hrm_schema.request_reasons (tenant_id, kind, upper(code)) WHERE deleted_at IS NULL AND code IS NOT NULL;
