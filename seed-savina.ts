/**
 * Dữ liệu tổ chức của tenant SAVINA, viết theo mô hình cây node của tenant core.
 *
 * Khác với bản cũ (unit_types / units / unit_members nằm trong Platform DB), sơ
 * đồ tổ chức bây giờ nằm trong `core_schema` của database tenant và chỉ có bốn
 * bảng: `organization_trees`, `organization_node_types`, `organization_nodes` và
 * `organization_node_assignments`. Hai hệ quả chi phối toàn bộ file này:
 *
 *  1. Loại node có `category` là 'unit' hoặc 'position'. Chức danh không còn là
 *     một cột văn bản trên membership nữa mà là một NODE thật, nằm dưới đơn vị.
 *  2. `validateAssignment` chỉ cho bổ nhiệm người vào node category 'position'.
 *     Vì vậy mỗi cặp (đơn vị, chức danh) trong dữ liệu dưới đây sẽ sinh ra một
 *     node position, và người được gắn vào node đó chứ không gắn vào đơn vị.
 *
 * File này chỉ chứa dữ liệu, không gọi API. `seed-savina-demo.mjs` nạp nó bằng
 * type stripping sẵn có của Node 24+ và tự phân giải id theo code sau khi tạo.
 */

export const SAVINA = {
  slug: 'savina',
  name: 'Công ty Cổ phần Năng lượng SAVINA',
  adminEmail: 'admin@savina.local',
  adminDisplayName: 'Quản trị SAVINA',
  /** Ba tên này phải khớp cấu hình Compose; secretRef bắt buộc viết hoa. */
  databaseName: 'savina',
  databaseHost: 'tenant-db',
  databasePort: 5432,
  secretRef: 'TENANT_SAVINA_DATABASE_URL',
  /** Bốn module cần bật để dữ liệu mẫu bên dưới có schema mà ghi vào. */
  modules: ['procedure-engine', 'maintenance', 'inventory', 'crm'],
} as const;

export const SAVINA_TREE = {
  code: 'SAVINA-MAIN',
  name: 'Sơ đồ tổ chức SAVINA',
  description: 'Cây tổ chức chính, gồm SAVINA và các pháp nhân liên quan.',
} as const;

/** Node type dùng cho đơn vị. code, tên hiển thị. */
export const SAVINA_UNIT_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['COMPANY', 'Pháp nhân'],
  ['BOARD', 'Ban lãnh đạo'],
  ['DIVISION', 'Khối'],
  ['DEPARTMENT', 'Phòng ban'],
  ['CENTER', 'Trung tâm'],
  ['REPRESENTATIVE', 'Văn phòng đại diện'],
  ['SECTION', 'Bộ phận'],
];

/**
 * Node type dùng cho chức danh. Chỉ cần một loại: phân biệt cấp bậc đã nằm ở vị
 * trí của node trong cây, thêm loại chỉ để phân biệt tên gọi là dữ liệu thừa.
 */
export const SAVINA_POSITION_TYPE = ['POSITION', 'Chức danh'] as const;

/** code, tên, code loại node, code node cha (null nếu là gốc). */
export const SAVINA_UNITS: ReadonlyArray<
  readonly [string, string, string, string | null]
