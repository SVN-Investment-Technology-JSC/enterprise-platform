/**
 * Tạo tenant SAVINA và nạp dữ liệu demo cho Kho, Quy trình và Bảo trì.
 *
 * Khác biệt so với bản cũ, do codebase đã đổi:
 *  - Tenant được tạo bằng API Platform Admin chứ không cắm sẵn UUID vào source.
 *    Mọi id (node tổ chức, người dùng, quy trình) đều phân giải theo code sau khi
 *    tạo, nên script chạy được trên bất kỳ database sạch nào.
 *  - Sơ đồ tổ chức đi theo mô hình cây node: loại node, node đơn vị, node chức
 *    danh rồi mới tới bổ nhiệm. Người chỉ gắn được vào node chức danh.
 *  - Ma trận RCSI trỏ tới node CHỨC DANH phụ trách của đơn vị, không trỏ tới node
 *    đơn vị. `membershipSubjects` chỉ chứa node mà người thực sự được bổ nhiệm,
 *    còn node đơn vị không có ai nên leo trách nhiệm lên trên và không ai khớp.
 *  - `category` là NHÓM quy trình, bắt buộc phải có mới công bố được (đổi 21/8).
 *    Đừng nhầm với `category` của loại node tổ chức ('unit' | 'position').
 *  - Vật tư và thiết bị đi qua API Kho. Chỉ kho (`warehouses`) là ghi thẳng SQL
 *    vì module Kho chưa có endpoint tạo kho.
 *
 * Chạy:
 *   node seed-savina-demo.mjs
 *
 * Biến môi trường:
 *   GATEWAY_URL                mặc định http://localhost:8080
 *   SUPERADMIN_EMAIL/PASSWORD  tài khoản Platform Admin
 *   SAVINA_ADMIN_PASSWORD      mật khẩu tenant admin sẽ tạo
 *   SAVINA_MEMBER_PASSWORD     mật khẩu dùng chung cho nhân sự demo
 *   TENANT_SAVINA_DATABASE_URL connection string database tenant (để tạo kho)
 */
import { createRequire } from 'node:module';

import {
  SAVINA,
  SAVINA_ASSIGNMENTS,
  SAVINA_PEOPLE,
  SAVINA_POSITION_TYPE,
  SAVINA_POSITIONS,
  SAVINA_TREE,
  SAVINA_UNIT_TYPES,
  SAVINA_UNITS,
  savinaPositionCode,
} from './seed-savina.ts';

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL ?? 'superadmin@platform.local';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? process.env.SEED_SUPERADMIN_PASSWORD;
const ADMIN_PASSWORD = process.env.SAVINA_ADMIN_PASSWORD ?? 'Savina-Admin-Demo-2026';
const MEMBER_PASSWORD = process.env.SAVINA_MEMBER_PASSWORD ?? 'Savina-Member-Demo-2026';
const TENANT_DB_URL =
  process.env.TENANT_SAVINA_DATABASE_URL ??
  `postgresql://tenant:tenant_local_2026@localhost:55436/${SAVINA.databaseName}`;

// ------------------------------------------------------------------ Kho

