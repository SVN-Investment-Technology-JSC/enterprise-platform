-- Lý do thu/chi bắt buộc chọn dự án (như lý do "Chi theo dự án" / "Thu theo dự án"): phiếu dùng lý do này phải hạch toán
-- nội bộ cho một dự án mới gửi duyệt / ghi sổ được. Kết hợp với cài đặt chung "Bắt buộc hạch toán dự án" (0011): phiếu bắt buộc
-- chọn dự án khi cài đặt chung bật HOẶC lý do của phiếu bắt buộc. Mặc định tắt nên không đổi hành vi hiện tại; bản app cũ bỏ qua cột.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE finance_schema.reasons
    ADD COLUMN IF NOT EXISTS require_project BOOLEAN NOT NULL DEFAULT FALSE;
