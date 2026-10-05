import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const shifts = await client.query(`
    SELECT id, code, name, start_time, end_time, tenant_id FROM hrm_schema.shift_definitions ORDER BY code
  `);
  console.log('--- ALL SHIFT DEFINITIONS ---');
  console.table(shifts.rows);

  const assignments = await client.query(`
    SELECT a.id, a.employee_id, e.full_name, s.code, s.name as shift_name, a.effective_from, a.effective_to, a.status, a.source
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id = a.shift_id
    JOIN core_schema.employees e ON e.id = a.employee_id
    ORDER BY e.full_name, a.effective_from
  `);
  console.log('--- ALL SHIFT ASSIGNMENTS ---');
  console.table(assignments.rows);

  const policies = await client.query(`
    SELECT p.id, p.policy_type, p.name, p.status, v.version_no, v.effective_from, v.effective_to, v.config_json
    FROM hrm_schema.policies p
    JOIN hrm_schema.policy_versions v ON v.policy_id = p.id
    ORDER BY p.policy_type, v.version_no
  `);
  console.log('--- ALL POLICIES ---');
  console.table(policies.rows.map(r => ({
    type: r.policy_type,
    name: r.name,
    status: r.status,
    from: r.effective_from,
    to: r.effective_to,
    config: JSON.stringify(r.config_json).slice(0, 50)
  })));

  await client.end();
}

run().catch(console.error);
