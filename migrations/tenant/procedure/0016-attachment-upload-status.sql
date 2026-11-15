-- Trạng thái tải lên của đính kèm (ISS-BE-016).
--
-- Trước đây dòng đính kèm ghi ngay lúc xin URL tải lên, nên tệp trình duyệt
-- chưa bao giờ PUT vẫn hiện trong hồ sơ và tính là bằng chứng của đầu việc.
-- Từ nay dòng mới tạo ở trạng thái PENDING; chỉ khi server thấy object trên
-- kho (lệnh HEAD) mới chuyển COMPLETED và ghi dung lượng thật.
--
-- Dòng cũ nhận mặc định COMPLETED: giữ nguyên cách hiển thị như trước. Bản app
-- cũ chèn dòng không nêu cột này nên cũng nhận COMPLETED, đúng hành vi cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE procedure_schema.attachments
    ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE procedure_schema.attachments
    DROP CONSTRAINT IF EXISTS attachments_upload_status_check;

ALTER TABLE procedure_schema.attachments
    ADD CONSTRAINT attachments_upload_status_check
    CHECK (upload_status IN ('PENDING', 'COMPLETED'));

COMMENT ON COLUMN procedure_schema.attachments.upload_status IS
    'PENDING: đã cấp URL tải lên, chưa thấy tệp trên kho; COMPLETED: tệp đã có thật.';
