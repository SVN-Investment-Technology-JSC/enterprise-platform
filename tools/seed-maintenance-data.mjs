import pg from '../apps/migrator/node_modules/pg/lib/index.js';
import { randomUUID } from 'crypto';

const TENANT_DB_URL = process.env.TENANT_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55436/test';

async function seedMaintenanceData() {
  const client = new pg.Client({ connectionString: TENANT_DB_URL });
  await client.connect();
  console.log('Connected to tenant database:', TENANT_DB_URL);

  try {
    await client.query('BEGIN');

    // 1. Đồng bộ danh mục Quy trình từ procedure_schema sang maintenance_schema.procedure_catalog nếu có
    console.log('Synchronizing published procedures into maintenance procedure catalog...');
    const procDefsRes = await client.query(
      `SELECT id, code, name, status FROM procedure_schema.definitions WHERE status = 'published'`
    );
    for (const proc of procDefsRes.rows) {
      await client.query(
        `INSERT INTO maintenance_schema.procedure_catalog (definition_id, code, name, version_number, status, synchronized_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (definition_id) DO UPDATE
         SET code = EXCLUDED.code, name = EXCLUDED.name, version_number = EXCLUDED.version_number, status = EXCLUDED.status, synchronized_at = now()`,
        [proc.id, proc.code, proc.name, 1, proc.status]
      );
    }

    const procedureRows = (await client.query('SELECT definition_id, code, name FROM maintenance_schema.procedure_catalog')).rows;
    console.log(`Found ${procedureRows.length} procedure catalog entries.`);

    // 2. Lấy danh sách Users để gán người phụ trách
    const userRes = await client.query('SELECT id, full_name, email FROM core_schema.users ORDER BY created_at ASC');
    const users = userRes.rows;
    const defaultUser = users[0] || { id: 'ed4d54be-21c9-43dc-b442-c08c7ddbd12b', full_name: 'Quản trị viên Hệ thống' };

    // 3. Lấy danh sách Assets từ inventory_schema
    const assetRes = await client.query(`SELECT code, name, type FROM inventory_schema.assets ORDER BY code`);
    const assets = assetRes.rows;
    console.log(`Found ${assets.length} assets in inventory_schema.`);

    if (assets.length === 0) {
      console.warn('No assets found in inventory. Please seed inventory data first.');
    }

    // 4. Xóa dữ liệu bảo trì cũ để sinh mới sạch sẽ
    console.log('Cleaning existing maintenance records...');
    await client.query('DELETE FROM maintenance_schema.occurrences');
    await client.query('DELETE FROM maintenance_schema.schedules');

    // 5. Tạo các Lịch bảo trì định kỳ (Schedules)
    console.log('Creating Maintenance Schedules...');

    const sampleSchedules = [
      {
        code: 'SCH-HP-GT101-M',
        title: 'Bảo dưỡng định kỳ hàng tháng Turbine Khí GE 9E (EQ-HP-GT101)',
        assetCode: 'EQ-HP-GT101',
        frequency: 'month',
        priority: 'High',
        status: 'active',
        startDate: '2026-01-01',
        nextDueAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        procedureDefId: procedureRows[0]?.definition_id || null,
      },
      {
        code: 'SCH-HP-GEN201-Q',
        title: 'Kiểm tra độ rung và điện trở cách điện Máy phát Siemens 175MVA (EQ-HP-GEN201)',
        assetCode: 'EQ-HP-GEN201',
        frequency: 'quarter',
        priority: 'High',
        status: 'active',
        startDate: '2026-01-15',
        nextDueAt: new Date(Date.now() + 15 * 86400000).toISOString(),
        procedureDefId: procedureRows[0]?.definition_id || null,
      },
      {
        code: 'SCH-HP-BFP01-W',
        title: 'Bôi trơn ổ trục & kiểm tra phớt cơ khí Bơm cấp nước lò hơi KSB (EQ-HP-BFP01)',
        assetCode: 'EQ-HP-BFP01',
        frequency: 'week',
        priority: 'Normal',
        status: 'active',
        startDate: '2026-02-01',
        nextDueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        procedureDefId: procedureRows[1]?.definition_id || null,
      },
      {
        code: 'SCH-HP-VLV01-M',
        title: 'Kiểm định van an toàn hơi chính Crosby & bôi trơn ty van (EQ-HP-VLV01)',
        assetCode: 'EQ-HP-VLV01',
        frequency: 'month',
        priority: 'Normal',
        status: 'active',
        startDate: '2026-02-10',
        nextDueAt: new Date(Date.now() - 3 * 86400000).toISOString(), // Quá hạn một chút để test
        procedureDefId: null,
      },
      {
        code: 'SCH-HP-TR01-Y',
        title: 'Thí nghiệm dầu cách điện & bảo dưỡng máy biến áp 110kV ABB (EQ-HP-TR01)',
        assetCode: 'EQ-HP-TR01',
        frequency: 'year',
        priority: 'High',
        status: 'active',
        startDate: '2025-11-01',
        nextDueAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        procedureDefId: procedureRows[0]?.definition_id || null,
      },
      {
        code: 'SCH-DQ-CMP01-M',
        title: 'Bảo trì hệ thống bôi trơn tuần hoàn Máy nén khí Atlas Copco (EQ-DQ-CMP01)',
        assetCode: 'EQ-DQ-CMP01',
        frequency: 'month',
        priority: 'Normal',
        status: 'active',
        startDate: '2026-01-01',
        nextDueAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        procedureDefId: null,
      },
      {
        code: 'SCH-DQ-COL01-Q',
        title: 'Nội soi kiểm tra ăn mòn mâm tháp chưng cất Sulzer (EQ-DQ-COL01)',
        assetCode: 'EQ-DQ-COL01',
        frequency: 'quarter',
        priority: 'High',
        status: 'paused',
        pausedReason: 'Chờ đợt dừng máy toàn nhà máy',
        startDate: '2026-03-01',
        nextDueAt: new Date(Date.now() + 45 * 86400000).toISOString(),
        procedureDefId: null,
      },
      {
        code: 'SCH-HP-ESP01-M',
        title: 'Vệ sinh điện cực thu bụi tĩnh điện ESP Lò hơi CFB (EQ-HP-ESP01)',
        assetCode: 'EQ-HP-ESP01',
        frequency: 'month',
        priority: 'Low',
        status: 'active',
        startDate: '2026-01-01',
        nextDueAt: new Date(Date.now() + 12 * 86400000).toISOString(),
        procedureDefId: null,
      }
    ];

    const scheduleMap = new Map();

    for (const item of sampleSchedules) {
      const scheduleId = randomUUID();
      await client.query(
        `INSERT INTO maintenance_schema.schedules
         (id, code, title, asset_code, procedure_definition_id, frequency, priority, status, paused_reason, start_date, timezone, next_due_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Asia/Ho_Chi_Minh', $11, now(), now())`,
        [
          scheduleId,
          item.code,
          item.title,
          item.assetCode,
          item.procedureDefId,
          item.frequency,
          item.priority,
          item.status,
          item.pausedReason || null,
          item.startDate,
          item.nextDueAt
        ]
      );
      scheduleMap.set(item.code, { id: scheduleId, ...item });
    }
    console.log(`Created ${sampleSchedules.length} maintenance schedules.`);

    // 6. Tạo các Phiếu công việc & Lịch sử bảo trì (Occurrences: Định kỳ + Sự cố + Hoàn thành)
    console.log('Creating Maintenance Occurrences & History...');

    const sampleOccurrences = [
      // 6.1. Phiếu đã hoàn thành trong quá khứ (Lịch sử định kỳ - Preventive History)
      {
        scheduleCode: 'SCH-HP-GT101-M',
        kind: 'preventive',
        code: 'WO-2026-GT01',
        title: 'Bảo dưỡng định kỳ tháng 01/2026 - Turbine Khí GE 9E',
        assetCode: 'EQ-HP-GT101',
        dueAt: new Date(Date.now() - 35 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 34 * 86400000).toISOString(),
        status: 'completed',
        priority: 'High',
        procedureInstanceCode: 'INST-MMS-2026-001',
        completionNote: 'Đã thay phin lọc gió buồng đốt, vệ sinh vòi phun nhiên liệu khí, kiểm tra thông số nhiệt độ khí thải bình thường.',
        assignee: users[1] || defaultUser,
        completedBy: users[1] || defaultUser,
        description: 'Bảo dưỡng định kỳ cấp độ A (Monthly PM)',
      },
      {
        scheduleCode: 'SCH-HP-BFP01-W',
        kind: 'preventive',
        code: 'WO-2026-BFP01',
        title: 'Kiểm tra và tra mỡ ổ trục Bơm cấp nước lò hơi KSB tuần 07',
        assetCode: 'EQ-HP-BFP01',
        dueAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        status: 'completed',
        priority: 'Normal',
        procedureInstanceCode: null,
        completionNote: 'Bơm bổ sung mỡ chịu nhiệt Kluber Isoflex, độ rung trục sau bảo dưỡng 1.8 mm/s (đạt tiêu chuẩn).',
        assignee: users[2] || defaultUser,
        completedBy: users[2] || defaultUser,
        description: 'Kiểm tra bôi trơn định kỳ tuần',
      },
      {
        scheduleCode: 'SCH-DQ-CMP01-M',
        kind: 'preventive',
        code: 'WO-2026-CMP01',
        title: 'Bảo trì thay dầu bôi trơn Máy nén khí Atlas Copco',
        assetCode: 'EQ-DQ-CMP01',
        dueAt: new Date(Date.now() - 25 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 24 * 86400000).toISOString(),
        status: 'completed',
        priority: 'Normal',
        procedureInstanceCode: null,
        completionNote: 'Đã xả cặn và châm mới 120L dầu Shell Corena S4 R46, thay tách nhớt và lọc gió.',
        assignee: users[3] || defaultUser,
        completedBy: users[3] || defaultUser,
        description: 'Bảo dưỡng thay dầu định kỳ',
      },
      {
        scheduleCode: 'SCH-HP-ESP01-M',
        kind: 'preventive',
        code: 'WO-2026-ESP01',
        title: 'Vệ sinh và cân chỉnh búa gõ bụi tĩnh điện ESP',
        assetCode: 'EQ-HP-ESP01',
        dueAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 19 * 86400000).toISOString(),
        status: 'completed',
        priority: 'Low',
        procedureInstanceCode: null,
        completionNote: 'Đã thông tắc phễu tro số 2 và chỉnh lại hành trình búa gõ.',
        assignee: users[0] || defaultUser,
        completedBy: users[0] || defaultUser,
        description: 'Vệ sinh phễu gom tro và điện cực',
      },

      // 6.2. Phiếu phát sinh / công việc hiện tại (Occurrences: Planned, Generated, In-Progress)
      {
        scheduleCode: 'SCH-HP-GT101-M',
        kind: 'preventive',
        code: 'WO-2026-GT02',
        title: 'Bảo dưỡng định kỳ tháng 02/2026 - Turbine Khí GE 9E',
        assetCode: 'EQ-HP-GT101',
        dueAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        completedAt: null,
        status: 'generated',
        priority: 'High',
        procedureInstanceCode: 'INST-MMS-2026-088',
        completionNote: null,
        assignee: users[1] || defaultUser,
        completedBy: null,
        description: 'Đã sinh phiếu từ quy trình tự động, chuẩn bị vật tư lọc khí.',
      },
      {
        scheduleCode: 'SCH-HP-BFP01-W',
        kind: 'preventive',
        code: 'WO-2026-BFP02',
        title: 'Bảo dưỡng định kỳ tuần này - Bơm cấp nước lò hơi KSB',
        assetCode: 'EQ-HP-BFP01',
        dueAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        completedAt: null,
        status: 'planned',
        priority: 'Normal',
        procedureInstanceCode: null,
        completionNote: null,
        assignee: users[2] || defaultUser,
        completedBy: null,
        description: 'Lịch bảo dưỡng định kỳ sắp đến hạn thực hiện.',
      },
      {
        scheduleCode: 'SCH-HP-VLV01-M',
        kind: 'preventive',
        code: 'WO-2026-VLV01',
        title: 'Kiểm định van an toàn hơi chính Crosby',
        assetCode: 'EQ-HP-VLV01',
        dueAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        completedAt: null,
        status: 'dispatch_pending',
        priority: 'Normal',
        procedureInstanceCode: null,
        completionNote: null,
        assignee: users[0] || defaultUser,
        completedBy: null,
        description: 'Phiếu đến hạn đang chờ cấp phát quy trình kiểm định.',
      },

      // 6.3. Sự cố đột xuất (Incidents: Đang xử lý & Đã hoàn thành)
      {
        scheduleCode: null,
        kind: 'incident',
        code: 'INC-2026-A101',
        title: 'Báo động nhiệt độ ổ đỡ chặn Turbine Khí tăng cao bất thường (92°C)',
        assetCode: 'EQ-HP-GT101',
        dueAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        completedAt: null,
        status: 'in_progress',
        priority: 'High',
        procedureInstanceCode: null,
        completionNote: null,
        assignee: users[1] || defaultUser,
        completedBy: null,
        description: 'Cảm biến nhiệt độ TE-101 báo 92°C (ngưỡng cảnh báo 85°C). Đội kỹ thuật cơ khí đang đo lưu lượng dầu làm mát.',
      },
      {
        scheduleCode: null,
        kind: 'incident',
        code: 'INC-2026-B205',
        title: 'Rò rỉ phớt cơ khí trục bơm nước làm mát chính BFP01',
        assetCode: 'EQ-HP-BFP01',
        dueAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        status: 'completed',
        priority: 'High',
        procedureInstanceCode: 'INST-RD-2026-012',
        completionNote: 'Đã cô lập bơm số 1, tháo và thay thế bộ seal Cartridge John Crane Type 5610, thử áp đạt 25 bar không rò rỉ.',
        assignee: users[2] || defaultUser,
        completedBy: users[2] || defaultUser,
        description: 'Nước làm mát rò rỉ ra ngoài bệ bơm ~ 2 lít/phút.',
      },
      {
        scheduleCode: null,
        kind: 'incident',
        code: 'INC-2026-C309',
        title: 'Sụt áp khí nén điều khiển phân xưởng Naphtha Dung Quất',
        assetCode: 'EQ-DQ-CMP01',
        dueAt: new Date(Date.now() - 18 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 18 * 86400000).toISOString(),
        status: 'completed',
        priority: 'High',
        procedureInstanceCode: null,
        completionNote: 'Xử lý nứt đường ống trích khí điều khiển 1/2 inch tại đầu ra bình chứa khí tích áp.',
        assignee: users[3] || defaultUser,
        completedBy: users[3] || defaultUser,
        description: 'Áp lực hệ thống giảm từ 7.5 bar xuống 5.2 bar gây cảnh báo phòng điều khiển.',
      }
    ];

    for (const occ of sampleOccurrences) {
      const occurrenceId = randomUUID();
      const sched = occ.scheduleCode ? scheduleMap.get(occ.scheduleCode) : null;
      const schedId = sched?.id || null;

      await client.query(
        `INSERT INTO maintenance_schema.occurrences
         (id, schedule_id, kind, code, title, asset_code, description, due_at, status,
          priority, procedure_instance_code, completion_note, completed_at, completed_by, completed_by_name,
          assignee_id, assignee_name, idempotency_key, created_by, created_by_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $8)`,
        [
          occurrenceId,
          schedId,
          occ.kind,
          occ.code,
          occ.title,
          occ.assetCode,
          occ.description,
          occ.dueAt,
          occ.status,
          occ.priority,
          occ.procedureInstanceCode,
          occ.completionNote,
          occ.completedAt,
          occ.completedBy?.id || null,
          occ.completedBy?.full_name || null,
          occ.assignee?.id || null,
          occ.assignee?.full_name || null,
          `seed:occurrence:${occ.code}`,
          defaultUser.id,
          defaultUser.full_name,
        ]
      );
    }

    console.log(`Created ${sampleOccurrences.length} maintenance occurrences & history items.`);

    await client.query('COMMIT');
    console.log('✅ Maintenance seed data completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding maintenance data:', error);
    throw error;
  } finally {
    await client.end();
  }
}

seedMaintenanceData().catch(() => process.exit(1));
