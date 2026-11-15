-- Quy trình động, đợt 3 (định tuyến theo điều kiện):
-- - Quy trình có điều kiện áp dụng (loại văn bản, độ khẩn, độ mật), chọn trước quy trình theo loại văn bản / mặc định.
-- - Bước phòng ban xử lý có phòng ban cố định (giao sẵn khi người làm bước trước không chọn; khoá thì luôn giao đúng
--   các phòng đó). Điều kiện bật / tắt bước nằm trong cấu hình bước (JSON), áp lúc chép quy trình vào công văn.
-- - Thư riêng gửi đích danh: không bóc bì, chuyển thẳng người nhận, không vào quy trình xử lý.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.workflows
    ADD COLUMN IF NOT EXISTS conditions JSONB;

ALTER TABLE correspondence_schema.letter_steps
    ADD COLUMN IF NOT EXISTS units      JSONB,
    ADD COLUMN IF NOT EXISTS lock_units BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS personal BOOLEAN NOT NULL DEFAULT false;
