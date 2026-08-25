-- Vật tư mà một đầu việc E(x) cần.
--
-- Trước đây vật tư chỉ chọn được LÚC THIẾT KẾ và gắn vào cả bước
-- (`steps.materials`). Người giữ vai E khi phân rã công việc thực tế mới biết
-- từng đầu việc cần gì, nên danh sách phải xuống được tới mức đầu việc.
--
-- Cột jsonb thay vì bảng con: đây là bản chụp thuộc về một đầu việc, không bao
-- giờ được truy vấn chéo hồ sơ, và `subtasks` vốn đã là bảng chiếu được ghi lại
-- toàn bộ ở mỗi transaction — một bảng con sẽ phải xoá-ghi theo y hệt mà không
-- mua thêm được gì.
--
-- Nguồn sự thật vẫn là `instances.snapshot`; cột này là bản chiếu để truy vấn
-- báo cáo, cùng khuôn với mọi cột khác của bảng này.
--
-- Mỗi phần tử: { materialCode, quantity, note?, materialName?, unit? }.
-- `materialName` và `unit` chụp lúc lưu, cùng luật với `steps.materials`: hồ sơ
-- đang chạy không đổi nội dung khi Kho sửa danh mục. Còn tồn thì luôn đọc mới.
ALTER TABLE procedure_schema.subtasks
  ADD COLUMN IF NOT EXISTS materials jsonb NOT NULL DEFAULT '[]'::jsonb;
