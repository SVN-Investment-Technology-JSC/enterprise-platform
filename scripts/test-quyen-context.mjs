import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const empId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066'; // Bùi Công Quyền
  const tenantId = 'c0195fb2-3073-445c-9768-b6d3aabaa7a8';

  const user = await client.query(`
    SELECT e.user_id, e.id as employee_id, e.full_name
    FROM core_schema.employees e
    WHERE e.id = $1
  `, [empId]);

  console.log('USER FOR QUYEN:', user.rows[0]);

  const now = new Date().toISOString();
  console.log('Current ISO timestamp:', now);

  const local = await client.query(
    `SELECT to_char(($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') AS date`,
    [now]
  );
  console.log('Local date:', local.rows[0].date);

  const shiftRes = await client.query(`
    SELECT s.*, a.id AS assignment_id,
    (($3::date + s.start_time) AT TIME ZONE $4) AS starts_at,
    (($3::date + s.end_time + CASE WHEN s.cross_midnight THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS ends_at,
    (($3::date + s.break_start_time + CASE WHEN s.cross_midnight AND s.break_start_time<s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_starts_at,
    (($3::date + s.break_end_time + CASE WHEN s.cross_midnight AND s.break_end_time<=s.start_time THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE $4) AS break_ends_at
    FROM hrm_schema.shift_assignments a JOIN hrm_schema.shift_definitions s ON s.id=a.shift_id AND s.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.status='ACTIVE' AND $3::date>=a.effective_from AND (a.effective_to IS NULL OR $3::date<=a.effective_to)
  `, [tenantId, empId, local.rows[0].date, 'Asia/Ho_Chi_Minh']);

  console.log('shiftForDate returned row count:', shiftRes.rows.length);
  if (shiftRes.rows.length > 1) {
    console.log('CONFLICT DETECTED! Rows returned:');
    for (const r of shiftRes.rows) {
      console.log(` - Assignment ID: ${r.assignment_id}, Shift: ${r.name} (${r.code}), Time: ${r.start_time} -> ${r.end_time}, Source: ${r.source}`);
    }
  }

  await client.end();
}

run().catch(console.error);
