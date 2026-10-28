-- Migration: 0019-asset-custodian-and-tests.sql
-- Description: Bổ sung người quản lý tài sản (chỉ lưu assigned_employee_id) và nhật ký thí nghiệm/đo kiểm
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Bổ sung trường quản lý tài sản/trang thiết bị cá nhân (Single Source of Truth, không nhân bản tên nhân sự)
ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS assigned_employee_id UUID,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS asset_category VARCHAR(50) DEFAULT 'INDUSTRIAL' 
        CHECK (asset_category IN ('INDUSTRIAL', 'IT_OFFICE', 'TOOL_PPE', 'VEHICLE'));

CREATE INDEX IF NOT EXISTS idx_materials_assigned_employee ON inventory_schema.materials(assigned_employee_id) 
    WHERE assigned_employee_id IS NOT NULL;

-- 2. Bảng Biên bản Đo kiểm & Thí nghiệm Định kỳ (Asset Test & Inspection Records)
CREATE TABLE IF NOT EXISTS inventory_schema.asset_test_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    test_code VARCHAR(50) NOT NULL,
    test_type VARCHAR(100) NOT NULL,
    test_date DATE NOT NULL,
    next_test_date DATE,
    result_status VARCHAR(50) NOT NULL CHECK (result_status IN ('PASSED', 'FAILED', 'WARNING')),
    measured_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    lead_tester VARCHAR(255) NOT NULL,
    testing_agency VARCHAR(255),
    certificate_number VARCHAR(100),
    attachment_urls JSONB,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_asset_test_code UNIQUE (test_code)
);

CREATE INDEX IF NOT EXISTS idx_asset_test_records_asset ON inventory_schema.asset_test_records(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_test_records_date ON inventory_schema.asset_test_records(test_date);
