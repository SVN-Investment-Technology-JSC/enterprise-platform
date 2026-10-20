-- Gom lịch lễ về một nguồn là "Lịch lễ/Tết" của Phân ca (hrm_schema.company_holidays).
-- Ngày lễ nằm thẳng trong work_calendar (bản nháp lễ cả năm, nhập tay, seed) mà chưa thuộc đợt lễ nào
-- được chuyển thành một đợt lễ toàn công ty, nghỉ, một ngày/đợt, để màn Phân ca nhìn thấy và huỷ được.
-- Chỉ thêm dòng company_holidays; không đổi work_calendar nên công thức tính công giữ nguyên. Chạy lại không tạo trùng.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO hrm_schema.company_holidays
  (tenant_id, name, kind, from_date, to_date, scope_type, scope, treatment, paid, note, calendar_ids, created_by)
SELECT c.tenant_id, c.name, 'HOLIDAY', c.work_date, c.work_date, 'COMPANY', '{"type":"COMPANY"}'::jsonb, 'OFF', c.paid,
       'Chuyển từ lịch công ty (khai báo cũ)', ARRAY[c.id], c.created_by
  FROM hrm_schema.work_calendar c
 WHERE c.day_kind = 'HOLIDAY'
   AND NOT EXISTS (
     SELECT 1 FROM hrm_schema.company_holidays h
      WHERE h.tenant_id = c.tenant_id AND h.status = 'ACTIVE' AND c.id = ANY (h.calendar_ids)
   );
