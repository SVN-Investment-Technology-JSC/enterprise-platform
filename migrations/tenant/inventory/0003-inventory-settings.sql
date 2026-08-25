SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Cấu hình module Kho do tenant admin đặt. Mỗi khoá một dòng, giá trị là JSONB
-- vì mỗi khoá có hình dạng riêng: hôm nay là danh sách id thẻ dashboard theo thứ
-- tự, sau này là danh mục thuộc tính/trạng thái/giá/bảo hành được bật.
--
-- Cố ý dùng một bảng khoá–giá trị thay vì mỗi tính năng một bảng: mọi danh mục
-- cấu hình về sau chỉ là một khoá mới, không phát sinh DDL và không phải sửa
-- danh sách migration trong apps/migrator nữa.
--
-- Rủi ro thường thấy của kiểu lưu này được chặn hai lớp ở tầng trên: khoá là
-- union đóng trong contracts-inventory, và mỗi khoá có giá trị mặc định có kiểu
-- nên một dòng dữ liệu hỏng sẽ rơi về mặc định thay vì làm chết màn hình.
--
-- Không seed dòng nào: thiếu dòng nghĩa là "dùng mặc định trong code", nhờ vậy
-- đổi mặc định ở bản sau không cần migration dữ liệu.
CREATE TABLE IF NOT EXISTS inventory_schema.module_settings (
    key         VARCHAR(120) PRIMARY KEY,
    value       JSONB        NOT NULL,
    -- Tăng sau mỗi lần ghi. Client gửi lại version đã đọc, nên hai admin sửa
    -- cùng một mục không ghi đè im lặng lên nhau.
    version     INTEGER      NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by  UUID
);
