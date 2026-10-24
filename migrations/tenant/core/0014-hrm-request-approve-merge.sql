-- Gộp 8 cặp quyền duyệt đơn theo loại (hrm.leave|ot|trip|shift|attendance|profile|advance|custom.approve[.all])
-- thành hai quyền dùng chung: hrm.request.approve (trong phạm vi) và hrm.request.approve.all (toàn tenant).
-- Gói quyền (permission_actions) và quyền gán trực tiếp (user_permission_grants) giữ nguyên người được hưởng:
-- quyền thường đổi thành quyền thường, quyền .all đổi thành .all, rồi bỏ khoá cũ. Chạy lại không đổi thêm gì.
-- hrm.salary.advance.approve* (duyệt ứng lương ở phía bảng lương) và hrm.appointment.approve không thuộc đợt gộp này.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE hrm_approve_key_map (old_key text PRIMARY KEY, new_key text NOT NULL) ON COMMIT DROP;
INSERT INTO hrm_approve_key_map (old_key, new_key) VALUES
  ('hrm.leave.approve', 'hrm.request.approve'),
  ('hrm.ot.approve', 'hrm.request.approve'),
  ('hrm.trip.approve', 'hrm.request.approve'),
  ('hrm.shift.approve', 'hrm.request.approve'),
  ('hrm.attendance.approve', 'hrm.request.approve'),
  ('hrm.profile.approve', 'hrm.request.approve'),
  ('hrm.advance.approve', 'hrm.request.approve'),
  ('hrm.custom.approve', 'hrm.request.approve'),
  ('hrm.leave.approve.all', 'hrm.request.approve.all'),
  ('hrm.ot.approve.all', 'hrm.request.approve.all'),
  ('hrm.trip.approve.all', 'hrm.request.approve.all'),
  ('hrm.shift.approve.all', 'hrm.request.approve.all'),
  ('hrm.attendance.approve.all', 'hrm.request.approve.all'),
  ('hrm.profile.approve.all', 'hrm.request.approve.all'),
  ('hrm.advance.approve.all', 'hrm.request.approve.all'),
  ('hrm.custom.approve.all', 'hrm.request.approve.all');

INSERT INTO core_schema.permission_actions (permission_id, action_key)
SELECT DISTINCT pa.permission_id, m.new_key
  FROM core_schema.permission_actions pa
  JOIN hrm_approve_key_map m ON m.old_key = pa.action_key
ON CONFLICT DO NOTHING;

DELETE FROM core_schema.permission_actions
 WHERE action_key IN (SELECT old_key FROM hrm_approve_key_map);

INSERT INTO core_schema.user_permission_grants (user_id, action_key, granted_by, granted_at)
SELECT g.user_id, m.new_key, (array_agg(g.granted_by ORDER BY g.granted_at))[1], min(g.granted_at)
  FROM core_schema.user_permission_grants g
  JOIN hrm_approve_key_map m ON m.old_key = g.action_key
 GROUP BY g.user_id, m.new_key
ON CONFLICT DO NOTHING;

DELETE FROM core_schema.user_permission_grants
 WHERE action_key IN (SELECT old_key FROM hrm_approve_key_map);
