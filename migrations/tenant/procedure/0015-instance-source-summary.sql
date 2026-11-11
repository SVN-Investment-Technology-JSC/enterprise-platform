SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- THÔNG TIN NGUỒN CỦA HỒ SƠ (CRM phase 3, D3-31)
--
-- Module mở hồ sơ (ví dụ Bán hàng với báo giá, PAKD) gửi kèm tóm tắt chứng từ
-- gốc: tiêu đề, các dòng nhãn - giá trị, đường dẫn nội bộ về chứng từ. Chỉ là
-- thông tin hiển thị cho người duyệt, không ảnh hưởng luồng hồ sơ. Hồ sơ cũ và
-- hồ sơ không có nguồn để rỗng. Cột là bản chiếu; giá trị thật đi theo snapshot.
-- ===========================================================================
ALTER TABLE procedure_schema.instances
    ADD COLUMN IF NOT EXISTS source_summary jsonb;

COMMENT ON COLUMN procedure_schema.instances.source_summary IS
    'Thông tin nguồn cho người duyệt: { title?, items: [{ label, value }], url?, urlLabel? }; rỗng khi nguồn không gửi.';
