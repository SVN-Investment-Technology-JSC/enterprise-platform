-- Preserve the original sender and dynamic form while waiting for peer consent.
ALTER TABLE hrm_schema.shift_change_requests
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_attributes jsonb NOT NULL DEFAULT '{}';
UPDATE hrm_schema.shift_change_requests r SET submitted_by=e.user_id
FROM core_schema.employees e WHERE e.tenant_id=r.tenant_id AND e.id=r.employee_id AND r.submitted_by IS NULL;
