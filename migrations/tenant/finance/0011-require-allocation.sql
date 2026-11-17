-- Cài đặt "Bắt buộc hạch toán dự án": bật thì phiếu thu/chi phải chọn dự án (hoặc công việc) mới gửi duyệt / ghi sổ được.
-- Mặc định TẮT để không đổi hành vi của tenant đang dùng; kế toán trưởng bật ở Cài đặt > Khoá sổ và duyệt khi muốn mọi khoản
-- thu chi đều có chỗ ở dự án (như sổ chứng từ theo dự án). Bản app cũ bỏ qua cột mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE finance_schema.settings
    ADD COLUMN IF NOT EXISTS require_allocation BOOLEAN NOT NULL DEFAULT FALSE;
