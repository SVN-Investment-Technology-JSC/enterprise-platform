import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const periods = await client.query('SELECT id, period_code, from_date, to_date, status, calculated_at FROM hrm_schema.timesheet_periods ORDER BY from_date DESC');
  console.log('--- ALL PERIODS ---');
  for (const p of periods.rows) {
    const counts = await client.query('SELECT status, COUNT(*)::int AS cnt FROM hrm_schema.timesheets WHERE period_id = $1 GROUP BY status', [p.id]);
    console.log(`Period ${p.period_code} (${p.id}):`, {
      from: p.from_date,
      to: p.to_date,
      status: p.status,
      calculated_at: p.calculated_at,
      lines: counts.rows
    });
  }

  // Check pending requests for each period
  for (const p of periods.rows) {
    const pending = await client.query(
      `SELECT count(*)::int as cnt FROM (
        SELECT id FROM hrm_schema.attendance_corrections WHERE status='PENDING' AND request_date BETWEEN $1 AND $2 
        UNION ALL SELECT id FROM hrm_schema.leave_requests WHERE status='PENDING' AND from_date<=$2 AND to_date>=$1 
        UNION ALL SELECT id FROM hrm_schema.ot_requests WHERE status='PENDING' AND work_date BETWEEN $1 AND $2 
        UNION ALL SELECT id FROM hrm_schema.business_trip_requests WHERE status='PENDING' AND from_date<=$2 AND to_date>=$1 
        UNION ALL SELECT id FROM hrm_schema.shift_change_requests WHERE status IN ('PENDING','PEER_CONFIRMED') AND from_date<=$2 AND to_date>=$1
      ) t`,
      [p.from_date, p.to_date]
    );
    console.log(`Period ${p.period_code} pending requests:`, pending.rows[0].cnt);
  }

  await client.end();
}

run().catch(console.error);
