-- Chi tiết đơn từ gắn dự án.
--  · project_requests.details: danh sách {label, value} do module nguồn (HRM) dịch sẵn và gửi kèm
--    `hrm.project_request.submitted` — ví dụ đơn công tác: hình thức, địa điểm, thời gian, số ngày, lý do, phương tiện,
--    phụ phí. Workspace chỉ lưu và hiển thị, không đọc bảng của module nguồn và không cần biết đơn có trường nào.
--  · NULL với đơn cũ (đã gửi trước khi có cột này) và với đơn tự gắn theo thời gian công tác.
--  · Bản app cũ không biết cột này: vẫn đọc/ghi đơn bình thường, chỉ không có chi tiết (lùi image không cần lùi schema).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.project_requests
    ADD COLUMN IF NOT EXISTS details JSONB;
