-- Đơn nghỉ không còn giữ chỗ (pending) khi gửi; chỉ trừ quỹ khi duyệt.
-- pending_held đánh dấu các đơn PENDING cũ đã giữ chỗ để vẫn nhả đúng khi duyệt/từ chối/huỷ.
ALTER TABLE hrm_schema.leave_requests
  ADD COLUMN IF NOT EXISTS pending_held boolean NOT NULL DEFAULT false;
UPDATE hrm_schema.leave_requests
  SET pending_held = true
  WHERE status = 'PENDING' AND balance_reserved = true AND pending_held = false;
