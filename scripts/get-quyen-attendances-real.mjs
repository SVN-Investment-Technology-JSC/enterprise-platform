import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();
  const empId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066'; // Bùi Công Quyền

  const att = await client.query(`
    SELECT id, to_char(work_date, 'YYYY-MM-DD') as date_str, check_in_at, check_out_at, status, worked_minutes, note
    FROM hrm_schema.attendances
    WHERE employee_id = $1
    ORDER BY work_date ASC
  `, [empId]);
  console.log('=== Attendances of Bùi Công Quyền ===');
  console.table(att.rows);

  const leaves = await client.query(`
    SELECT r.id, r.from_date, r.to_date, r.duration, r.status, t.code as type_code, t.name as type_name, t.is_paid
    FROM hrm_schema.leave_requests r
    JOIN hrm_schema.leave_types t ON t.id = r.leave_type_id
    WHERE r.employee_id = $1
  `, [empId]);
  console.log('=== Leaves of Bùi Công Quyền ===');
  console.table(leaves.rows);

  await client.end();
}

run().catch(console.error);
