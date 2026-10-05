-- FIX-E-02: ghi tiến độ duyệt của Procedure Engine vào đơn HRM (qua sự kiện step_changed).
-- Không đổi trạng thái nghiệp vụ; chỉ thêm cột hiển thị và hộp thư sự kiện idempotent.

-- Tiến độ trên liên kết: nguồn đối chiếu thứ tự sự kiện (bỏ qua sự kiện cũ hơn).
ALTER TABLE hrm_schema.procedure_links ADD COLUMN IF NOT EXISTS current_step_name text;
ALTER TABLE hrm_schema.procedure_links ADD COLUMN IF NOT EXISTS current_assignee_name text;
ALTER TABLE hrm_schema.procedure_links ADD COLUMN IF NOT EXISTS current_step_seq integer NOT NULL DEFAULT 0;
ALTER TABLE hrm_schema.procedure_links ADD COLUMN IF NOT EXISTS current_step_updated_at timestamptz;
-- Mốc đối soát tiến độ gần nhất với Procedure (xoay vòng khi mất sự kiện).
ALTER TABLE hrm_schema.procedure_links ADD COLUMN IF NOT EXISTS step_reconciled_at timestamptz;

-- Cột hiển thị trên đủ 7 bảng đơn. Migration 0002 chỉ thêm cho 6 bảng (thiếu profile_corrections)
-- và chưa có cột tên người xử lý (current_assignee_id chỉ chứa mã, Procedure chỉ trả nhãn).
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['leave_requests','ot_requests','business_trip_requests','shift_change_requests',
    'attendance_corrections','salary_advance_requests','profile_corrections'] LOOP
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS procedure_instance_id uuid', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS current_step_name varchar(100)', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS current_assignee_id varchar(100)', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS current_assignee_name text', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS workflow_status varchar(50)', tab);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON hrm_schema.%I(tenant_id, current_step_name) WHERE current_step_name IS NOT NULL',
      tab || '_current_step_idx', tab);
  END LOOP;
END $$;

-- Hộp thư sự kiện procedure.instance.step_changed: khóa (instance, sequence) nên nhận lại cùng sự kiện là no-op.
CREATE TABLE IF NOT EXISTS hrm_schema.procedure_step_inbox (
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence > 0),
  event_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  event jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','SKIPPED','FAILED')),
  link_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  PRIMARY KEY(tenant_id, instance_id, sequence)
);
CREATE INDEX IF NOT EXISTS hrm_procedure_step_inbox_pending_idx ON hrm_schema.procedure_step_inbox(tenant_id, status, received_at);
