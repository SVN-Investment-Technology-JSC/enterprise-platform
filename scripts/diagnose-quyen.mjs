import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const empId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066'; // Bùi Công Quyền

  const emp = await client.query(`
    SELECT e.id, e.full_name, p.employee_code
    FROM core_schema.employees e
    LEFT JOIN hrm_schema.employee_profiles p ON p.employee_id = e.id
    WHERE e.id = $1
  `, [empId]);
  console.log('Employee:', emp.rows[0]);

  const assignments = await client.query(`
    SELECT a.id, a.shift_id, s.name, s.code, s.start_time, s.end_time, a.effective_from, a.effective_to, a.status, a.source
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id = a.shift_id
    WHERE a.employee_id = $1
    ORDER BY a.effective_from
  `, [empId]);
  console.log('Current assignments for Quyền:', assignments.rows);

  await client.end();
}

run().catch(console.error);
