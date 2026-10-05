-- HRM_FIX_03_MERGE_ATTENDANCE_POLICIES.sql
-- Gop 2 ban ghi chinh sach ATTENDANCE thanh 1 ban ghi duy nhat (POL-ATT-2026),
-- giu nguyen lich su phien ban (v1 tu 2026-01-01 den 2026-10-02, v2 tu 2026-10-03 khong gioi han),
-- va ke thua toan bo config_json (break_minutes, grace_late_minutes, workday_standard_minutes, timezone, requireGps...).

\set ON_ERROR_STOP on
BEGIN;

-- 1. Dong phien ban v1 vao ngay 2026-10-02 (ngay truoc khi v2 co hieu luc)
UPDATE hrm_schema.policy_versions
   SET effective_to = DATE '2026-10-02',
       status = 'SUPERSEDED',
       updated_at = clock_timestamp()
 WHERE id = 'a1000000-0000-4000-8000-000000000002';

-- 2. Chuyen phien ban v2 (ea06511c...) sang policy goc (a1000000...-0001), doi version_no thanh 2
--    dong thoi merge cau hinh thua ke tu v1
UPDATE hrm_schema.policy_versions
   SET policy_id = 'a1000000-0000-4000-8000-000000000001',
       version_no = 2,
       config_json = config_json || (SELECT config_json FROM hrm_schema.policy_versions WHERE id = 'a1000000-0000-4000-8000-000000000002'),
       updated_at = clock_timestamp()
 WHERE id = 'ea06511c-de5d-4c4e-8fb9-2644daa7a156';

-- 3. Xoa ban ghi policy du thua ATTENDANCE_DEFAULT
DELETE FROM hrm_schema.policies
 WHERE id = 'f7d4e6ba-a2f8-4b69-b437-64ff83b91299';

COMMIT;
