SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- A delegation hands over specific RACI roles. Which roles has to be recorded at
-- delegation time: it is derived from the delegator's org units, which are known
-- then but not when the delegatee later acts.
ALTER TABLE procedure_schema.delegations
    ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE procedure_schema.delegations
    ADD COLUMN IF NOT EXISTS delegated_by_name VARCHAR(180);