> = [
  // ── Pháp nhân chính ────────────────────────────────────────────────────────
  ['SAVINA', 'Công ty Cổ phần Năng lượng SAVINA', 'COMPANY', null],
  ['SAVINA-DHDCD', 'Đại hội đồng Cổ đông', 'BOARD', 'SAVINA'],
  ['SAVINA-HDQT', 'Hội đồng Quản trị', 'BOARD', 'SAVINA'],
  ['SAVINA-BTGD', 'Ban Tổng Giám đốc', 'BOARD', 'SAVINA'],
  ['SAVINA-VPDD-TN', 'Văn phòng Đại diện Tây Nguyên', 'REPRESENTATIVE', 'SAVINA'],
  ['SAVINA-VPDD-MN', 'Văn phòng Đại diện Miền Nam', 'REPRESENTATIVE', 'SAVINA'],

  ['SAVINA-KHOI-VP', 'Khối Văn phòng', 'DIVISION', 'SAVINA'],
  ['SAVINA-P-HCTH', 'Phòng Hành chính - Tổng hợp', 'DEPARTMENT', 'SAVINA-KHOI-VP'],
  ['SAVINA-P-TCKT', 'Phòng Tài chính - Kế toán', 'DEPARTMENT', 'SAVINA-KHOI-VP'],
  ['SAVINA-VP-CT', 'Văn phòng Công ty', 'DEPARTMENT', 'SAVINA-KHOI-VP'],
  ['SAVINA-P-KD', 'Phòng Kinh doanh', 'DEPARTMENT', 'SAVINA-KHOI-VP'],

  ['SAVINA-KHOI-KTDV', 'Khối Kỹ thuật - Dịch vụ', 'DIVISION', 'SAVINA'],
  ['SAVINA-P-KT', 'Phòng Kỹ thuật', 'DEPARTMENT', 'SAVINA-KHOI-KTDV'],
  ['SAVINA-TT-TV', 'Trung tâm Tư vấn', 'CENTER', 'SAVINA-KHOI-KTDV'],

  ['SAVINA-KHOI-TN', 'Khối Thí nghiệm', 'DIVISION', 'SAVINA'],
  ['SAVINA-P-TN', 'Phòng Thí nghiệm', 'DEPARTMENT', 'SAVINA-KHOI-TN'],
  ['SAVINA-P-VHBT', 'Phòng Vận hành - Bảo trì', 'DEPARTMENT', 'SAVINA-KHOI-TN'],

  // ── Các pháp nhân liên quan ────────────────────────────────────────────────
  ['TIENPHONG-DT', 'Công ty Cổ phần Đầu tư Năng lượng Tiền Phong', 'COMPANY', null],
  ['TIENPHONG-CP', 'Công ty CP Đầu tư Năng lượng Tiền Phong', 'COMPANY', null],

  ['SVN', 'Công ty Cổ phần Đầu tư và Công nghệ SVN', 'COMPANY', null],
  ['SVN-DHDCD', 'Đại hội đồng Cổ đông', 'BOARD', 'SVN'],
  ['SVN-HDQT', 'Hội đồng Quản trị', 'BOARD', 'SVN'],
  ['SVN-BTGD', 'Ban Tổng Giám đốc', 'BOARD', 'SVN'],
  ['SVN-BCV', 'Ban Cố vấn', 'BOARD', 'SVN'],

  ['SVN-P-SPKD', 'Phòng Sản phẩm và Kinh doanh', 'DEPARTMENT', 'SVN'],
  ['SVN-BP-UIUX', 'Bộ phận Thiết kế Giao diện và Trải nghiệm', 'SECTION', 'SVN-P-SPKD'],
  ['SVN-BP-MKT', 'Bộ phận Marketing', 'SECTION', 'SVN-P-SPKD'],
  ['SVN-BP-KD', 'Bộ phận Kinh doanh', 'SECTION', 'SVN-P-SPKD'],
  ['SVN-BP-SRC', 'Bộ phận Quản lý Mã nguồn', 'SECTION', 'SVN-P-SPKD'],

  ['SVN-P-KT', 'Phòng Kỹ thuật', 'DEPARTMENT', 'SVN'],
  ['SVN-BP-WEB', 'Bộ phận Phát triển Phần mềm Web', 'SECTION', 'SVN-P-KT'],
  ['SVN-BP-MOBILE', 'Bộ phận Phát triển Ứng dụng Di động', 'SECTION', 'SVN-P-KT'],
  ['SVN-BP-AI', 'Bộ phận Trí tuệ Nhân tạo', 'SECTION', 'SVN-P-KT'],
  ['SVN-BP-QA', 'Bộ phận Đảm bảo và Kiểm soát Chất lượng', 'SECTION', 'SVN-P-KT'],
  ['SVN-BP-IT', 'Bộ phận Quản trị Hệ thống và Hạ tầng CNTT', 'SECTION', 'SVN-P-KT'],

  ['SVN-P-HCNS', 'Phòng Hành chính Nhân sự', 'DEPARTMENT', 'SVN'],
  ['SVN-BP-KETOAN', 'Bộ phận Kế toán', 'SECTION', 'SVN-P-HCNS'],
  ['SVN-BP-NHANSU', 'Bộ phận Nhân sự', 'SECTION', 'SVN-P-HCNS'],
  ['SVN-BP-HANHCHINH', 'Bộ phận Hành chính', 'SECTION', 'SVN-P-HCNS'],
];

