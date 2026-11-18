-- Cách tính tiến độ dự án (bám 1Office: chọn lúc tạo dự án, tiến độ tự tính, không nhập tay).
--  · projects.progress_method: 'avg_tasks' (bình quân % các công việc gốc), 'weighted_days' (theo số ngày thực hiện dự
--    kiến), 'weighted_weight' (theo tỷ trọng công việc), 'weighted_hours' (công thức cũ: trọng số là giờ ước lượng của
--    các việc lá). MẶC ĐỊNH 'weighted_hours' nên mọi dự án đã có (và dự án do bản app cũ tạo, không biết cột này) giữ
--    nguyên số liệu; dự án mới do bản app mới tạo luôn ghi cách tính rõ ràng.
--  · work_items.weight: tỷ trọng của công việc, chỉ có tác dụng với công việc gốc của dự án tính theo
--    'weighted_weight'. NULL = chưa đặt (khi tính, bằng trung bình các việc gốc đã đặt; không việc nào đặt thì chia đều).
--  · Cột projects.manual_progress_percent GIỮ NGUYÊN dữ liệu nhưng không còn được đọc hay ghi: tiến độ dự án không nhập
--    tay nữa.
--  · Bản app cũ bỏ qua hai cột mới (lùi image không cần lùi schema).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.projects
    ADD COLUMN IF NOT EXISTS progress_method VARCHAR(20) NOT NULL DEFAULT 'weighted_hours';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_projects_progress_method'
    ) THEN
        ALTER TABLE workspace_schema.projects
            ADD CONSTRAINT chk_projects_progress_method
            CHECK (progress_method IN ('avg_tasks', 'weighted_days', 'weighted_weight', 'weighted_hours'));
    END IF;
END $$;

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS weight NUMERIC(8, 2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_items_weight'
    ) THEN
        ALTER TABLE workspace_schema.work_items
            ADD CONSTRAINT chk_work_items_weight CHECK (weight IS NULL OR weight >= 0);
    END IF;
END $$;