const WAREHOUSES = [
  ['KHO-VT', 'Kho Vật tư Trung tâm', 'SAVINA-P-VHBT', 'Trụ sở chính — tầng hầm B1'],
  ['KHO-TB', 'Kho Thiết bị Thí nghiệm', 'SAVINA-P-TN', 'Toà thí nghiệm — tầng 1'],
  ['KHO-DP', 'Kho Dự phòng Miền Nam', 'SAVINA-P-KT', 'Chi nhánh Miền Nam'],
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

/** [mã, tên, loại, mã cha, code đơn vị, mức trọng yếu, danh sách đầu việc] */
const ASSETS = [
  ['TBA-110', 'Trạm biến áp 110kV Savina', 'PLANT', null, 'SAVINA-P-VHBT', 'CRITICAL', []],
  ['TBA-110-NGAN1', 'Ngăn lộ 110kV số 1', 'SYSTEM', 'TBA-110', 'SAVINA-P-VHBT', 'CRITICAL', []],
  [
    'MBA-T1',
    'Máy biến áp lực T1 — 40MVA',
    'EQUIPMENT',
    'TBA-110-NGAN1',
    'SAVINA-P-VHBT',
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
    'SAVINA-P-VHBT',
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
    'SAVINA-P-KT',
    'HIGH',
    [
      { key: 'R1', name: 'Bơm dòng kiểm tra ngưỡng tác động', durationMinutes: 60 },
      { key: 'R2', name: 'Đối chiếu cài đặt với phiếu chỉnh định', durationMinutes: 20 },
    ],
  ],
  ['TBA-22-KCN', 'Trạm biến áp 22kV Khu công nghiệp', 'PLANT', null, 'SAVINA-P-KT', 'HIGH', []],
  [
    'MBA-T2',
    'Máy biến áp phân phối T2 — 1000kVA',
    'EQUIPMENT',
    'TBA-22-KCN',
    'SAVINA-P-KT',
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
    'SAVINA-P-TN',
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

// -------------------------------------------------- Quy trình & Bảo trì

/**
 * Bước gọn: khoá, tên, SLA, danh sách [vai, code đơn vị], vật tư.
 *
 * Code đơn vị được phân giải thành node CHỨC DANH PHỤ TRÁCH của đơn vị đó, vì
 * chỉ node chức danh mới có người và mới khớp `membershipSubjects`.
 */
function step(key, name, slaHours, roles, materials) {
  return {
    key,
    name,
    slaHours,
    ...(materials ? { materials } : {}),
    assignments: roles.map(([role, unitCode, extra]) => ({ role, unitCode, ...extra })),
  };
}

const DEFINITIONS = [
  {
    code: 'QT-BT-MBA',
    category: 'technical',
    name: 'Bảo trì định kỳ máy biến áp lực',
    kind: 'maintenance_linked',
    description: 'Áp dụng cho máy biến áp 110kV, đầu việc lấy từ hồ sơ thiết bị trong Kho.',
    steps: [
      step('B1', 'Lập phiếu công việc', 24, [['S', 'SAVINA-P-VHBT']]),
      step('B2', 'Xem xét phương án và cắt điện', 48, [
        ['R', 'SAVINA-P-KT'],
        ['I', 'SAVINA-BTGD'],
      ]),
      step('B3', 'Thực hiện bảo trì tại hiện trường', 72, [
        [
          'E',
          'SAVINA-P-VHBT',
          { eTaskSource: 'inventory_asset', eTaskConfig: { assetCode: 'MBA-T1' } },
        ],
        ['C', 'SAVINA-P-KT', { rollbackTo: 'B2' }],
      ]),
      step('B4', 'Phê duyệt nghiệm thu và đóng điện', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-MUA-VT',
    category: 'technical',
    name: 'Mua sắm vật tư kỹ thuật',
    kind: 'process',
    description: 'Từ đề nghị của đơn vị sử dụng đến duyệt chi và nhập kho.',
    steps: [
      step('B1', 'Đề nghị mua sắm', 24, [['S', 'SAVINA-P-VHBT']]),
      step('B2', 'Thẩm định nhu cầu kỹ thuật', 48, [['R', 'SAVINA-P-KT']]),
      step('B3', 'Kiểm soát ngân sách', 48, [['C', 'SAVINA-P-TCKT', { rollbackTo: 'B1' }]]),
      step('B4', 'Phê duyệt mua sắm', 48, [
        ['A', 'SAVINA-BTGD'],
        ['I', 'SAVINA-P-KD'],
      ]),
    ],
  },
  {
    code: 'QT-TN-DINHKY',
    category: 'technical',
    name: 'Thí nghiệm định kỳ thiết bị điện',
    kind: 'process',
    description: 'Lấy mẫu, thí nghiệm và phát hành báo cáo kết quả.',
    steps: [
      step('B1', 'Đăng ký thí nghiệm', 24, [['S', 'SAVINA-P-KT']]),
      step('B2', 'Thực hiện đo và lập biên bản', 72, [['R', 'SAVINA-P-TN']]),
      step('B3', 'Kiểm soát kết quả', 48, [['C', 'SAVINA-TT-TV', { rollbackTo: 'B2' }]]),
      step('B4', 'Phát hành báo cáo', 24, [
        ['A', 'SAVINA-BTGD'],
        ['I', 'SAVINA-P-KT'],
      ]),
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
      step('B1', 'Tiếp nhận báo sự cố', 8, [['S', 'SAVINA-P-VHBT']]),
      step('B2', 'Khảo sát và đánh giá hiện trường', 24, []),
      step('B3', 'Khắc phục và nghiệm thu', 48, []),
    ],
  },

  // ---- Quản trị ------------------------------------------------------------
  {
    code: 'QT-KHKD-NAM',
    category: 'governance',
    name: 'Phê duyệt kế hoạch kinh doanh năm',
    kind: 'process',
    steps: [
      step('LAP', 'Lập kế hoạch kinh doanh', 72, [['S', 'SAVINA-P-KD']]),
      step('THAM', 'Thẩm định nguồn lực', 48, [
        ['R', 'SAVINA-BTGD'],
        ['C', 'SAVINA-TT-TV'],
      ]),
      step('DUYET', 'Hội đồng Quản trị phê duyệt', 120, [
        ['A', 'SAVINA-HDQT'],
        ['I', 'SAVINA-BTGD'],
      ]),
    ],
  },
  {
    code: 'QT-BC-QUY',
    category: 'governance',
    name: 'Báo cáo quản trị quý',
    kind: 'process',
    steps: [
      step('TONGHOP', 'Tổng hợp số liệu quý', 48, [['S', 'SAVINA-P-TCKT']]),
      step('RASOAT', 'Ban Tổng Giám đốc rà soát', 24, [['R', 'SAVINA-BTGD']]),
      step('THONGQUA', 'Hội đồng Quản trị thông qua', 72, [['A', 'SAVINA-HDQT']]),
    ],
  },
  {
    code: 'QT-CHU-TRUONG-DT',
    category: 'governance',
    name: 'Phê duyệt chủ trương đầu tư',
    kind: 'process',
    steps: [
      step('DEXUAT', 'Đề xuất chủ trương', 48, [['S', 'SAVINA-P-KT']]),
      step('CANDOI', 'Cân đối nguồn vốn', 72, [
        ['R', 'SAVINA-P-TCKT'],
        ['C', 'SAVINA-TT-TV'],
      ]),
      step('PHEDUYET', 'Hội đồng Quản trị quyết định', 168, [
        ['A', 'SAVINA-HDQT'],
        ['I', 'SAVINA-BTGD'],
      ]),
    ],
  },

  // ---- Hành chính - nhân sự ------------------------------------------------
  {
    code: 'QT-TUYEN-DUNG',
    category: 'admin_hr',
    name: 'Tuyển dụng nhân sự',
    kind: 'process',
    steps: [
      step('DEXUAT', 'Đơn vị đề nghị tuyển dụng', 48, [['S', 'SAVINA-P-KT']]),
      step('XETDUYET', 'Nhân sự rà soát định biên', 72, [
        ['R', 'SAVINA-P-HCTH'],
        ['C', 'SAVINA-P-TCKT'],
      ]),
      step('DUYET', 'Ban Tổng Giám đốc duyệt', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-NGHI-PHEP',
    category: 'admin_hr',
    name: 'Đăng ký nghỉ phép',
    kind: 'process',
    steps: [
      step('DANGKY', 'Nhân viên đăng ký', 8, [['S', 'SAVINA-P-TN']]),
      step('XACNHAN', 'Đơn vị xác nhận bố trí người thay', 8, [['R', 'SAVINA-P-TN']]),
      step('DUYET', 'Hành chính duyệt và ghi nhận', 24, [['A', 'SAVINA-P-HCTH']]),
    ],
  },
  {
    code: 'QT-DAO-TAO',
    category: 'admin_hr',
    name: 'Tổ chức đào tạo nội bộ',
    kind: 'process',
    steps: [
      step('KEHOACH', 'Lập kế hoạch đào tạo', 72, [['S', 'SAVINA-P-HCTH']]),
      step('NOIDUNG', 'Chuyên môn duyệt nội dung', 48, [
        ['R', 'SAVINA-P-KT'],
        ['C', 'SAVINA-P-TCKT'],
      ]),
      step('DUYET', 'Ban Tổng Giám đốc phê duyệt', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },

  // ---- Tài chính -----------------------------------------------------------
  {
    code: 'QT-TT-NCC',
    category: 'finance',
    name: 'Thanh toán nhà cung cấp',
    kind: 'process',
    steps: [
      step('DENGHI', 'Đơn vị đề nghị thanh toán', 24, [['S', 'SAVINA-P-TN']]),
      step('KIEMTRA', 'Kế toán kiểm tra chứng từ', 48, [['R', 'SAVINA-P-TCKT']]),
      step('DUYETCHI', 'Ban Tổng Giám đốc duyệt chi', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-TAM-UNG',
    category: 'finance',
    name: 'Tạm ứng và hoàn ứng công tác',
    kind: 'process',
    steps: [
      step('DENGHI', 'Đề nghị tạm ứng', 16, [['S', 'SAVINA-P-TN']]),
      step('XACNHAN', 'Hành chính xác nhận lịch công tác', 24, [
        ['R', 'SAVINA-P-HCTH'],
        ['C', 'SAVINA-P-TCKT'],
      ]),
      step('DUYET', 'Duyệt chi tạm ứng', 24, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-NGAN-SACH',
    category: 'finance',
    name: 'Lập và duyệt ngân sách năm',
    kind: 'process',
    steps: [
      step('LAP', 'Kế toán lập dự toán', 120, [['S', 'SAVINA-P-TCKT']]),
      step('RASOAT', 'Ban Tổng Giám đốc rà soát', 72, [['R', 'SAVINA-BTGD']]),
      step('PHEDUYET', 'Hội đồng Quản trị phê duyệt', 168, [['A', 'SAVINA-HDQT']]),
    ],
  },

  // ---- Kinh doanh ----------------------------------------------------------
  {
    code: 'QT-BAO-GIA',
    category: 'sales_marketing',
    name: 'Lập báo giá dịch vụ thí nghiệm',
    kind: 'process',
    steps: [
      step('YEUCAU', 'Tiếp nhận yêu cầu khách hàng', 16, [['S', 'SAVINA-P-KD']]),
      step('KHAOSAT', 'Thí nghiệm khảo sát khối lượng', 48, [
        ['R', 'SAVINA-P-TN'],
        ['C', 'SAVINA-P-TCKT'],
      ]),
      step('DUYETGIA', 'Duyệt giá và phát hành', 24, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-HD-KH',
    category: 'sales_marketing',
    name: 'Ký hợp đồng khách hàng',
    kind: 'process',
    steps: [
      step('SOANTHAO', 'Soạn thảo hợp đồng', 48, [['S', 'SAVINA-P-KD']]),
      step('THAMDINH', 'Tư vấn và kế toán thẩm định', 72, [
        ['R', 'SAVINA-TT-TV'],
        ['C', 'SAVINA-P-TCKT'],
      ]),
      step('KYKET', 'Ban Tổng Giám đốc ký kết', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-CSKH',
    category: 'sales_marketing',
    name: 'Xử lý phản ánh khách hàng',
    kind: 'process',
    steps: [
      step('TIEPNHAN', 'Tiếp nhận phản ánh', 8, [['S', 'SAVINA-P-KD']]),
      step('XULY', 'Kỹ thuật xác minh và xử lý', 48, [['R', 'SAVINA-P-KT']]),
      step('KETLUAN', 'Kết luận và phản hồi khách hàng', 24, [
        ['A', 'SAVINA-BTGD'],
        ['I', 'SAVINA-TT-TV'],
      ]),
    ],
  },

  // ---- Kho -----------------------------------------------------------------
  {
    code: 'QT-KIEM-KE',
    category: 'technical',
    name: 'Kiểm kê kho định kỳ',
    kind: 'process',
    steps: [
      step('LAPBAN', 'Lập ban kiểm kê', 24, [['S', 'SAVINA-P-TN']]),
      step('DOIKHOP', 'Đối khớp sổ sách và thực tế', 72, [['R', 'SAVINA-P-TCKT']]),
      step('DUYET', 'Duyệt kết quả kiểm kê', 48, [['A', 'SAVINA-BTGD']]),
    ],
  },
  {
    code: 'QT-MUON-DC',
    category: 'technical',
    name: 'Mượn và trả dụng cụ đo',
    kind: 'process',
    steps: [
      step(
        'DENGHI',
        'Đề nghị mượn dụng cụ',
        8,
        [['S', 'SAVINA-P-TN']],
        [
          { materialCode: 'VT-GANG-CD', quantity: 2 },
          { materialCode: 'VT-SU-24KV', quantity: 1 },
        ],
      ),
      step('CAPPHAT', 'Thủ kho cấp phát và ghi sổ', 8, [['R', 'SAVINA-P-HCTH']]),
      step('HOANTRA', 'Xác nhận hoàn trả', 24, [['A', 'SAVINA-P-KT']]),
    ],
  },
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

// ------------------------------------------------------------------ HTTP

class Session {
  constructor(label) {
    this.label = label;
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

  async call(path, { method = 'GET', body, allow } = {}) {
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
      if (allow?.includes(response.status)) return undefined;
      throw new Error(`[${this.label}] ${method} ${path} → HTTP ${response.status}: ${text.slice(0, 400)}`);
    }
    return text ? JSON.parse(text) : undefined;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `pg` không được hoist lên gốc workspace. Thử lần lượt các vị trí có thể có, để
 * script chạy được cả trên host sau `pnpm install` lẫn bên trong container API.
 */
async function loadPg() {
  const require = createRequire(import.meta.url);
  const candidates = ['pg', '/app/node_modules/pg', './apps/migrator/node_modules/pg', './node_modules/pg'];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* thử vị trí kế tiếp */
    }
  }
  throw new Error(
    'Không nạp được module `pg`. Chạy script trong container API, hoặc chạy `pnpm install` trước.',
  );
}

// ---------------------------------------------------------------- Tenant

async function ensureTenant(platform) {
  const { tenants } = await platform.call('/api/platform/v1/tenants');
  const existing = tenants.find((tenant) => tenant.slug === SAVINA.slug);
  if (existing) {
    console.log(`Tenant ${SAVINA.slug}: đã có (${existing.id})`);
    return existing;
  }
  const created = await platform.call('/api/platform/v1/tenants', {
    method: 'POST',
    body: {
      slug: SAVINA.slug,
      name: SAVINA.name,
      admin: {
        email: SAVINA.adminEmail,
        displayName: SAVINA.adminDisplayName,
        initialPassword: ADMIN_PASSWORD,
      },
      database: {
        databaseName: SAVINA.databaseName,
        host: SAVINA.databaseHost,
        port: SAVINA.databasePort,
        secretRef: SAVINA.secretRef,
      },
    },
  });
  console.log(`Tenant ${SAVINA.slug}: đã tạo (${created.tenant.id})`);
  return created.tenant;
}

/**
 * Bật entitlement rồi chờ worker chạy xong migration của từng module.
 *
 * Entitlement chỉ chuyển sang `active` sau khi provisioning job hoàn tất; gọi API
 * module trước thời điểm đó sẽ nhận 403 vì schema chưa tồn tại.
 */
async function ensureModules(platform, tenantId) {
  const statuses = async () => {
    const { modules } = await platform.call(`/api/platform/v1/tenants/${tenantId}/modules`);
    return new Map(modules.map((item) => [item.key, item]));
  };

  // Bật từng module một chứ không bật cả loạt: worker xử lý các provisioning job
  // song song, và hai job cùng chạy `CREATE SCHEMA IF NOT EXISTS` trên một
  // database sẽ đụng nhau ở pg_namespace ("duplicate key ... pg_namespace_nspname_index").
  // Postgres không làm câu lệnh đó an toàn với truy cập đồng thời.
  for (const moduleKey of SAVINA.modules) {
    let current = (await statuses()).get(moduleKey);
    if (current?.entitlementStatus === 'active') {
      console.log(`Module ${moduleKey}: đã active`);
      continue;
    }
    await platform.call(`/api/platform/v1/tenants/${tenantId}/entitlements/${moduleKey}`, {
      method: 'PUT',
      body: { enabled: true },
    });

    const deadline = Date.now() + 120_000;
    for (;;) {
      await sleep(2000);
      current = (await statuses()).get(moduleKey);
      if (current?.entitlementStatus === 'active') break;
      if (current?.entitlementStatus === 'failed') {
        throw new Error(
          `Cấp phát module ${moduleKey} thất bại: ${current.latestJob?.error ?? 'không rõ lỗi'}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`Hết thời gian chờ worker cấp phát module ${moduleKey}.`);
      }
    }
    console.log(`Module ${moduleKey}: đã active`);
  }
}

// ------------------------------------------------------- Người dùng & tổ chức

async function seedUsers(tenant) {
  const { users } = await tenant.call('/api/platform/v1/tenant-users');
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  let created = 0;
  for (const [, fullName, email] of SAVINA_PEOPLE) {
    if (byEmail.has(email.toLowerCase())) continue;
    const result = await tenant.call('/api/platform/v1/tenant-users', {
      method: 'POST',
      body: { fullName, email, password: MEMBER_PASSWORD, systemRole: 'tenant-user' },
    });
    byEmail.set(email.toLowerCase(), result.user);
    created += 1;
  }
  console.log(`Người dùng: ${created} tạo mới, ${byEmail.size} tổng cộng`);
  return byEmail;
}

async function seedOrganization(tenant, usersByEmail) {
  const snapshot = await tenant.call('/api/platform/v1/tenant-organization/core-snapshot');

  // 1. Loại node. Đơn vị và chức danh khác nhau ở `category`, và chỉ node chức
  //    danh mới nhận được bổ nhiệm.
  const typeIdByCode = new Map(snapshot.nodeTypes.map((type) => [type.code, type.id]));
  const wantedTypes = [
    ...SAVINA_UNIT_TYPES.map(([code, name]) => [code, name, 'unit']),
    [SAVINA_POSITION_TYPE[0], SAVINA_POSITION_TYPE[1], 'position'],
  ];
  for (const [code, name, category] of wantedTypes) {
    if (typeIdByCode.has(code)) continue;
    const type = await tenant.call('/api/platform/v1/tenant-organization/node-types', {
      method: 'POST',
      body: { code, name, category },
    });
    typeIdByCode.set(code, type.id);
  }

  // 2. Cây tổ chức.
  let tree = snapshot.trees.find((item) => item.code === SAVINA_TREE.code);
  if (!tree) {
    tree = await tenant.call('/api/platform/v1/tenant-organization/trees', {
      method: 'POST',
      body: { ...SAVINA_TREE, isPrimary: true },
    });
  }

  // 3. Node đơn vị. Node cha phải tồn tại trước, nên đi theo lớp thay vì theo thứ
  //    tự khai báo.
  const nodeIdByCode = new Map(snapshot.nodes.map((node) => [node.code, node.id]));
  let pending = [...SAVINA_UNITS];
  while (pending.length) {
    const ready = pending.filter(([, , , parentCode]) => !parentCode || nodeIdByCode.has(parentCode));
    if (!ready.length) {
      throw new Error(
        `Không dựng được cây: thiếu node cha cho ${pending.map(([code]) => code).join(', ')}`,
      );
    }
    for (const [code, name, typeCode, parentCode] of ready) {
      if (nodeIdByCode.has(code)) continue;
      const node = await tenant.call('/api/platform/v1/tenant-organization/nodes', {
        method: 'POST',
        body: {
          treeId: tree.id,
          parentId: parentCode ? nodeIdByCode.get(parentCode) : undefined,
          nodeTypeId: typeIdByCode.get(typeCode),
          code,
          name,
        },
      });
      nodeIdByCode.set(code, node.id);
    }
    pending = pending.filter((unit) => !ready.includes(unit));
  }

  // 4. Node chức danh, nằm dưới node đơn vị tương ứng.
  for (const position of SAVINA_POSITIONS) {
    if (nodeIdByCode.has(position.code)) continue;
    const node = await tenant.call('/api/platform/v1/tenant-organization/nodes', {
      method: 'POST',
      body: {
        treeId: tree.id,
        parentId: nodeIdByCode.get(position.unitCode),
        nodeTypeId: typeIdByCode.get(SAVINA_POSITION_TYPE[0]),
        code: position.code,
        name: position.name,
      },
    });
    nodeIdByCode.set(position.code, node.id);
  }

  // 5. Bổ nhiệm.
  const emailByKey = new Map(SAVINA_PEOPLE.map(([key, , email]) => [key, email]));
  const fresh = await tenant.call('/api/platform/v1/tenant-organization/assignments');
  const taken = new Set(fresh.assignments.map((item) => `${item.nodeId}:${item.userId}`));
  let assigned = 0;
  for (const [personKey, unitCode, title, isPrimary] of SAVINA_ASSIGNMENTS) {
    const nodeId = nodeIdByCode.get(savinaPositionCode(unitCode, title));
    const user = usersByEmail.get(emailByKey.get(personKey)?.toLowerCase() ?? '');
    if (!nodeId || !user || taken.has(`${nodeId}:${user.id}`)) continue;
    await tenant.call('/api/platform/v1/tenant-organization/assignments', {
      method: 'POST',
      body: { nodeId, userId: user.id, isPrimary },
    });
    taken.add(`${nodeId}:${user.id}`);
    assigned += 1;
  }

  console.log(
    `Tổ chức: ${SAVINA_UNITS.length} đơn vị · ${SAVINA_POSITIONS.length} chức danh · ${assigned} bổ nhiệm mới`,
  );
  return nodeIdByCode;
}

/**
 * Node chức danh phụ trách của một đơn vị — đích thật sự của mọi vai trò RCSI.
 *
 * Gán thẳng vào node đơn vị sẽ không ai khớp: đơn vị không có bổ nhiệm nào nên
 * `hasHead` là false, và cơ chế leo trách nhiệm chỉ đi LÊN cấp trên chứ không
 * xuống các chức danh bên dưới.
 */
function headPositionCodeOf(unitCode) {
  const head = SAVINA_ASSIGNMENTS.find(([, code, , isPrimary]) => code === unitCode && isPrimary);
  if (!head) throw new Error(`Đơn vị ${unitCode} chưa có người phụ trách để nhận vai trò RCSI.`);
  return savinaPositionCode(unitCode, head[2]);
}

// ------------------------------------------------------------------- Kho

async function seedWarehouses(nodeIdByCode) {
  const pg = await loadPg();
  const client = new pg.Client({ connectionString: TENANT_DB_URL });
  await client.connect();
  try {
    for (const [code, name, unitCode, location] of WAREHOUSES) {
      await client.query(
        `INSERT INTO inventory_schema.warehouses (code, name, org_unit_id, location)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name, org_unit_id = EXCLUDED.org_unit_id, location = EXCLUDED.location`,
        [code, name, nodeIdByCode.get(unitCode) ?? null, location],
      );
    }
  } finally {
    await client.end();
  }
  console.log(`Kho: ${WAREHOUSES.length} kho`);
}

async function seedInventory(tenant, nodeIdByCode) {
  const materials = await tenant.call('/api/inventory/v1/materials');
  const knownMaterials = new Set((materials.materials ?? materials).map((item) => item.code));
  let newMaterials = 0;
  for (const [code, name, category, unit, minStock, maxStock] of MATERIALS) {
    if (knownMaterials.has(code)) continue;
    await tenant.call('/api/inventory/v1/materials', {
      method: 'POST',
      body: { code, name, category, unit, minStock, maxStock },
    });
    newMaterials += 1;
  }

  // Thiết bị cha phải có trước thiết bị con: API nhận `parentCode`, không nhận id.
  const assets = await tenant.call('/api/inventory/v1/assets');
  const knownAssets = new Set((assets.assets ?? assets).map((item) => item.code));
  let newAssets = 0;
  for (const [code, name, type, parentCode, unitCode, criticality, taskTemplate] of ASSETS) {
    if (knownAssets.has(code)) continue;
    await tenant.call('/api/inventory/v1/assets', {
      method: 'POST',
      body: {
        code,
        name,
        type,
        parentCode: parentCode ?? undefined,
        criticality,
        orgUnitId: nodeIdByCode.get(unitCode),
        taskTemplate,
      },
    });
    knownAssets.add(code);
    newAssets += 1;
  }

  // Tồn đầu kỳ đi qua phiếu nhập để sổ cái và số dư luôn khớp nhau. Phiếu nhập
  // không idempotent nên phải kiểm tồn trước, tránh cộng dồn khi chạy lại.
  let receipts = 0;
  for (const [warehouseCode, materialCode, quantity, unitCost] of OPENING_STOCK) {
    const stock = await tenant.call(
      `/api/inventory/v1/materials/${materialCode}/stock?warehouseCode=${warehouseCode}`,
      { allow: [404] },
    );
    if (Number(stock?.quantity ?? stock?.onHand ?? 0) > 0) continue;
    await tenant.call('/api/inventory/v1/receipts', {
      method: 'POST',
      body: {
        warehouseCode,
        materialCode,
        quantity,
        unitCost,
        referenceType: 'OPENING_BALANCE',
        note: 'Tồn đầu kỳ dữ liệu demo',
      },
    });
    receipts += 1;
  }

  console.log(
    `Kho: ${newMaterials} vật tư mới · ${newAssets} thiết bị mới · ${receipts} phiếu nhập đầu kỳ`,
  );
}

// -------------------------------------------------- Quy trình & Bảo trì

function raciAssignments(assignments, nodeIdByCode, stepIdByKey) {
  return assignments.map((assignment) => {
    const positionCode = headPositionCodeOf(assignment.unitCode);
    return {
      role: assignment.role,
      subjectType: 'organization_unit',
      subjectId: nodeIdByCode.get(positionCode),
      subjectLabel: SAVINA_POSITIONS.find((item) => item.code === positionCode)?.name,
      ...(assignment.eTaskSource ? { eTaskSource: assignment.eTaskSource } : {}),
      ...(assignment.eTaskConfig ? { eTaskConfig: assignment.eTaskConfig } : {}),
      ...(assignment.rollbackTo && stepIdByKey
        ? { fixedRollbackStepId: stepIdByKey.get(assignment.rollbackTo) }
        : {}),
    };
  });
}

/** Người giữ vai S ở bước đầu — chỉ họ mới khởi tạo được hồ sơ của quy trình đó. */
function starterEmailOf(blueprint) {
  const starter = blueprint.steps[0]?.assignments.find((item) => item.role === 'S');
  if (!starter) return undefined;
  const head = SAVINA_ASSIGNMENTS.find(
    ([, unitCode, , isPrimary]) => unitCode === starter.unitCode && isPrimary,
  );
  const person = SAVINA_PEOPLE.find(([key]) => key === head?.[0]);
  return person?.[2];
}

/**
 * Phiên đăng nhập của nhân sự, tạo theo yêu cầu.
 *
 * Tenant admin không nằm trong sơ đồ tổ chức nên không giữ vai RCSI nào; nếu
 * dùng phiên của admin để mở hồ sơ thì API trả 403 "chưa được phân vai S".
 */
const memberSessions = new Map();
async function memberSession(email) {
  const cached = memberSessions.get(email);
  if (cached) return cached;
  const session = new Session(email);
  await session.call('/api/auth/v1/login', {
    method: 'POST',
    body: { email, password: MEMBER_PASSWORD, portal: 'tenant', tenantSlug: SAVINA.slug },
  });
  memberSessions.set(email, session);
  return session;
}

async function seedProcedures(tenant, nodeIdByCode) {
  const workspace = await tenant.call('/api/procedure/v1/workspace');
  const byCode = new Map(workspace.definitions.map((item) => [item.code, item]));

  for (const blueprint of DEFINITIONS) {
    const known = byCode.get(blueprint.code);
    if (known && (blueprint.draft || known.status === 'published')) {
      console.log(`Quy trình ${blueprint.code}: đã có, bỏ qua`);
      continue;
    }

    // Vòng 1 tạo bản nháp không có C: `fixedRollbackStepId` phải trỏ tới id bước
    // thật, mà id chỉ tồn tại sau khi bản nháp được lưu lần đầu. Bản nháp còn sót
    // từ lần chạy trước được dùng lại thay vì tạo trùng mã.
    const created =
      known ??
      (await tenant.call('/api/procedure/v1/definitions', {
        method: 'POST',
        body: {
          code: blueprint.code,
          name: blueprint.name,
          description: blueprint.description,
          kind: blueprint.kind,
          // Bắt buộc từ 21/8: bản nháp không có nhóm thì không công bố được.
          category: blueprint.category,
          steps: blueprint.steps.map((step, index) => ({
            key: step.key,
            order: index + 1,
            name: step.name,
            slaHours: step.slaHours,
            ...(step.materials ? { materials: step.materials } : {}),
            assignments: raciAssignments(
              step.assignments.filter((item) => item.role !== 'C'),
              nodeIdByCode,
              null,
            ),
          })),
        },
      }));

    const stepIdByKey = new Map(created.steps.map((step) => [step.key, step.id]));
    const patched = await tenant.call(`/api/procedure/v1/definitions/${created.id}`, {
      method: 'PATCH',
      body: {
        // Gửi lại ở cả PATCH: bản nháp còn sót từ lần chạy TRƯỚC khi có luật nhóm
        // sẽ không có `category`, và nếu chỉ gán lúc tạo thì nó kẹt mãi không
        // công bố được.
        category: blueprint.category,
        steps: blueprint.steps.map((step, index) => ({
          key: step.key,
          order: index + 1,
          name: step.name,
          slaHours: step.slaHours,
          ...(step.materials ? { materials: step.materials } : {}),
          assignments: raciAssignments(step.assignments, nodeIdByCode, stepIdByKey),
        })),
      },
    });

    if (blueprint.draft) {
      byCode.set(blueprint.code, patched);
      console.log(`Quy trình ${blueprint.code}: đã tạo, giữ ở trạng thái nháp`);
      continue;
    }

    const published = await tenant.call(`/api/procedure/v1/definitions/${patched.id}/publish`, {
      method: 'POST',
    });
    byCode.set(blueprint.code, published);
    console.log(`Quy trình ${blueprint.code}: đã tạo và công bố`);
  }

  for (const [code, title] of INSTANCES) {
    const definition = byCode.get(code);
    if (!definition || definition.status !== 'published') continue;
    const email = starterEmailOf(DEFINITIONS.find((item) => item.code === code));
    if (!email) {
      console.log(`Hồ sơ ${title}: quy trình không có vai S, bỏ qua`);
      continue;
    }
    const starter = await memberSession(email);
    await starter.call('/api/procedure/v1/instances', {
      method: 'POST',
      body: { definitionId: definition.id, title, idempotencyKey: `savina-demo:${code}:${title}` },
    });
    console.log(`Hồ sơ: ${title} (mở bởi ${email})`);
  }

  return byCode;
}

async function seedMaintenance(tenant, definitionsByCode) {
  const workspace = await tenant.call('/api/maintenance/v1/workspace');
  const taken = new Set(workspace.schedules.map((item) => item.assetCode));

  for (const [assetCode, procedureCode, frequency, priority, dayOffset] of SCHEDULES) {
    if (taken.has(assetCode)) {
      console.log(`Lịch bảo trì ${assetCode}: đã có, bỏ qua`);
      continue;
    }
    const startDate = new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);
    await tenant.call('/api/maintenance/v1/schedules', {
      method: 'POST',
      body: {
        assetCode,
        procedureDefinitionId: procedureCode ? definitionsByCode.get(procedureCode)?.id : undefined,
        frequency,
        priority,
        startDate,
        activate: true,
      },
    });
    console.log(`Lịch bảo trì ${assetCode}: ${frequency}/${priority}, bắt đầu ${startDate}`);
  }
}

// ------------------------------------------------------------------ main

async function main() {
  if (!SUPERADMIN_PASSWORD) {
    throw new Error('Thiếu SUPERADMIN_PASSWORD (hoặc SEED_SUPERADMIN_PASSWORD).');
  }

  const platform = new Session('platform');
  await platform.call('/api/auth/v1/login', {
    method: 'POST',
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD, portal: 'platform' },
  });
  console.log(`Đăng nhập Platform Admin: ${SUPERADMIN_EMAIL}`);

  const tenantSummary = await ensureTenant(platform);
  await ensureModules(platform, tenantSummary.id);

  const tenant = new Session('tenant');
  await tenant.call('/api/auth/v1/login', {
    method: 'POST',
    body: {
      email: SAVINA.adminEmail,
      password: ADMIN_PASSWORD,
      portal: 'tenant',
      tenantSlug: SAVINA.slug,
    },
  });
  console.log(`Đăng nhập tenant admin: ${SAVINA.adminEmail}`);

  const usersByEmail = await seedUsers(tenant);
  const nodeIdByCode = await seedOrganization(tenant, usersByEmail);

  await seedWarehouses(nodeIdByCode);
  await seedInventory(tenant, nodeIdByCode);

  const definitions = await seedProcedures(tenant, nodeIdByCode);
  await seedMaintenance(tenant, definitions);

  console.log('Xong.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