/** key, họ tên, email. Mật khẩu do script sinh, không nằm trong source. */
export const SAVINA_PEOPLE: ReadonlyArray<readonly [string, string, string]> = [
  ['hong-sang', 'Nguyễn Hồng Sang', 'nguyen.hong.sang@savina.local'],
  ['nguyen-hoang', 'Hà Nguyên Hoàng', 'ha.nguyen.hoang@savina.local'],
  ['xuan-thanh', 'Đậu Xuân Thanh', 'dau.xuan.thanh@savina.local'],
  ['duy-thuan', 'Nguyễn Duy Thuận', 'nguyen.duy.thuan@savina.local'],
  ['tan-trinh', 'Ngô Tấn Trinh', 'ngo.tan.trinh@savina.local'],

  ['hong-nhung', 'Huỳnh Thị Hồng Nhung', 'huynh.thi.hong.nhung@savina.local'],
  ['van-thin', 'Trần Văn Thìn', 'tran.van.thin@savina.local'],
  ['van-trong', 'Huỳnh Văn Trọng', 'huynh.van.trong@savina.local'],
  ['cao-vu', 'Trần Cao Vũ', 'tran.cao.vu@savina.local'],
  ['quang-binh', 'Trần Quang Bình', 'tran.quang.binh@savina.local'],

  ['vu-hau', 'Nguyễn Vũ Hậu', 'nguyen.vu.hau@savina.local'],
  ['duy-khanh', 'Bùi Duy Khánh', 'bui.duy.khanh@savina.local'],
  ['trung-kien', 'Phan Trung Kiên', 'phan.trung.kien@savina.local'],
  ['tuan-kiet', 'Võ Tuấn Kiệt', 'vo.tuan.kiet@savina.local'],
  ['minh-y', 'Nguyễn Minh Ý', 'nguyen.minh.y@savina.local'],
  ['huu-van', 'Bùi Hữu Vân', 'bui.huu.van@savina.local'],
  ['bao-vuong', 'Trương Quang Bảo Vương', 'truong.quang.bao.vuong@savina.local'],

  ['nhu-quynh', 'Nguyễn Trần Như Quỳnh', 'nguyen.tran.nhu.quynh@savina.local'],
  ['van-cuong', 'Trần Văn Cường', 'tran.van.cuong@savina.local'],
  ['thi-dong', 'Huỳnh Thị Đông', 'huynh.thi.dong@savina.local'],
  ['khanh-ngoc', 'Cao Khánh Ngọc', 'cao.khanh.ngoc@savina.local'],
  ['viet-quan', 'Phạm Việt Quân', 'pham.viet.quan@savina.local'],
  ['thi-thuy', 'Nguyễn Thị Thủy', 'nguyen.thi.thuy@savina.local'],

  ['thuy-uyen', 'Trần Thúy Uyên', 'tran.thuy.uyen@savina.local'],
  ['to-nga', 'Lê Thị Tố Nga', 'le.thi.to.nga@savina.local'],
  ['dieu-thuy', 'Phan Thị Diệu Thúy', 'phan.thi.dieu.thuy@savina.local'],
  ['to-uyen', 'Trần Thị Tố Uyên', 'tran.thi.to.uyen@savina.local'],

  ['huu-hung', 'Nguyễn Hữu Hưng', 'nguyen.huu.hung@savina.local'],
  ['diem-my', 'Nguyễn Thị Diễm My', 'nguyen.thi.diem.my@savina.local'],
  ['kim-viet', 'Huỳnh Kim Việt', 'huynh.kim.viet@savina.local'],

  ['trinh-bao', 'Đồng Trịnh Bảo', 'dong.trinh.bao@savina.local'],
  ['quang-hoang', 'Tạ Quang Hoàng', 'ta.quang.hoang@savina.local'],
  ['van-quoc', 'Trần Văn Quốc', 'tran.van.quoc@savina.local'],
  ['bao-cuong', 'Nguyễn Vũ Bảo Cường', 'nguyen.vu.bao.cuong@savina.local'],
  ['van-quy', 'Quách Văn Quý', 'quach.van.quy@savina.local'],

  ['tan-thinh', 'Nguyễn Tấn Thịnh', 'nguyen.tan.thinh@savina.local'],
  ['quoc-huy', 'Bùi Long Quốc Huy', 'bui.long.quoc.huy@savina.local'],
  ['ba-kien', 'Đậu Bá Kiên', 'dau.ba.kien@savina.local'],
  ['cong-quyen', 'Bùi Công Quyền', 'bui.cong.quyen@savina.local'],
  ['duc-thang', 'Phan Đức Thắng', 'phan.duc.thang@savina.local'],
  ['quoc-vuong', 'Trần Quốc Vương', 'tran.quoc.vuong@savina.local'],

  // Phòng Vận hành - Bảo trì: bản dữ liệu cũ để trống phòng này, nhưng ba quy
  // trình kỹ thuật lại gán vai trò cho nó. Ở mô hình mới một đơn vị không có
  // người phụ trách sẽ leo trách nhiệm LÊN cấp trên, mà cả Khối Thí nghiệm lẫn
  // node gốc SAVINA cũng không có ai, nên hồ sơ tắc ngay bước đầu. Thêm nhân sự
  // thật cho phòng này để dữ liệu demo chạy được từ đầu đến cuối.
  ['minh-tri', 'Lê Minh Trí', 'le.minh.tri@savina.local'],
  ['thanh-phong', 'Đỗ Thanh Phong', 'do.thanh.phong@savina.local'],
  ['gia-bao', 'Nguyễn Gia Bảo', 'nguyen.gia.bao@savina.local'],
];

