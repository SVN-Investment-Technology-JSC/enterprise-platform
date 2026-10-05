-- HRM_FIX_03_CLEANUP.sql  (FIX-C-08)
-- CHUA CHAY. Chay thu cong tren DB tenant savina sau khi sao luu:
--   docker exec enterprise-platform-tenant-db-1 pg_dump -U tenant -d savina -Fc > savina_before_c08.dump
--   docker exec -i enterprise-platform-tenant-db-1 psql -U tenant -d savina < docs/hrm-fix-plan/HRM_FIX_03_CLEANUP.sql
-- Xoa ban ghi QA03-* chua co tham chieu, ngung su dung ban ghi da co tham chieu, mo lai phien ban cong thuc luong v1.

\set ON_ERROR_STOP on
BEGIN;
\echo === work_calendar
DELETE FROM hrm_schema.work_calendar WHERE name ILIKE 'QA03%';

\echo === attendance_sites
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, name FROM hrm_schema.attendance_sites WHERE name ILIKE 'QA03%' LOOP
    BEGIN
      DELETE FROM hrm_schema.attendance_sites WHERE id = r.id;
      RAISE NOTICE 'deleted site %', r.name;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE hrm_schema.attendance_sites SET active = false WHERE id = r.id;
      RAISE NOTICE 'deactivated site % (has references)', r.name;
    END;
  END LOOP;
END $$;

\echo === attendance_devices
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, name FROM hrm_schema.attendance_devices WHERE name ILIKE 'QA03%' LOOP
    BEGIN
      DELETE FROM hrm_schema.attendance_devices WHERE id = r.id;
      RAISE NOTICE 'deleted device %', r.name;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'kept device % (has references, already REVOKED)', r.name;
    END;
  END LOOP;
END $$;

\echo === shift_definitions
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, code FROM hrm_schema.shift_definitions WHERE code ILIKE 'QA03%' LOOP
    BEGIN
      DELETE FROM hrm_schema.shift_definitions WHERE id = r.id;
      RAISE NOTICE 'deleted shift %', r.code;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE hrm_schema.shift_definitions SET status = 'INACTIVE' WHERE id = r.id;
      RAISE NOTICE 'deactivated shift % (has references)', r.code;
    END;
  END LOOP;
END $$;

\echo === leave_types
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, code FROM hrm_schema.leave_types WHERE code ILIKE 'QA03%' LOOP
    BEGIN
      DELETE FROM hrm_schema.leave_types WHERE id = r.id;
      RAISE NOTICE 'deleted leave type %', r.code;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE hrm_schema.leave_types SET active = false WHERE id = r.id;
      RAISE NOTICE 'deactivated leave type % (has references)', r.code;
    END;
  END LOOP;
END $$;

\echo === salary_grades
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, code FROM hrm_schema.salary_grades WHERE code ILIKE 'QA03%' LOOP
    BEGIN
      DELETE FROM hrm_schema.salary_grades WHERE id = r.id;
      RAISE NOTICE 'deleted grade %', r.code;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE hrm_schema.salary_grades SET status = 'INACTIVE' WHERE id = r.id;
      RAISE NOTICE 'deactivated grade % (has references)', r.code;
    END;
  END LOOP;
END $$;

\echo === request_procedure_bindings
DELETE FROM hrm_schema.request_procedure_bindings WHERE sub_type_code ILIKE 'QA03%';

\echo === payroll formula v1 reopen
UPDATE hrm_schema.policy_versions
   SET effective_to = NULL, status = 'ACTIVE', updated_at = now()
 WHERE id = 'c9a1dc83-755b-4c27-9013-6f90cc8a4461'
   AND effective_to = DATE '2029-12-31';
COMMIT;
