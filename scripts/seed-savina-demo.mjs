/**
 * Dữ liệu demo cho tenant SAVINA (công ty năng lượng).
 *
 * Chia hai đường vì hai module lưu trữ khác nhau:
 *  - Kho: bảng thường → ghi thẳng SQL, idempotent bằng ON CONFLICT.
 *  - Quy trình + Bảo trì: đi qua HTTP API. Riêng Quy trình bắt buộc phải qua API
 *    vì nguồn sự thật là `runtime_state` jsonb; ghi thẳng bảng normalized sẽ bị
 *    lần đồng bộ kế tiếp xoá sạch.
 *
 * Chạy:  node scripts/seed-savina-demo.mjs
 *
 * `pg` được nạp qua apps/migrator vì workspace pnpm không hoist lên gốc.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('../apps/migrator/node_modules/pg');

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const SAVINA_DB =
  process.env.TENANT_SAVINA_DATABASE_URL ?? 'postgresql://tenant:tenant@localhost:55436/savina';
const ADMIN_EMAIL = process.env.SAVINA_ADMIN_EMAIL ?? 'admin@savina.local';
const ADMIN_PASSWORD = process.env.SAVINA_ADMIN_PASSWORD ?? 'replace-with-a-local-secret';

const UNITS = {
  btgd: '8515a11c-231b-6396-605e-0121a4dc96d4', // Ban Tổng Giám đốc
  kythuat: '5720a373-f343-1587-311c-8be8c0687d2c', // Phòng Kỹ thuật
  thinghiem: '05dc3f30-28bf-19d1-2ab8-4e36f75cacc4', // Phòng Thí nghiệm
  taichinh: '7ea406e4-ac87-3652-6e58-9b8407998dad', // Phòng Tài chính - Kế toán
  kinhdoanh: '2d1337ae-4fb9-83f2-e328-071edfb3d581', // Phòng Kinh doanh
  tuvan: '6fe66a9a-10de-9465-7fe0-beb02e810316', // Trung tâm Tư vấn
  vanhanh: '32a569f1-b28f-6edc-54fa-51088b4778b3', // Phòng Vận hành - Bảo trì
  hanhchinh: 'e9e3ab2e-2ea0-c96c-bd62-c857e5076de8', // Phòng Hành chính - Tổng hợp
  hdqt: '1df21811-dd4d-28ec-fe52-6ebc9ef7740f', // Hội đồng Quản trị
};

// ---------------------------------------------------------------- Kho

const WAREHOUSES = [
  ['KHO-VT', 'Kho Vật tư Trung tâm', UNITS.vanhanh, 'Trụ sở chính — tầng hầm B1'],
  ['KHO-TB', 'Kho Thiết bị Thí nghiệm', UNITS.thinghiem, 'Toà thí nghiệm — tầng 1'],
  ['KHO-DP', 'Kho Dự phòng Miền Nam', UNITS.kythuat, 'Chi nhánh Miền Nam'],
];

/** [mã, tên, nhóm, đơn vị tính, tồn tối thiểu, tồn tối đa] — nhóm theo enum của schema AMM. */
const MATERIALS = [
  ['VT-DAU-MBA', 'Dầu cách điện máy biến áp', 'CONSUMABLE', 'Lít', 200, 2000],
  ['VT-SU-24KV', 'Sứ cách điện 24kV', 'SPARE_PART', 'Cái', 20, 200],
  ['VT-CB-630A', 'Máy cắt hạ thế 630A', 'ROTABLE', 'Cái', 2, 20],
  ['VT-CAP-240', 'Cáp ngầm Cu/XLPE 240mm²', 'SPARE_PART', 'Mét', 500, 5000],
  ['VT-RELAY-OC', 'Rơ le bảo vệ quá dòng', 'ROTABLE', 'Cái', 5, 40],
  ['VT-GANG-CD', 'Găng tay cách điện 24kV', 'TOOL', 'Đôi', 10, 60],
  ['VT-SILICA', 'Hạt hút ẩm silicagel', 'CONSUMABLE', 'Kg', 30, 300],
  ['VT-BULONG-M16', 'Bu lông mạ kẽm M16', 'CONSUMABLE', 'Cái', 200, 3000],
];