/**
 * key người, code đơn vị, chức danh, có phải người phụ trách đơn vị không.
 *
 * Mỗi dòng sinh ra một node position tên là chức danh, nằm dưới node đơn vị, và
 * một bổ nhiệm người vào node đó. Một người xuất hiện nhiều dòng nghĩa là kiêm
 * nhiệm; khi đó chỉ MỘT dòng được đánh dấu phụ trách, vì `assign-user` coi cờ
 * này là "chức danh chính của người đó" và tự gỡ cờ ở mọi bổ nhiệm còn lại.
 */
export const SAVINA_ASSIGNMENTS: ReadonlyArray<
  readonly [string, string, string, boolean]
> = [
  // Hội đồng Quản trị & Ban Tổng Giám đốc
  ['hong-sang', 'SAVINA-HDQT', 'Chủ tịch Hội đồng Quản trị', true],
  ['nguyen-hoang', 'SAVINA-BTGD', 'Tổng Giám đốc', true],
  ['xuan-thanh', 'SAVINA-BTGD', 'Phó Tổng Giám đốc', false],
  ['duy-thuan', 'SAVINA-BTGD', 'Phó Tổng Giám đốc', false],

  // Văn phòng Đại diện Tây Nguyên
  ['duy-thuan', 'SAVINA-VPDD-TN', 'Trưởng Văn phòng Đại diện', true],
  ['hong-nhung', 'SAVINA-VPDD-TN', 'Nhân viên hành chính - văn thư', false],
  ['van-thin', 'SAVINA-VPDD-TN', 'Chuyên viên thí nghiệm', false],
  ['van-trong', 'SAVINA-VPDD-TN', 'Nhân viên thí nghiệm', false],
  ['cao-vu', 'SAVINA-VPDD-TN', 'Lễ tân VPĐD Đắk Lắk', false],
  ['quang-binh', 'SAVINA-VPDD-TN', 'Phó Trưởng phòng Thí nghiệm', false],

  // Văn phòng Đại diện Miền Nam
  ['xuan-thanh', 'SAVINA-VPDD-MN', 'Trưởng Văn phòng Đại diện', true],
  ['vu-hau', 'SAVINA-VPDD-MN', 'Nhân viên kỹ thuật', false],
  ['duy-khanh', 'SAVINA-VPDD-MN', 'Nhân viên kỹ thuật', false],
  ['trung-kien', 'SAVINA-VPDD-MN', 'Nhân viên kỹ thuật', false],
  ['tuan-kiet', 'SAVINA-VPDD-MN', 'Nhân viên kỹ thuật', false],
  ['minh-y', 'SAVINA-VPDD-MN', 'Nhân viên hành chính - văn thư', false],
  ['huu-van', 'SAVINA-VPDD-MN', 'Phó Trưởng phòng Kinh doanh', false],
  ['bao-vuong', 'SAVINA-VPDD-MN', 'Phó phòng Kỹ thuật - Dịch vụ', false],

  // Phòng Hành chính - Tổng hợp
  ['nhu-quynh', 'SAVINA-P-HCTH', 'Trưởng phòng Hành chính - Tổng hợp', true],
  ['van-cuong', 'SAVINA-P-HCTH', 'Bảo vệ', false],
  ['thi-dong', 'SAVINA-P-HCTH', 'Tạp vụ', false],
  ['khanh-ngoc', 'SAVINA-P-HCTH', 'Nhân viên marketing', false],
  ['viet-quan', 'SAVINA-P-HCTH', 'Lái xe cơ quan', false],
  ['thi-thuy', 'SAVINA-P-HCTH', 'Nhân viên hành chính - văn thư', false],

  // Phòng Tài chính - Kế toán
  ['thuy-uyen', 'SAVINA-P-TCKT', 'Kế toán trưởng', true],
  ['to-nga', 'SAVINA-P-TCKT', 'Chuyên viên tài chính', false],
  ['dieu-thuy', 'SAVINA-P-TCKT', 'Nhân viên', false],
  ['to-uyen', 'SAVINA-P-TCKT', 'Chuyên viên kế toán', false],

  // Phòng Kinh doanh
  ['huu-van', 'SAVINA-P-KD', 'Phó Trưởng phòng Kinh doanh', true],
  ['huu-hung', 'SAVINA-P-KD', 'Nhân viên kinh doanh', false],
  ['diem-my', 'SAVINA-P-KD', 'Nhân viên kinh doanh', false],
  ['kim-viet', 'SAVINA-P-KD', 'Chuyên viên kinh doanh', false],

  // Khối Kỹ thuật - Dịch vụ
  ['bao-vuong', 'SAVINA-P-KT', 'Phó phòng Kỹ thuật - Dịch vụ', true],
  ['bao-cuong', 'SAVINA-TT-TV', 'Phó Giám đốc Trung tâm', true],
  ['trinh-bao', 'SAVINA-TT-TV', 'Nhân viên tư vấn thiết kế', false],
  ['quang-hoang', 'SAVINA-TT-TV', 'Nhân viên tư vấn thiết kế', false],
  ['van-quoc', 'SAVINA-TT-TV', 'Nhân viên tư vấn thiết kế', false],
  ['van-quy', 'SAVINA-TT-TV', 'Chuyên gia kỹ thuật', false],

  // Phòng Thí nghiệm
  ['tan-thinh', 'SAVINA-P-TN', 'Trưởng phòng Thí nghiệm', true],
  ['quoc-huy', 'SAVINA-P-TN', 'Nhân viên kỹ thuật', false],
  ['ba-kien', 'SAVINA-P-TN', 'Chuyên viên thí nghiệm', false],
  ['cong-quyen', 'SAVINA-P-TN', 'Nhân viên thí nghiệm', false],
  ['duc-thang', 'SAVINA-P-TN', 'Nhân viên thí nghiệm', false],
  ['quoc-vuong', 'SAVINA-P-TN', 'Nhân viên thí nghiệm', false],

  // Phòng Vận hành - Bảo trì
  ['minh-tri', 'SAVINA-P-VHBT', 'Trưởng phòng Vận hành - Bảo trì', true],
  ['thanh-phong', 'SAVINA-P-VHBT', 'Kỹ thuật viên vận hành', false],
  ['gia-bao', 'SAVINA-P-VHBT', 'Kỹ thuật viên bảo trì', false],

  // Các pháp nhân liên quan. Cờ phụ trách để false vì hong-sang và thuy-uyen đã
  // nhận chức danh chính ở SAVINA; đánh dấu thêm ở đây sẽ gỡ mất cờ bên đó.
  ['hong-sang', 'TIENPHONG-DT', 'Tổng Giám đốc', false],
  ['thuy-uyen', 'TIENPHONG-DT', 'Kế toán trưởng', false],

  ['hong-sang', 'TIENPHONG-CP', 'Tổng Giám đốc', false],
  ['tan-trinh', 'TIENPHONG-CP', 'Phó Tổng Giám đốc', true],
  ['thuy-uyen', 'TIENPHONG-CP', 'Kế toán trưởng', false],
];

/** Bỏ dấu tiếng Việt để dựng code node từ tên chức danh. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Code của node chức danh. Duy nhất trong cây vì đã mang theo code đơn vị. */
export function savinaPositionCode(unitCode: string, title: string): string {
  return `${unitCode}--${slugify(title)}`.slice(0, 100);
}

export interface SavinaPosition {
  readonly code: string;
  readonly name: string;
  readonly unitCode: string;
}

/**
 * Danh sách node chức danh, suy ra từ bảng bổ nhiệm.
 *
 * Cố ý không viết tay: mỗi chức danh xuất hiện đúng một lần cho mỗi đơn vị, và
 * hai người cùng chức danh trong một đơn vị dùng chung một node.
 */
export const SAVINA_POSITIONS: readonly SavinaPosition[] = (() => {
  const seen = new Map<string, SavinaPosition>();
  for (const [, unitCode, title] of SAVINA_ASSIGNMENTS) {
    const code = savinaPositionCode(unitCode, title);
    if (!seen.has(code)) seen.set(code, { code, name: title, unitCode });
  }
  return [...seen.values()];
})();
