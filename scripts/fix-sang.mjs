import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  const sangId = '212b7280-7607-4607-ac02-4d8663ed718a';
  const res = await client.query(`
    SELECT a.id, s.code, s.name, a.effective_from, a.effective_to, a.status, a.source
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id = a.shift_id
    WHERE a.employee_id = $1 AND a.status = 'ACTIVE'
    ORDER BY a.effective_from
  `, [sangId]);
  console.log('Sang assignments:', res.rows);

  // Giữ lại 1 ca HC duy nhất, chuyển các ca trùng khác về SUPERSEDED
  if (res.rows.length > 1) {
    const keepId = res.rows[0].id;
    const supersedeIds = res.rows.slice(1).map(r => r.id);
    await client.query(`
      UPDATE hrm_schema.shift_assignments
      SET status = 'SUPERSEDED', updated_at = now()
      WHERE id = ANY($1)
    `, [supersedeIds]);
    console.log(`Đã giữ lại ca ${keepId} và hủy các ca trùng lặp của Nguyễn Hồng Sang.`);
  }

  await client.end();
}

run().catch(console.error);
