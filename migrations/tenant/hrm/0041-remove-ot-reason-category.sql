-- Bỏ danh mục "Lý do làm thêm (OT)": đơn OT chỉ còn ô lý do tự do. Đơn đã gửi giữ nguyên nội dung lý do.
UPDATE hrm_schema.request_reasons
   SET deleted_at = now(), active = false, updated_at = now()
 WHERE kind = 'OVERTIME' AND deleted_at IS NULL;
UPDATE hrm_schema.request_reason_categories
   SET deleted_at = now(), active = false, updated_at = now()
 WHERE upper(code) = 'OVERTIME' AND deleted_at IS NULL;
