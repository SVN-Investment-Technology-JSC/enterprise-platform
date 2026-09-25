SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- INDEX CHO TỔNG HỢP TÀI CHÍNH
--
-- Bốn cột tài chính trên `projects` và hai cột chi phí trên `work_items` đã
-- có sẵn từ `0001`. Ở đây chỉ thêm một index phủ (covering index) để truy
-- vấn tổng chi phí theo dự án chạy bằng index-only scan:
--
--   SELECT SUM(actual_cost), SUM(estimated_cost) FILTER (WHERE status ...)
--     FROM work_items WHERE project_id = $1
--
-- `idx_work_items_project_status` có sẵn đã lọc được theo dự án, nhưng mỗi
-- dòng khớp vẫn phải quay lại bảng để đọc hai cột tiền. `INCLUDE` đặt hai cột
-- đó ngay trong lá của index, nên không còn bước quay lại bảng.
--
-- Giá trị dẫn xuất (dự kiến, lợi nhuận, biên) KHÔNG được lưu: lưu số tổng là
-- tạo nguồn sự thật thứ hai, phải đồng bộ bằng trigger mỗi khi một công việc
-- đổi chi phí. Tính bằng SUM trên index này là đủ nhanh ở quy mô hiện tại.
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_work_items_project_costs
    ON workspace_schema.work_items (project_id, status)
    INCLUDE (actual_cost, estimated_cost);
