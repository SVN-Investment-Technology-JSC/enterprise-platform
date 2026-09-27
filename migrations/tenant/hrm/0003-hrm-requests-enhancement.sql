-- Migration: Add Phase 1 HRM requests and leave enhancements
-- File: migrations/tenant/hrm/0003-hrm-requests-enhancement.sql

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Leave Balances: Phép thâm niên & Hạn chuyển tiếp phép tồn
ALTER TABLE hrm_schema.leave_balances ADD COLUMN IF NOT EXISTS seniority_days NUMERIC(6,2) DEFAULT 0;
ALTER TABLE hrm_schema.leave_balances ADD COLUMN IF NOT EXISTS carryover_remaining NUMERIC(6,2) DEFAULT 0;
ALTER TABLE hrm_schema.leave_balances ADD COLUMN IF NOT EXISTS carryover_expiry_date DATE;
ALTER TABLE hrm_schema.leave_balances ADD COLUMN IF NOT EXISTS max_negative_allowed NUMERIC(6,2) DEFAULT 2.0;

-- 2. Leave Requests: Cờ ứng phép âm và số ngày thâm niên sử dụng
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS is_negative_leave BOOLEAN DEFAULT FALSE;
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS seniority_days_used NUMERIC(5,2) DEFAULT 0;

-- 3. Business Trip Requests: Liên kết Dự án & Vị trí GPS công trường
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS milestone_id UUID;
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS destination_lat DOUBLE PRECISION;
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS destination_lng DOUBLE PRECISION;

-- 4. Overtime Requests: Đối soát 2 vòng & Cảnh báo trần giờ
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS is_night_ot BOOLEAN DEFAULT FALSE;
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS exceeds_daily_limit BOOLEAN DEFAULT FALSE;
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS exceeds_monthly_limit BOOLEAN DEFAULT FALSE;
