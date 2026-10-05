SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Tài liệu hồ sơ: ảnh thẻ và CCCD dùng kho đính kèm sẵn có. Tệp "hiện hành" được
-- tham chiếu từ hồ sơ; bản cũ vẫn nằm trong attachments để truy vết.
ALTER TABLE hrm_schema.attachments
  ADD COLUMN IF NOT EXISTS document_type varchar(30),
  ADD COLUMN IF NOT EXISTS is_confidential boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hrm_schema.attachments'::regclass AND conname='hrm_attachments_document_type_check') THEN
    ALTER TABLE hrm_schema.attachments ADD CONSTRAINT hrm_attachments_document_type_check
      CHECK (document_type IS NULL OR document_type IN ('PHOTO','ID_CARD_FRONT','ID_CARD_BACK','QUALIFICATION'));
  END IF;
END $$;

ALTER TABLE hrm_schema.employee_profiles
  ADD COLUMN IF NOT EXISTS identity_card_expiry_date date,
  ADD COLUMN IF NOT EXISTS photo_attachment_id uuid REFERENCES hrm_schema.attachments(id),
  ADD COLUMN IF NOT EXISTS identity_card_front_attachment_id uuid REFERENCES hrm_schema.attachments(id),
  ADD COLUMN IF NOT EXISTS identity_card_back_attachment_id uuid REFERENCES hrm_schema.attachments(id);

-- Bằng cấp, chứng chỉ, hộ chiếu, giấy phép lao động: không bắt buộc, nhiều bản ghi mỗi nhân sự.
CREATE TABLE IF NOT EXISTS hrm_schema.employee_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  qualification_type varchar(30) NOT NULL
    CHECK (qualification_type IN ('DEGREE','CERTIFICATE','LANGUAGE','PROFESSIONAL','PASSPORT','WORK_PERMIT','LICENSE','OTHER')),
  name varchar(255) NOT NULL,
  level varchar(100),
  major varchar(255),
  institution varchar(255),
  certificate_number varchar(100),
  issued_date date,
  effective_from date,
  expiry_date date,
  grade varchar(100),
  note text,
  attachment_id uuid REFERENCES hrm_schema.attachments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  CHECK (expiry_date IS NULL OR effective_from IS NULL OR expiry_date >= effective_from),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES core_schema.employees(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS hrm_qualifications_employee_idx
  ON hrm_schema.employee_qualifications(tenant_id, employee_id) WHERE deleted_at IS NULL;

-- Đơn điều chỉnh hồ sơ mang thêm thay đổi về ảnh, giấy tờ, bằng cấp.
ALTER TABLE hrm_schema.profile_corrections
  ADD COLUMN IF NOT EXISTS document_changes jsonb NOT NULL DEFAULT '[]'::jsonb;

-- employee_directory được tạo bằng ep.*; PostgreSQL cố định danh sách cột lúc tạo view.
DO $$
DECLARE projection text; prior_definition text;
BEGIN
  SELECT string_agg(format('ep.%I', name), ', ' ORDER BY ordinal)
    INTO projection
    FROM unnest(ARRAY['identity_card_expiry_date']) WITH ORDINALITY AS fields(name,ordinal)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema'
      AND table_name='employee_directory' AND column_name=fields.name);
  IF projection IS NOT NULL THEN
    prior_definition := regexp_replace(pg_get_viewdef('hrm_schema.employee_directory'::regclass,true), ';\s*$', '');
    EXECUTE format('CREATE OR REPLACE VIEW hrm_schema.employee_directory AS SELECT existing.*, %s FROM (%s) existing
      JOIN hrm_schema.employee_profiles ep ON ep.tenant_id=existing.tenant_id AND ep.employee_id=existing.employee_id', projection, prior_definition);
  END IF;
END $$;
