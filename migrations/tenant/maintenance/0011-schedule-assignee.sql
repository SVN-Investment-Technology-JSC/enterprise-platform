SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Người phụ trách của lịch bảo trì. Phiếu định kỳ do scheduler sinh ra sao chép người này, để phiếu có người nhận
-- (thẻ "Việc của tôi", thông báo được giao việc). Trước đây chỉ sự cố mới có người nhận.
-- Chép tên kèm id (giống phiếu sự cố) để hiển thị mà không phải tra lại danh bạ. Cột cho phép NULL nên bản app cũ
-- vẫn chạy được với schema này.
ALTER TABLE maintenance_schema.schedules
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS assignee_name varchar(180);
