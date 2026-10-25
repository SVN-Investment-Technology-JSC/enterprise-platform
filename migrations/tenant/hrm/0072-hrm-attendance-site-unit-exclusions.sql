-- Ngoại lệ khi gán địa điểm chấm công theo cây phòng ban: gán một đơn vị thì mọi đơn vị con kế thừa, và một đơn vị con có thể
-- được loại trừ (UNIT_EXCLUDE). Đơn vị có hiệu lực theo dấu gần nhất khi đi từ chính nó lên các đơn vị cha.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.attendance_site_assignments
  DROP CONSTRAINT IF EXISTS attendance_site_scope_check;

ALTER TABLE hrm_schema.attendance_site_assignments
  ADD CONSTRAINT attendance_site_scope_check
  CHECK (scope_type IN ('COMPANY', 'UNIT', 'UNIT_EXCLUDE', 'POSITION', 'EMPLOYEE'));
