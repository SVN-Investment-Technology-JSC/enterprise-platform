/**
 * Dữ liệu và kiểu của Brand Studio đời đầu (một khung + một nét chính). Giữ lại để nhập tệp sao lưu cũ,
 * chuyển icon mẫu sang mô hình nhiều lớp và làm thư viện hình mẫu.
 */

export type LegacyContainerShape = 'none' | 'squircle' | 'shield' | 'hexagon' | 'circle' | 'diamond';
export type LegacyContainerFill = 'none' | 'solid' | 'gradient';
export type LegacyColorKey = 'sapphire' | 'navy' | 'emerald' | 'amber' | 'crimson' | 'violet' | 'slate';

export interface LegacyIconSpec {
  id: string;
  name: string;
  category: 'brand' | 'module' | 'custom';
  description: string;
  viewBoxSize: number;
  containerShape: LegacyContainerShape;
  containerFill: LegacyContainerFill;
  strokeWidth: number;
  colorTone: LegacyColorKey;
  cornerRadius: number;
  accentDot: boolean;
  glyphPath: string;
  secondaryPath?: string;
  /** Tỷ lệ co hình lõi quanh tâm; bỏ trống thì tự chọn theo khung chứa. */
  glyphScale?: number;
  isCustom?: boolean;
}

export interface GlyphTemplate {
  id: string;
  name: string;
  group: 'Monogram' | 'Nghiệp vụ' | 'Hệ thống';
  path: string;
}

