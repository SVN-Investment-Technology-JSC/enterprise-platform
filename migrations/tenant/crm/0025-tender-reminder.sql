-- Bán hàng (crm) · nhắc hạn nộp thầu (GĐ E, P2E-05): ghi hạn nộp đã nhắc cho từng mốc để không nhắc trùng.
-- `deadline_soon_notified_for` / `deadline_overdue_notified_for` giữ giá trị `submission_deadline` đã được nhắc;
-- dời hạn thì giá trị khác nên nhắc lại theo hạn mới. Cột mới cho phép NULL: bản app cũ không ghi nên không ảnh hưởng.
-- Chạy lại được: ADD COLUMN IF NOT EXISTS.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.tender_profiles ADD COLUMN IF NOT EXISTS deadline_soon_notified_for TIMESTAMPTZ;
ALTER TABLE crm_schema.tender_profiles ADD COLUMN IF NOT EXISTS deadline_overdue_notified_for TIMESTAMPTZ;
