SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Thêm loại quyết định "Bãi nhiệm" (REVOKE): chấm dứt một chức danh kiêm nhiệm.
-- Loại này chỉ ghi nhận lịch sử công tác (RECORDED); chức danh bị bãi nhiệm lưu ở to_position_node_id.
ALTER TABLE hrm_schema.personnel_decisions
  DROP CONSTRAINT IF EXISTS personnel_decisions_decision_type_check;
ALTER TABLE hrm_schema.personnel_decisions
  ADD CONSTRAINT personnel_decisions_decision_type_check
  CHECK (decision_type IN ('APPOINT','PROMOTE','TRANSFER','CONCURRENT','DISMISS','CHANGE_MANAGER','REVOKE'));