export const GLYPH_LIBRARY: GlyphTemplate[] = [
  {
    id: 'monogram-s',
    name: 'Monogram S (SVNDTS)',
    group: 'Monogram',
    path: 'M 16 6 L 8 6 C 6.5 6 5.5 7 5.5 8.5 C 5.5 10 6.5 11 8 11.5 L 16 13 C 17.5 13.5 18.5 14.5 18.5 16 C 18.5 17.5 17.5 18.5 16 18.5 L 8 18.5',
  },
  {
    id: 'monogram-v',
    name: 'Monogram V (Việt Nam / Velocity)',
    group: 'Monogram',
    path: 'M 6 6 L 12 18 L 18 6',
  },
  {
    id: 'monogram-n',
    name: 'Monogram N (Network)',
    group: 'Monogram',
    path: 'M 6 18 V 6 L 18 18 V 6',
  },
  {
    id: 'monogram-d',
    name: 'Monogram D (Data)',
    group: 'Monogram',
    path: 'M 7 6 H 13 C 16 6 17 8.5 17 12 C 17 15.5 16 18 13 18 H 7 Z',
  },
  {
    id: 'monogram-t',
    name: 'Monogram T (Tech)',
    group: 'Monogram',
    path: 'M 5 6 H 19 M 12 6 V 18',
  },
  {
    id: 'glyph-users',
    name: 'Nhân sự & Tổ chức',
    group: 'Nghiệp vụ',
    path: 'M 12 11 C 13.65 11 15 9.65 15 8 C 15 6.35 13.65 5 12 5 C 10.35 5 9 6.35 9 8 C 9 9.65 10.35 11 12 11 Z M 6 18.5 C 6 15.5 8.7 13.5 12 13.5 C 15.3 13.5 18 15.5 18 18.5',
  },
  {
    id: 'glyph-warehouse',
    name: 'Kho bãi & Vật tư',
    group: 'Nghiệp vụ',
    path: 'M 12 3 L 20 7.5 L 12 12 L 4 7.5 Z M 4 7.5 V 16.5 L 12 21 V 12 M 20 7.5 V 16.5 L 12 21',
  },
  {
    id: 'glyph-finance',
    name: 'Dòng tiền & Tài chính',
    group: 'Nghiệp vụ',
    path: 'M 4 19 H 20 M 7 15 V 19 M 11 11 V 19 M 15 7 V 19 M 19 4 V 19 M 6 12 L 11 8 L 15 11 L 19 6',
  },
  {
    id: 'glyph-maintenance',
    name: 'Bảo trì & Cơ khí',
    group: 'Nghiệp vụ',
    path: 'M 12 15 C 13.65 15 15 13.65 15 12 C 15 10.35 13.65 9 12 9 C 10.35 9 9 10.35 9 12 C 9 13.65 10.35 15 12 15 Z M 12 5 V 7 M 12 17 V 19 M 5 12 H 7 M 17 12 H 19 M 7.05 7.05 L 8.46 8.46 M 15.54 15.54 L 16.95 16.95 M 7.05 16.95 L 8.46 15.54 M 15.54 8.46 L 16.95 7.05',
  },
  {
    id: 'glyph-workflow',
    name: 'Quy trình & Luồng duyệt',
    group: 'Nghiệp vụ',
    path: 'M 6 9 H 10 L 14 15 H 18 M 18 12 L 18 18 M 6 6 L 6 12 M 10 9 L 8 7 M 14 15 L 16 17',
  },
  {
    id: 'glyph-contract',
    name: 'Hợp đồng & Văn bản',
    group: 'Nghiệp vụ',
    path: 'M 6 3 H 14 L 18 7 V 21 H 6 Z M 14 3 V 7 H 18 M 9 12 H 15 M 9 16 H 13',
  },
  {
    id: 'glyph-logistics',
    name: 'Vận chuyển & Giao nhận',
    group: 'Nghiệp vụ',
    path: 'M 3 7 H 14 V 17 H 3 Z M 14 10 H 18 L 21 13 V 17 H 14 M 7 19 A 2 2 0 1 0 7 15 A 2 2 0 0 0 7 19 M 17 19 A 2 2 0 1 0 17 15 A 2 2 0 0 0 17 19',
  },
  {
    id: 'glyph-security',
    name: 'Bảo mật & Phân quyền',
    group: 'Hệ thống',
    path: 'M 12 3 L 19 6 V 11 C 19 16 15.5 19.5 12 21 C 8.5 19.5 5 16 5 11 V 6 Z',
  },
  {
    id: 'glyph-server',
    name: 'Máy chủ & Database',
    group: 'Hệ thống',
    path: 'M 5 6 C 5 4.5 8.1 3.5 12 3.5 C 15.9 3.5 19 4.5 19 6 M 5 6 V 18 C 5 19.5 8.1 20.5 12 20.5 C 15.9 20.5 19 19.5 19 18 V 6 M 5 12 C 5 13.5 8.1 14.5 12 14.5 C 15.9 14.5 19 13.5 19 12',
  },
  {
    id: 'glyph-cloud',
    name: 'Điện toán Đám mây (Cloud)',
    group: 'Hệ thống',
    path: 'M 6.5 18 C 4.5 18 3 16.5 3 14.5 C 3 12.8 4.2 11.3 5.8 11.1 C 6.4 8.5 8.7 6.5 11.5 6.5 C 14.8 6.5 17.5 9 17.5 12.2 C 19 12.5 20.5 13.8 20.5 15.5 C 20.5 17.2 19.2 18 17.5 18 Z',
  },
  {
    id: 'glyph-bell',
    name: 'Thông báo & Tín hiệu',
    group: 'Hệ thống',
    path: 'M 12 4 C 9.5 4 8 6 8 9 V 14 L 6 17 H 18 L 16 14 V 9 C 16 6 14.5 4 12 4 Z M 10.5 19 C 10.5 20 11.2 20.5 12 20.5 C 12.8 20.5 13.5 20 13.5 19',
  },
  {
    id: 'glyph-workspace',
    name: 'Bàn làm việc đa nhiệm',
    group: 'Hệ thống',
    path: 'M 4 5 H 20 V 19 H 4 Z M 4 10 H 20 M 9 10 V 19',
  },
];

