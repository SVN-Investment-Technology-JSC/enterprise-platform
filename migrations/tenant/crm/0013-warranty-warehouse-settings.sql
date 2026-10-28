-- Bán hàng (crm) · bỏ kho bảo hành mặc định 0010 đã ghi sẵn (QA-KHO-CL, QA-KHO-LOI
-- là mã kho thử nghiệm, tenant thật không có). Từ nay kho cách ly và kho hàng lỗi
-- phải do người quản trị chọn ở Cấu hình > Bảo hành; chưa chọn thì nhận hàng bảo
-- hành, chuyển kho bị chặn với thông báo hướng dẫn.
-- Chỉ xoá dòng còn đúng giá trị mặc định và chưa ai sửa (`updated_by` rỗng,
-- `version` = 1); tenant đã cấu hình giữ nguyên. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DELETE FROM crm_schema.settings
 WHERE updated_by IS NULL
   AND version = 1
   AND ((key = 'warranty.quarantineWarehouseCode' AND value = '{"code": "QA-KHO-CL"}'::jsonb)
     OR (key = 'warranty.defectWarehouseCode' AND value = '{"code": "QA-KHO-LOI"}'::jsonb));
