import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const allEmployees = await client.query(`
    SELECT e.id, e.full_name, e.user_id, p.employee_code
    FROM core_schema.employees e
    LEFT JOIN hrm_schema.employee_profiles p ON p.employee_id = e.id
    ORDER BY e.full_name
  `);
  console.log('ALL EMPLOYEES:');
  for (const emp of allEmployees.rows) {
    console.log(` - ${emp.full_name} (${emp.employee_code}) - id: ${emp.id}`);
  }

  const empId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066'; // Bùi Công Quyền
  const tenantId = 'c0195fb2-3073-445c-9768-b6d3aabaa7a8';
  const today = '2026-10-01';
  const timezone = 'Asia/Ho_Chi_Minh';

  const testQuery = await client.query(`
    SELECT a.id, a.shift_id, s.name, s.code, s.start_time, s.end_time
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id=a.shift_id AND s.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE'
      AND $3::date >= a.effective_from AND (a.effective_to IS NULL OR $3::date <= a.effective_to)
  `, [tenantId, empId, today]);

  console.log(`\nActive shifts for Quyền on ${today}:`, testQuery.rows);

  await client.end();
}

run().catch(console.error);