/** [mã, tên, loại, mã cha, đơn vị, mức trọng yếu, danh sách đầu việc] */
const ASSETS = [
  ['TBA-110', 'Trạm biến áp 110kV Savina', 'PLANT', null, UNITS.vanhanh, 'CRITICAL', []],
  ['TBA-110-NGAN1', 'Ngăn lộ 110kV số 1', 'SYSTEM', 'TBA-110', UNITS.vanhanh, 'CRITICAL', []],
  [
    'MBA-T1',
    'Máy biến áp lực T1 — 40MVA',
    'EQUIPMENT',
    'TBA-110-NGAN1',
    UNITS.vanhanh,
    'CRITICAL',
    [
      { key: 'T1', name: 'Kiểm tra mức dầu và rò rỉ', durationMinutes: 20 },
      { key: 'T2', name: 'Đo điện trở cách điện cuộn dây', durationMinutes: 45 },
      { key: 'T3', name: 'Thay hạt hút ẩm silicagel', durationMinutes: 30 },
      { key: 'T4', name: 'Vệ sinh sứ đầu vào và siết lại tiếp điểm', durationMinutes: 40 },
      { key: 'T5', name: 'Lấy mẫu dầu gửi thí nghiệm', durationMinutes: 25 },
    ],
  ],
  [
    'MC-901',
    'Máy cắt 22kV lộ 901',
    'EQUIPMENT',
    'TBA-110-NGAN1',
    UNITS.vanhanh,
    'HIGH',
    [
      { key: 'M1', name: 'Đo điện trở tiếp xúc tiếp điểm chính', durationMinutes: 30 },
      { key: 'M2', name: 'Kiểm tra cơ cấu truyền động và bôi trơn', durationMinutes: 35 },
      { key: 'M3', name: 'Thử đóng cắt không tải 3 lần', durationMinutes: 20 },
    ],
  ],
  [
    'RELAY-901',
    'Tủ rơ le bảo vệ lộ 901',
    'COMPONENT',
    'MC-901',
    UNITS.kythuat,
    'HIGH',
    [
      { key: 'R1', name: 'Bơm dòng kiểm tra ngưỡng tác động', durationMinutes: 60 },
      { key: 'R2', name: 'Đối chiếu cài đặt với phiếu chỉnh định', durationMinutes: 20 },
    ],
  ],
  ['TBA-22-KCN', 'Trạm biến áp 22kV Khu công nghiệp', 'PLANT', null, UNITS.kythuat, 'HIGH', []],
  [
    'MBA-T2',
    'Máy biến áp phân phối T2 — 1000kVA',
    'EQUIPMENT',
    'TBA-22-KCN',
    UNITS.kythuat,
    'MEDIUM',
    [
      { key: 'P1', name: 'Đo tải và cân pha', durationMinutes: 30 },
      { key: 'P2', name: 'Kiểm tra nhiệt độ bằng camera nhiệt', durationMinutes: 25 },
    ],
  ],
  [
    'TN-MEGGER',
    'Thiết bị đo cách điện Megger 5kV',
    'EQUIPMENT',
    null,
    UNITS.thinghiem,
    'MEDIUM',
    [{ key: 'C1', name: 'Hiệu chuẩn định kỳ tại đơn vị được chỉ định', durationMinutes: 480 }],
  ],
];

/** Tồn đầu kỳ: [mã kho, mã vật tư, số lượng, đơn giá] */
const OPENING_STOCK = [
  ['KHO-VT', 'VT-DAU-MBA', 1250, 68000],
  ['KHO-VT', 'VT-SU-24KV', 84, 1450000],
  ['KHO-VT', 'VT-CB-630A', 6, 32500000],
  ['KHO-VT', 'VT-CAP-240', 2400, 890000],
  ['KHO-VT', 'VT-SILICA', 145, 210000],
  ['KHO-VT', 'VT-BULONG-M16', 1800, 12000],
  ['KHO-TB', 'VT-RELAY-OC', 12, 18700000],
  ['KHO-TB', 'VT-GANG-CD', 24, 2100000],
  ['KHO-DP', 'VT-SU-24KV', 30, 1450000],
  ['KHO-DP', 'VT-CAP-240', 600, 890000],
];

