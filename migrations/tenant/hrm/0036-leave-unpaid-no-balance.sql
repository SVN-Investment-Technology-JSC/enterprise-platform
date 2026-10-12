-- Quỹ phép chỉ áp dụng cho phép năm: loại nghỉ không lương không trừ quỹ.
-- Đơn đã tạo giữ nguyên balance_reserved để việc nhả/duyệt cũ vẫn đúng.
UPDATE hrm_schema.leave_types SET deduct_balance = false WHERE paid = false AND deduct_balance = true;
