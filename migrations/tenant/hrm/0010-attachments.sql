CREATE TABLE IF NOT EXISTS hrm_schema.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  file_name varchar(255) NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type varchar(100) NOT NULL,
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
  status varchar(20) NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','READY')),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_attachments_employee ON hrm_schema.attachments(tenant_id,employee_id);
