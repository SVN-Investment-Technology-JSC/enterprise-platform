-- Organization data belongs to each tenant database in core_schema.
-- This removes the deprecated Platform DB model created by 0002-organization.
DROP SCHEMA IF EXISTS organization_schema CASCADE;