export const LEGACY_PRESETS: LegacyIconSpec[] = [
  {
    id: 'svndts-master',
    name: 'SVNDTS Master Logo',
    category: 'brand',
    description: 'Biểu tượng logo chính diện SVNDTS: Monogram chữ S vát cạnh hình khối công nghệ cao',
    viewBoxSize: 24,
    containerShape: 'squircle',
    containerFill: 'gradient',
    strokeWidth: 1.75,
    colorTone: 'sapphire',
    cornerRadius: 5,
    accentDot: true,
    glyphPath: 'M 16 6 L 8 6 C 6.5 6 5.5 7 5.5 8.5 C 5.5 10 6.5 11 8 11.5 L 16 13 C 17.5 13.5 18.5 14.5 18.5 16 C 18.5 17.5 17.5 18.5 16 18.5 L 8 18.5',
    secondaryPath: 'M 16 6 L 19 9 M 5 15 L 8 18.5',
  },
  {
    id: 'svndts-favicon',
    name: 'SVNDTS Favicon Tab',
    category: 'brand',
    description: 'Biểu tượng tối giản chuyên dụng cho tab trình duyệt kích thước nhỏ 16x16 / 32x32',
    viewBoxSize: 24,
    containerShape: 'squircle',
    containerFill: 'solid',
    strokeWidth: 2.25,
    colorTone: 'sapphire',
    cornerRadius: 6,
    accentDot: false,
    glyphPath: 'M 16 7 H 9 C 7.5 7 7 8 7 9 C 7 10.5 8.5 11 10 11.5 L 14 12.5 C 15.5 13 17 13.5 17 15 C 17 16.5 15.5 17.5 14 17.5 H 7',
  },
  {
    id: 'hrm-module',
    name: 'Quản trị Nhân sự (HRM)',
    category: 'module',
    description: 'Nhận diện phân hệ nhân sự: Bản sắc nhân sự cốt lõi với cấu trúc phân cấp và huy hiệu lãnh đạo',
    viewBoxSize: 24,
    containerShape: 'shield',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'sapphire',
    cornerRadius: 4,
    accentDot: false,
    glyphPath: 'M 12 11 C 13.65 11 15 9.65 15 8 C 15 6.35 13.65 5 12 5 C 10.35 5 9 6.35 9 8 C 9 9.65 10.35 11 12 11 Z M 6 18.5 C 6 15.5 8.7 13.5 12 13.5 C 15.3 13.5 18 15.5 18 18.5',
  },
  {
    id: 'inventory-module',
    name: 'Quản lý Kho vận (Inventory)',
    category: 'module',
    description: 'Nhận diện kho vật tư: Cấu trúc lập phương không gian 3D biểu trưng hàng hóa và lưu chuyển',
    viewBoxSize: 24,
    containerShape: 'squircle',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'emerald',
    cornerRadius: 4,
    accentDot: false,
    glyphPath: 'M 12 3 L 20 7.5 L 12 12 L 4 7.5 Z M 4 7.5 V 16.5 L 12 21 V 12 M 20 7.5 V 16.5 L 12 21',
  },
  {
    id: 'maintenance-module',
    name: 'Bảo trì Thiết bị (CMMS)',
    category: 'module',
    description: 'Nhận diện quản trị tài sản & bảo trì: Bánh răng cơ khí vát cạnh kỹ thuật công nghiệp',
    viewBoxSize: 24,
    containerShape: 'hexagon',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'amber',
    cornerRadius: 4,
    accentDot: false,
    glyphPath: 'M 12 15 C 13.65 15 15 13.65 15 12 C 15 10.35 13.65 9 12 9 C 10.35 9 9 10.35 9 12 C 9 13.65 10.35 15 12 15 Z M 12 5 V 7 M 12 17 V 19 M 5 12 H 7 M 17 12 H 19 M 7.05 7.05 L 8.46 8.46 M 15.54 15.54 L 16.95 16.95 M 7.05 16.95 L 8.46 15.54 M 15.54 8.46 L 16.95 7.05',
  },
  {
    id: 'finance-module',
    name: 'Tài chính Doanh nghiệp (Finance)',
    category: 'module',
    description: 'Nhận diện phân hệ dòng tiền: Biểu đồ thanh tăng trưởng kết hợp chứng từ tài chính chuẩn hóa',
    viewBoxSize: 24,
    containerShape: 'squircle',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'emerald',
    cornerRadius: 4,
    accentDot: false,
    glyphPath: 'M 4 19 H 20 M 7 15 V 19 M 11 11 V 19 M 15 7 V 19 M 19 4 V 19 M 6 12 L 11 8 L 15 11 L 19 6',
  },
  {
    id: 'procedure-module',
    name: 'Động cơ Quy trình số (Procedure)',
    category: 'module',
    description: 'Nhận diện luồng duyệt tự động: Các nút quyết định và đường kết nối luân chuyển hồ sơ',
    viewBoxSize: 24,
    containerShape: 'diamond',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'violet',
    cornerRadius: 4,
    accentDot: true,
    glyphPath: 'M 6 9 H 10 L 14 15 H 18 M 18 12 L 18 18 M 6 6 L 6 12 M 10 9 L 8 7 M 14 15 L 16 17',
  },
  {
    id: 'workspace-module',
    name: 'Không gian Làm việc (Workspace)',
    category: 'module',
    description: 'Nhận diện bàn làm việc và cộng tác đa nhiệm: Bố cục lưới điều phối công việc tập trung',
    viewBoxSize: 24,
    containerShape: 'squircle',
    containerFill: 'none',
    strokeWidth: 1.75,
    colorTone: 'sapphire',
    cornerRadius: 4,
    accentDot: false,
    glyphPath: 'M 4 5 H 20 V 19 H 4 Z M 4 10 H 20 M 9 10 V 19',
  },
];
