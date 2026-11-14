-- Huỷ công văn đã ban hành (đi) hay đã hoàn tất (đến): văn thư đề nghị thu hồi hoặc sửa đổi, thay thế kèm lý do,
-- công văn sang giai đoạn 'revoking' chờ người có thẩm quyền ở bước duyệt cuối của quy trình xác nhận; đồng ý thì
-- công văn thành 'cancelled', không đồng ý hay văn thư rút đề nghị thì về lại 'archived'. Công văn đã huỷ xoá được
-- khỏi Văn thư: xoá mềm (deleted_at), số sổ, lịch sử và tệp bên Hệ dùng chung giữ nguyên.
--
-- Dữ liệu cũ không đổi. Bản ứng dụng trước bỏ qua các cột mới; công văn đã xoá mềm sẽ hiện lại nếu phải lùi image.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.letters DROP CONSTRAINT IF EXISTS chk_correspondence_letters_stage;
ALTER TABLE correspondence_schema.letters
    ADD CONSTRAINT chk_correspondence_letters_stage
    CHECK (stage IN ('received', 'registered', 'directing', 'processing', 'reviewing', 'closing',
                     'drafting', 'checking', 'publishing', 'archived', 'revoking', 'cancelled'));

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS revoke_kind          VARCHAR(10),
    ADD COLUMN IF NOT EXISTS revoke_reason        TEXT,
    ADD COLUMN IF NOT EXISTS revoke_requested_by  UUID,
    ADD COLUMN IF NOT EXISTS revoke_requested_at  TIMESTAMPTZ,
    -- Người xác nhận huỷ, giải theo bước duyệt cuối lúc đề nghị.
    ADD COLUMN IF NOT EXISTS revoke_approver_ids  UUID[]       NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by           UUID;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_revoke_kind') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_revoke_kind
            CHECK (revoke_kind IS NULL OR revoke_kind IN ('recall', 'amend'));
    END IF;
END
$$;

-- Danh sách và đếm chỉ đọc công văn chưa xoá.
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_live
    ON correspondence_schema.letters (direction, stage) WHERE deleted_at IS NULL;
