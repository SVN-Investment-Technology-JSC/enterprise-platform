import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const empId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066'; // Bùi Công Quyền
  const tenantId = 'c0195fb2-3073-445c-9768-b6d3aabaa7a8';

  const res = await client.query(`
    SELECT a.id, a.shift_id, a.effective_from, a.effective_to, a.status, a.source,
           s.name, s.code, s.start_time, s.end_time
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id=a.shift_id
    WHERE a.tenant_id=$1 AND a.employee_id=$2
    ORDER BY a.effective_from
  `, [tenantId, empId]);

  console.log('ALL ASSIGNMENTS FOR QUYEN:', res.rows);

  await client.end();
}

run().catch(console.error);
