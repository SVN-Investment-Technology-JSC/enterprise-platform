-- Quy trình chọn riêng cho một công văn lúc tạo (hay lúc văn thư phân loại, người soạn gửi đi): công văn chạy
-- đúng quy trình đó thay vì quy trình tự chọn theo điều kiện, loại văn bản, mặc định. Trống là tự chọn như cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS chosen_workflow_id UUID;
