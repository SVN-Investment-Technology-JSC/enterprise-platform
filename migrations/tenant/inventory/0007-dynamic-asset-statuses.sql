-- Migration: 0007-dynamic-asset-statuses.sql
-- Description: Dynamic Asset Statuses table and default seed data

CREATE TABLE IF NOT EXISTS amm_schema.amm_asset_statuses (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  badge_label VARCHAR(100),
  color VARCHAR(30) NOT NULL DEFAULT '#10b981',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed standard default statuses
INSERT INTO amm_schema.amm_asset_statuses(code, name, badge_label, color, sort_order, is_active, is_system)
VALUES
  ('OPERATING', 'OPERATING (Đang chạy)', 'Đang chạy', '#10b981', 10, true, true),
  ('TESTING', 'TESTING (Đang thí nghiệm)', 'Đang thí nghiệm', '#0284c7', 20, true, true),
  ('COMMISSIONING', 'COMMISSIONING (Chạy thử nghiệm thu)', 'Chạy thử nghiệm thu', '#06b6d4', 30, true, true),
  ('MAINTENANCE', 'MAINTENANCE (Bảo trì)', 'Bảo trì', '#f59e0b', 40, true, true),
  ('STOPPED', 'STOPPED (Dừng sự cố)', 'Dừng sự cố', '#ef4444', 50, true, true),
  ('STORAGE', 'STORAGE (Lưu kho / Dự phòng)', 'Lưu kho', '#6b7280', 60, true, true)
ON CONFLICT (code) DO UPDATE 
SET name = EXCLUDED.name,
    badge_label = EXCLUDED.badge_label,
    color = EXCLUDED.color,
    sort_order = EXCLUDED.sort_order;
