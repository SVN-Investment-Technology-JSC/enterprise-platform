SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- SỔ GHI CHI PHÍ
--
-- Trước đây `work_items.actual_cost` là cột sửa thẳng: chỉ biết `updated_at`,
-- không biết ai đổi số tiền từ bao nhiêu thành bao nhiêu. Bảng này ghi mỗi
-- lượt phát sinh chi phí thành một dòng, CHỈ GHI THÊM — không sửa, không xoá.
-- Nhập sai thì ghi thêm một dòng điều chỉnh (số âm) kèm lý do.
--
-- `work_items.actual_cost` được GIỮ LẠI làm số tổng, cập nhật trong cùng
-- transaction với dòng sổ. Nhờ vậy báo cáo và index phủ ở `0006` không phải
-- đổi, và `CHECK (actual_cost >= 0)` có sẵn chặn luôn trường hợp điều chỉnh
-- làm tổng bị âm. Nguồn sự thật là sổ; cột tổng tính lại được từ sổ bất cứ lúc
-- nào bằng SUM.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.cost_entries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id  UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    -- Lưu dư để đọc lịch sử theo dự án mà không phải join qua công việc.
    project_id    UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- Được âm để ghi điều chỉnh; bằng 0 thì không có gì để ghi.
    amount        NUMERIC(18,2) NOT NULL,
    -- Bắt buộc: một con số không kèm lý do thì sổ ghi mất ý nghĩa.
    note          VARCHAR(500) NOT NULL,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_cost_entries_amount_nonzero CHECK (amount <> 0),
    CONSTRAINT chk_cost_entries_note_present CHECK (char_length(btrim(note)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_work_item
    ON workspace_schema.cost_entries (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_entries_project
    ON workspace_schema.cost_entries (project_id, created_at DESC);

-- ===========================================================================
-- CHUYỂN SỐ LIỆU CŨ
--
-- Mỗi công việc đang có chi phí thực tế sinh đúng một dòng "số dư", để tổng
-- của sổ khớp ngay với cột `actual_cost` từ lúc bắt đầu. Người ghi là người
-- tạo công việc — không biết ai đã nhập số cũ, và đó chính là lý do có bảng
-- này. `NOT EXISTS` giữ cho migration chạy lại không sinh dòng trùng.
-- ===========================================================================
INSERT INTO workspace_schema.cost_entries (work_item_id, project_id, amount, note, created_by, created_at)
SELECT w.id, w.project_id, w.actual_cost,
       'Số dư chuyển sang sổ ghi — số nhập trước ngày có sổ, không rõ người nhập',
       w.created_by, w.updated_at
  FROM workspace_schema.work_items w
 WHERE w.actual_cost > 0
   AND NOT EXISTS (
         SELECT 1 FROM workspace_schema.cost_entries e WHERE e.work_item_id = w.id
       );
