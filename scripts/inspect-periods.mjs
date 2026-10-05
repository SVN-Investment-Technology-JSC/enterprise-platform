import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();
  const periods = await client.query('SELECT * FROM hrm_schema.timesheet_periods ORDER BY from_date DESC LIMIT 5');
  console.log('PERIODS:', JSON.stringify(periods.rows, null, 2));

  if (periods.rows.length > 0) {
    const period = periods.rows[0];
    const ts = await client.query('SELECT count(*), status FROM hrm_schema.timesheets WHERE period_id = $1 GROUP BY status', [period.id]);
    console.log('TIMESHEET STATS FOR ' + period.name + ' (' + period.id + '):', ts.rows);
  }

  await client.end();
}

run().catch(console.error);
