SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DELETE FROM audit_schema.audit_logs
WHERE action LIKE 'crm.%' OR metadata->>'moduleKey' = 'crm';
DELETE FROM integration_schema.provisioning_jobs WHERE module_key = 'crm';
DELETE FROM subscription_schema.plan_modules
WHERE module_id IN (SELECT id FROM module_registry_schema.modules WHERE key = 'crm');
DELETE FROM subscription_schema.tenant_entitlements
WHERE module_id IN (SELECT id FROM module_registry_schema.modules WHERE key = 'crm');
DELETE FROM authorization_schema.role_permissions
WHERE permission_id IN (SELECT id FROM authorization_schema.permissions WHERE key LIKE 'crm.%');
DELETE FROM authorization_schema.permissions WHERE key LIKE 'crm.%';
DELETE FROM module_registry_schema.modules WHERE key = 'crm';
