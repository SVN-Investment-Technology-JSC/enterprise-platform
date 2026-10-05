import pg from 'file:///d:/CRM/enterprise-platform/packages/adapters/database/node_modules/pg/lib/index.js';

const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://tenant:tenant@localhost:55436/savina' });

async function run() {
  await client.connect();

  console.log('=== TIẾN HÀNH DỌN DẸP CA TRÙNG CHO BÙI CÔNG QUYỀN VÀ CÁC NHÂN SỰ LIÊN QUAN ===');

  // 1. Kiểm tra Quyền
  const quyenId = 'fe5f4c6c-7881-4fe6-b882-481c352ba066';
  const quyenAssignments = await client.query(`
    SELECT a.id, s.code, s.name, a.status, a.effective_from, a.effective_to
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id = a.shift_id
    WHERE a.employee_id = $1 AND a.status = 'ACTIVE'
    ORDER BY s.code
  `, [quyenId]);

  console.log('Ca hiện tại của Quyền trước khi cập nhật:', quyenAssignments.rows);

  // Giữ lại Ca 1 (Ca sáng C1: 06:00 - 14:00), chuyển C2 và C3 sang SUPERSEDED
  const c2Id = '32adfd0f-5363-4830-abf3-5e74a4744f8b';
  const c3Id = '45549a9c-82f9-4777-9d22-86bc5ede9d82';

  await client.query(`
    UPDATE hrm_schema.shift_assignments 
    SET status = 'SUPERSEDED', updated_at = now()
    WHERE id IN ($1, $2)
  `, [c2Id, c3Id]);

  console.log('-> Đã hủy 2 ca thừa (C2, C3) của Quyền, giữ lại Ca sáng C1!');

  // 2. Với các nhân sự khác có 3 ca C1, C2, C3 trùng nhau do seed data trước đây:
  // Tắt C2 và C3, giữ lại C1 để toàn bộ nhân viên này không bị crash ConflictException khi chấm công
  const otherOverlaps = await client.query(`
    SELECT a.id, a.employee_id, s.code, e.full_name
    FROM hrm_schema.shift_assignments a
    JOIN hrm_schema.shift_definitions s ON s.id = a.shift_id
    JOIN core_schema.employees e ON e.id = a.employee_id
    WHERE a.status = 'ACTIVE' AND s.code IN ('C2', 'C3')
      AND a.employee_id IN (
        SELECT employee_id FROM hrm_schema.shift_assignments
        WHERE status = 'ACTIVE'
        GROUP BY employee_id HAVING count(*) > 1
      )
  `);

  console.log(`Tìm thấy ${otherOverlaps.rows.length} ca trùng của các nhân viên khác cần giải quyết.`);
  if (otherOverlaps.rows.length > 0) {
    const ids = otherOverlaps.rows.map(r => r.id);
    await client.query(`
      UPDATE hrm_schema.shift_assignments
      SET status = 'SUPERSEDED', updated_at = now()
      WHERE id = ANY($1)
    `, [ids]);
    console.log(`-> Đã chuyển ${ids.length} ca trùng về SUPERSEDED.`);
  }

  // 3. Kiểm tra lại xem còn ai bị trùng không
  const checkAgain = await client.query(`
    SELECT a.employee_id, e.full_name, count(*) as count
    FROM hrm_schema.shift_assignments a
    JOIN core_schema.employees e ON e.id = a.employee_id
    WHERE a.status = 'ACTIVE'
    GROUP BY a.employee_id, e.full_name
    HAVING count(*) > 1
  `);
  console.log('Số nhân viên còn bị trùng ca sau dọn dẹp:', checkAgain.rows);

  await client.end();
}

run().catch(console.error);