async function seedInventory() {
  const client = new pg.Client({ connectionString: SAVINA_DB });
  await client.connect();
  try {
    await client.query('BEGIN');

    for (const [code, name, orgUnitId, location] of WAREHOUSES) {
      await client.query(
        `INSERT INTO inventory_schema.warehouses (code, name, org_unit_id, location)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location`,
        [code, name, orgUnitId, location],
      );
    }

    for (const [code, name, category, unit, minStock, maxStock] of MATERIALS) {
      await client.query(
        `INSERT INTO inventory_schema.materials (code, name, category, unit, min_stock, max_stock)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category`,
        [code, name, category, unit, minStock, maxStock],
      );
    }

    // Hai lượt: lượt đầu tạo mọi thiết bị, lượt sau nối cha-con, để thứ tự khai
    // báo không phải là thứ tự cây.
    for (const [code, name, type, , orgUnitId, criticality, template] of ASSETS) {
      await client.query(
        `INSERT INTO inventory_schema.assets (code, name, type, org_unit_id, criticality, task_template)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name, criticality = EXCLUDED.criticality,
               task_template = EXCLUDED.task_template, updated_at = now()`,
        [code, name, type, orgUnitId, criticality, JSON.stringify(template)],
      );
    }
    for (const [code, , , parentCode] of ASSETS) {
      if (!parentCode) continue;
      await client.query(
        `UPDATE inventory_schema.assets SET parent_id = parent.id, updated_at = now()
         FROM inventory_schema.assets parent
         WHERE parent.code = $2 AND inventory_schema.assets.code = $1`,
        [code, parentCode],
      );
    }

    // Tồn đầu kỳ đi qua sổ cái: material_inventory chỉ là số dư dẫn xuất, không
    // được phép có số dư mà không có bút toán sinh ra nó.
    for (const [warehouseCode, materialCode, quantity, unitCost] of OPENING_STOCK) {
      const transactionCode = `OPEN-${warehouseCode}-${materialCode}`;
      const inserted = await client.query(
        `INSERT INTO inventory_schema.inventory_transactions
           (transaction_code, warehouse_id, material_id, type, quantity, unit_cost,
            reference_type, note, created_by)
         SELECT $1, w.id, m.id, 'IMPORT', $4, $5, 'OPENING_BALANCE',
                'Tồn đầu kỳ dữ liệu demo', '00000000-0000-4000-8000-000000000000'
         FROM inventory_schema.warehouses w, inventory_schema.materials m
         WHERE w.code = $2 AND m.code = $3
         ON CONFLICT (transaction_code) DO NOTHING
         RETURNING id`,
        [transactionCode, warehouseCode, materialCode, quantity, unitCost],
      );
      if (inserted.rowCount === 0) continue;

      await client.query(
        `INSERT INTO inventory_schema.material_inventory (warehouse_id, location_id, material_id, quantity)
         SELECT w.id, NULL, m.id, $3
         FROM inventory_schema.warehouses w, inventory_schema.materials m
         WHERE w.code = $1 AND m.code = $2
         ON CONFLICT (warehouse_id, location_id, material_id) DO UPDATE
           SET quantity = inventory_schema.material_inventory.quantity + EXCLUDED.quantity,
               updated_at = now()`,
        [warehouseCode, materialCode, quantity],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log(
    `Kho: ${WAREHOUSES.length} kho · ${MATERIALS.length} vật tư · ${ASSETS.length} thiết bị · ${OPENING_STOCK.length} dòng tồn đầu kỳ`,
  );
}

// -------------------------------------------------- Quy trình & Bảo trì

function unit(id, label) {
  return { subjectType: 'organization_unit', subjectId: id, subjectLabel: label };
}

/** Bước gọn: khoá, tên, SLA, danh sách [vai, khoá đơn vị]. */
function step(key, name, slaHours, roles, materials) {
  return {
    key,
    name,
    slaHours,
    ...(materials ? { materials } : {}),
    assignments: roles.map(([role, unitKey, label]) => ({ role, ...unit(UNITS[unitKey], label) })),
  };
}

const EXTRA_DEFINITIONS = [
  { code: 'QT-KHKD-NAM', name: 'Phê duyệt kế hoạch kinh doanh năm', kind: 'process', category: 'governance',
    steps: [
      step('LAP', 'Lập kế hoạch kinh doanh', 72, [['S','kinhdoanh','Phòng Kinh doanh']]),
      step('THAM', 'Thẩm định nguồn lực', 48, [['R','btgd','Ban Tổng Giám đốc'],['C','tuvan','Trung tâm Tư vấn']]),
      step('DUYET', 'Hội đồng Quản trị phê duyệt', 120, [['A','hdqt','Hội đồng Quản trị'],['I','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-BC-QUY', name: 'Báo cáo quản trị quý', kind: 'process', category: 'governance',
    steps: [
      step('TONGHOP', 'Tổng hợp số liệu quý', 48, [['S','taichinh','Phòng Tài chính - Kế toán']]),
      step('RASOAT', 'Ban Tổng Giám đốc rà soát', 24, [['R','btgd','Ban Tổng Giám đốc']]),
      step('THONGQUA', 'Hội đồng Quản trị thông qua', 72, [['A','hdqt','Hội đồng Quản trị']]),
    ] },
  { code: 'QT-CHU-TRUONG-DT', name: 'Phê duyệt chủ trương đầu tư', kind: 'process', category: 'governance',
    steps: [
      step('DEXUAT', 'Đề xuất chủ trương', 48, [['S','kythuat','Phòng Kỹ thuật']]),
      step('CANDOI', 'Cân đối nguồn vốn', 72, [['R','taichinh','Phòng Tài chính - Kế toán'],['C','tuvan','Trung tâm Tư vấn']]),
      step('PHEDUYET', 'Hội đồng Quản trị quyết định', 168, [['A','hdqt','Hội đồng Quản trị'],['I','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-TUYEN-DUNG', name: 'Tuyển dụng nhân sự', kind: 'process', category: 'admin_hr',
    steps: [
      step('DEXUAT', 'Đơn vị đề nghị tuyển dụng', 48, [['S','kythuat','Phòng Kỹ thuật']]),
      step('XETDUYET', 'Nhân sự rà soát định biên', 72, [['R','hanhchinh','Phòng Hành chính - Tổng hợp'],['C','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYET', 'Ban Tổng Giám đốc duyệt', 48, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-NGHI-PHEP', name: 'Đăng ký nghỉ phép', kind: 'process', category: 'admin_hr',
    steps: [
      step('DANGKY', 'Nhân viên đăng ký', 8, [['S','thinghiem','Phòng Thí nghiệm']]),
      step('XACNHAN', 'Đơn vị xác nhận bố trí người thay', 8, [['R','thinghiem','Phòng Thí nghiệm']]),
      step('DUYET', 'Hành chính duyệt và ghi nhận', 24, [['A','hanhchinh','Phòng Hành chính - Tổng hợp']]),
    ] },
  { code: 'QT-DAO-TAO', name: 'Tổ chức đào tạo nội bộ', kind: 'process', category: 'admin_hr',
    steps: [
      step('KEHOACH', 'Lập kế hoạch đào tạo', 72, [['S','hanhchinh','Phòng Hành chính - Tổng hợp']]),
      step('NOIDUNG', 'Chuyên môn duyệt nội dung', 48, [['R','kythuat','Phòng Kỹ thuật'],['C','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYET', 'Ban Tổng Giám đốc phê duyệt', 48, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-TT-NCC', name: 'Thanh toán nhà cung cấp', kind: 'process', category: 'finance',
    steps: [
      step('DENGHI', 'Đơn vị đề nghị thanh toán', 24, [['S','thinghiem','Phòng Thí nghiệm']]),
      step('KIEMTRA', 'Kế toán kiểm tra chứng từ', 48, [['R','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYETCHI', 'Ban Tổng Giám đốc duyệt chi', 48, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-TAM-UNG', name: 'Tạm ứng và hoàn ứng công tác', kind: 'process', category: 'finance',
    steps: [
      step('DENGHI', 'Đề nghị tạm ứng', 16, [['S','thinghiem','Phòng Thí nghiệm']]),
      step('XACNHAN', 'Hành chính xác nhận lịch công tác', 24, [['R','hanhchinh','Phòng Hành chính - Tổng hợp'],['C','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYET', 'Duyệt chi tạm ứng', 24, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-NGAN-SACH', name: 'Lập và duyệt ngân sách năm', kind: 'process', category: 'finance',
    steps: [
      step('LAP', 'Kế toán lập dự toán', 120, [['S','taichinh','Phòng Tài chính - Kế toán']]),
      step('RASOAT', 'Ban Tổng Giám đốc rà soát', 72, [['R','btgd','Ban Tổng Giám đốc']]),
      step('PHEDUYET', 'Hội đồng Quản trị phê duyệt', 168, [['A','hdqt','Hội đồng Quản trị']]),
    ] },
  { code: 'QT-BAO-GIA', name: 'Lập báo giá dịch vụ thí nghiệm', kind: 'process', category: 'sales_marketing',
    steps: [
      step('YEUCAU', 'Tiếp nhận yêu cầu khách hàng', 16, [['S','kinhdoanh','Phòng Kinh doanh']]),
      step('KHAOSAT', 'Thí nghiệm khảo sát khối lượng', 48, [['R','thinghiem','Phòng Thí nghiệm'],['C','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYETGIA', 'Duyệt giá và phát hành', 24, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-HD-KH', name: 'Ký hợp đồng khách hàng', kind: 'process', category: 'sales_marketing',
    steps: [
      step('SOANTHAO', 'Soạn thảo hợp đồng', 48, [['S','kinhdoanh','Phòng Kinh doanh']]),
      step('THAMDINH', 'Tư vấn và kế toán thẩm định', 72, [['R','tuvan','Trung tâm Tư vấn'],['C','taichinh','Phòng Tài chính - Kế toán']]),
      step('KYKET', 'Ban Tổng Giám đốc ký kết', 48, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-CSKH', name: 'Xử lý phản ánh khách hàng', kind: 'process', category: 'sales_marketing',
    steps: [
      step('TIEPNHAN', 'Tiếp nhận phản ánh', 8, [['S','kinhdoanh','Phòng Kinh doanh']]),
      step('XULY', 'Kỹ thuật xác minh và xử lý', 48, [['R','kythuat','Phòng Kỹ thuật']]),
      step('KETLUAN', 'Kết luận và phản hồi khách hàng', 24, [['A','btgd','Ban Tổng Giám đốc'],['I','tuvan','Trung tâm Tư vấn']]),
    ] },
  { code: 'QT-KIEM-KE', name: 'Kiểm kê kho định kỳ', kind: 'process', category: 'warehouse',
    steps: [
      step('LAPBAN', 'Lập ban kiểm kê', 24, [['S','thinghiem','Phòng Thí nghiệm']]),
      step('DOIKHOP', 'Đối khớp sổ sách và thực tế', 72, [['R','taichinh','Phòng Tài chính - Kế toán']]),
      step('DUYET', 'Duyệt kết quả kiểm kê', 48, [['A','btgd','Ban Tổng Giám đốc']]),
    ] },
  { code: 'QT-MUON-DC', name: 'Mượn và trả dụng cụ đo', kind: 'process', category: 'warehouse',
    steps: [
      step('DENGHI', 'Đề nghị mượn dụng cụ', 8, [['S','thinghiem','Phòng Thí nghiệm']],
        [{ materialCode: 'VT-GANG-CD', quantity: 2 }, { materialCode: 'VT-SU-24KV', quantity: 1 }]),
      step('CAPPHAT', 'Thủ kho cấp phát và ghi sổ', 8, [['R','hanhchinh','Phòng Hành chính - Tổng hợp']]),
      step('HOANTRA', 'Xác nhận hoàn trả', 24, [['A','kythuat','Phòng Kỹ thuật']]),
    ] },
];

const DEFINITIONS = [
  {
    code: 'QT-BT-MBA',
    category: 'technical',
    name: 'Bảo trì định kỳ máy biến áp lực',
    kind: 'maintenance_linked',
    description: 'Áp dụng cho máy biến áp 110kV, đầu việc lấy từ hồ sơ thiết bị trong Kho.',
    steps: [
      {
        key: 'B1',
        name: 'Lập phiếu công việc',
        assignments: [{ role: 'S', ...unit(UNITS.vanhanh, 'Phòng Vận hành - Bảo trì') }],
      },
      {
        key: 'B2',
        name: 'Xem xét phương án và cắt điện',
        assignments: [
          { role: 'R', ...unit(UNITS.kythuat, 'Phòng Kỹ thuật') },
          { role: 'I', ...unit(UNITS.btgd, 'Ban Tổng Giám đốc') },
        ],
      },
      {
        key: 'B3',
        name: 'Thực hiện bảo trì tại hiện trường',
        assignments: [
          {
            role: 'E',
            ...unit(UNITS.vanhanh, 'Phòng Vận hành - Bảo trì'),
            eTaskSource: 'inventory_asset',
            eTaskConfig: { assetCode: 'MBA-T1' },
          },
          { role: 'C', ...unit(UNITS.kythuat, 'Phòng Kỹ thuật'), rollbackTo: 'B2' },
        ],
      },
      {
        key: 'B4',
        name: 'Phê duyệt nghiệm thu và đóng điện',
        assignments: [{ role: 'A', ...unit(UNITS.btgd, 'Ban Tổng Giám đốc') }],
      },
    ],
  },
  {
    code: 'QT-MUA-VT',
    category: 'warehouse',
    name: 'Mua sắm vật tư kỹ thuật',
    kind: 'process',
    description: 'Từ đề nghị của đơn vị sử dụng đến duyệt chi và nhập kho.',
    steps: [
      {
        key: 'B1',
        name: 'Đề nghị mua sắm',
        assignments: [{ role: 'S', ...unit(UNITS.vanhanh, 'Phòng Vận hành - Bảo trì') }],
      },
      {
        key: 'B2',
        name: 'Thẩm định nhu cầu kỹ thuật',
        assignments: [{ role: 'R', ...unit(UNITS.kythuat, 'Phòng Kỹ thuật') }],
      },
      {
        key: 'B3',
        name: 'Kiểm soát ngân sách',
        assignments: [
          { role: 'C', ...unit(UNITS.taichinh, 'Phòng Tài chính - Kế toán'), rollbackTo: 'B1' },
        ],
      },
      {
        key: 'B4',
        name: 'Phê duyệt mua sắm',
        assignments: [
          { role: 'A', ...unit(UNITS.btgd, 'Ban Tổng Giám đốc') },
          { role: 'I', ...unit(UNITS.kinhdoanh, 'Phòng Kinh doanh') },
        ],
      },
    ],
  },
  {
    code: 'QT-TN-DINHKY',
    category: 'technical',
    name: 'Thí nghiệm định kỳ thiết bị điện',
    kind: 'process',
    description: 'Lấy mẫu, thí nghiệm và phát hành báo cáo kết quả.',
    steps: [
      {
        key: 'B1',
        name: 'Đăng ký thí nghiệm',
        assignments: [{ role: 'S', ...unit(UNITS.kythuat, 'Phòng Kỹ thuật') }],
      },
      {
        key: 'B2',
        name: 'Thực hiện đo và lập biên bản',
        assignments: [
          { role: 'R', ...unit(UNITS.thinghiem, 'Phòng Thí nghiệm') },
        ],
      },
      {
        key: 'B3',
        name: 'Kiểm soát kết quả',
        assignments: [
          { role: 'C', ...unit(UNITS.tuvan, 'Trung tâm Tư vấn'), rollbackTo: 'B2' },
        ],
      },
      {
        key: 'B4',
        name: 'Phát hành báo cáo',
        assignments: [
          { role: 'A', ...unit(UNITS.btgd, 'Ban Tổng Giám đốc') },
          { role: 'I', ...unit(UNITS.kythuat, 'Phòng Kỹ thuật') },
        ],
      },
    ],
  },
  {
    // Cố ý để nguyên bản nháp: ma trận chỉ sửa được ở trạng thái nháp, cần một
    // quy trình như vậy để demo thao tác gán vai trò.
    code: 'QT-SC-DOTXUAT',
    category: 'technical',
    name: 'Sửa chữa đột xuất sự cố lưới',
    kind: 'process',
    description: 'Bản nháp — dùng để trình diễn thao tác gán vai trò trên ma trận.',
    draft: true,
    steps: [
      {
        key: 'B1',
        name: 'Tiếp nhận báo sự cố',
        assignments: [{ role: 'S', ...unit(UNITS.vanhanh, 'Phòng Vận hành - Bảo trì') }],
      },
      { key: 'B2', name: 'Khảo sát và đánh giá hiện trường', assignments: [] },
      { key: 'B3', name: 'Khắc phục và nghiệm thu', assignments: [] },
    ],
  },
  // ---- 14 quy trình bù cho đủ 6 nhóm (thêm 20/08) --------------------------
  // Mọi vai trò gán ở CẤP ĐƠN VỊ và chỉ dùng đơn vị CÓ NHÂN SỰ. Bốn đơn vị
  // trong sơ đồ SAVINA hiện không có người nào (Phòng Vận hành - Bảo trì, Ban
  // Cố vấn, Khối Thí nghiệm, Công ty CP Năng lượng SAVINA); gán vào đó thì
  // không ai thao tác được và hồ sơ tắc ngay bước đầu.
  ...EXTRA_DEFINITIONS,
];

/** [mã thiết bị, mã quy trình hoặc null, tần suất, ưu tiên, số ngày kể từ hôm nay] */
const SCHEDULES = [
  ['MBA-T1', 'QT-BT-MBA', 'quarter', 'High', -3],
  ['MC-901', 'QT-BT-MBA', 'month', 'Normal', 5],
  ['MBA-T2', null, 'year', 'Low', 30],
  ['TN-MEGGER', 'QT-TN-DINHKY', 'year', 'Normal', 12],
];

/** [mã quy trình, tiêu đề hồ sơ] */
const INSTANCES = [
  ['QT-BT-MBA', 'Bảo trì quý III/2026 — Máy biến áp T1'],
  ['QT-MUA-VT', 'Mua bổ sung sứ cách điện 24kV cho lộ 901'],
  ['QT-MUA-VT', 'Mua dầu cách điện bù cho MBA T1'],
  ['QT-TN-DINHKY', 'Thí nghiệm định kỳ tủ rơ le lộ 901'],
];

class Session {
  constructor() {
    this.cookies = new Map();
  }

  get csrf() {
    return decodeURIComponent(this.cookies.get('ep_csrf') ?? '');
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  async call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${GATEWAY}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(method === 'GET' ? {} : { 'x-csrf-token': this.csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.absorb(response);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : undefined;
  }
}

async function seedProcedures(session) {
  const workspace = await session.call('/api/procedure/v1/workspace');
  const existing = new Map(workspace.definitions.map((item) => [item.code, item]));
  const byCode = new Map(existing);

  for (const blueprint of DEFINITIONS) {
    const known = byCode.get(blueprint.code);
    if (known && (blueprint.draft || known.status === 'published')) {
      console.log(`Quy trình ${blueprint.code}: đã có, bỏ qua`);
      continue;
    }
    if (known?.status === 'published') {
      console.log(`Quy trình ${blueprint.code}: đã công bố, bỏ qua`);
      continue;
    }

    // Vòng 1 tạo bản nháp không có C: fixedRollbackStepId phải trỏ tới id bước
    // thật, mà id chỉ tồn tại sau khi bản nháp được lưu lần đầu.
    // Bản nháp còn sót lại từ lần chạy trước được dùng lại thay vì tạo trùng mã.
    const created =
      known ??
      (await session.call('/api/procedure/v1/definitions', {
        method: 'POST',
        body: {
          code: blueprint.code,
          name: blueprint.name,
          description: blueprint.description,
          kind: blueprint.kind,
          // Bắt buộc từ 20/08: thiếu nhóm thì bước publish bên dưới sẽ bị chặn.
          category: blueprint.category,
          steps: blueprint.steps.map((step, index) => ({
            key: step.key,
            order: index + 1,
            name: step.name,
            assignments: step.assignments
              .filter((item) => item.role !== 'C')
              .map(({ rollbackTo, ...rest }) => rest),
          })),
        },
      }));

    const stepIdByKey = new Map(created.steps.map((step) => [step.key, step.id]));
    const patched = await session.call(`/api/procedure/v1/definitions/${created.id}`, {
      method: 'PATCH',
      body: {
        steps: blueprint.steps.map((step, index) => ({
          key: step.key,
          order: index + 1,
          name: step.name,
          assignments: step.assignments.map(({ rollbackTo, ...rest }) => ({
            ...rest,
            fixedRollbackStepId: rollbackTo ? stepIdByKey.get(rollbackTo) : undefined,
          })),
        })),
      },
    });

    if (blueprint.draft) {
      byCode.set(blueprint.code, patched);
      console.log(`Quy trình ${blueprint.code}: đã tạo, giữ ở trạng thái nháp`);
      continue;
    }

    const published = await session.call(
      `/api/procedure/v1/definitions/${patched.id}/publish`,
      { method: 'POST' },
    );
    byCode.set(blueprint.code, published);
    console.log(`Quy trình ${blueprint.code}: đã tạo và công bố`);
  }

  for (const [code, title] of INSTANCES) {
    const definition = byCode.get(code);
    if (!definition) continue;
    await session.call('/api/procedure/v1/instances', {
      method: 'POST',
      body: {
        definitionId: definition.id,
        title,
        idempotencyKey: `savina-demo:${code}:${title}`,
      },
    });
    console.log(`Hồ sơ: ${title}`);
  }

  return byCode;
}

async function seedMaintenance(session, definitionsByCode) {
  const workspace = await session.call('/api/maintenance/v1/workspace');
  const taken = new Set(workspace.schedules.map((item) => item.assetCode));

  for (const [assetCode, procedureCode, frequency, priority, dayOffset] of SCHEDULES) {
    if (taken.has(assetCode)) {
      console.log(`Lịch bảo trì ${assetCode}: đã có, bỏ qua`);
      continue;
    }
    const startDate = new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);
    await session.call('/api/maintenance/v1/schedules', {
      method: 'POST',
      body: {
        assetCode,
        procedureDefinitionId: procedureCode
          ? definitionsByCode.get(procedureCode)?.id
          : undefined,
        frequency,
        priority,
        startDate,
        activate: true,
      },
    });
    console.log(`Lịch bảo trì ${assetCode}: ${frequency}/${priority}, bắt đầu ${startDate}`);
  }
}

async function main() {
  await seedInventory();

  const session = new Session();
  await session.call('/api/auth/v1/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, portal: 'tenant' },
  });
  console.log(`Đăng nhập: ${ADMIN_EMAIL}`);

  const definitions = await seedProcedures(session);
  await seedMaintenance(session, definitions);
  console.log('Xong.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
