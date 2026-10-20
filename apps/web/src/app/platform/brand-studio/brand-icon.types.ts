export type ContainerShape = 'none' | 'squircle' | 'shield' | 'hexagon' | 'circle' | 'diamond';
export type ContainerFill = 'none' | 'solid' | 'gradient';
export type BrandColorKey = 'sapphire' | 'navy' | 'emerald' | 'amber' | 'crimson' | 'violet' | 'slate';

export interface BrandColorDefinition {
  name: string;
  primary: string;
  secondary: string;
  border: string;
  bgSoft: string;
}

export const BRAND_COLORS: Record<BrandColorKey, BrandColorDefinition> = {
  sapphire: {
    name: 'Xanh Sapphire (Chính)',
    primary: '#2563eb',
    secondary: '#1d4ed8',
    border: '#3b82f6',
    bgSoft: 'rgba(37, 99, 235, 0.12)',
  },
  navy: {
    name: 'Xanh Đen Doanh Nghiệp',
    primary: '#09192e',
    secondary: '#0f2942',
    border: '#1e3a5f',
    bgSoft: 'rgba(15, 41, 66, 0.2)',
  },
  emerald: {
    name: 'Xanh Ngọc (Hoạt động)',
    primary: '#10b981',
    secondary: '#059669',
    border: '#34d399',
    bgSoft: 'rgba(16, 185, 129, 0.12)',
  },
  amber: {
    name: 'Vàng Hổ Phách (Cảnh báo)',
    primary: '#f59e0b',
    secondary: '#d97706',
    border: '#fbbf24',
    bgSoft: 'rgba(245, 158, 11, 0.12)',
  },
  crimson: {
    name: 'Đỏ Thẫm (Khẩn cấp/SLA)',
    primary: '#ef4444',
    secondary: '#dc2626',
    border: '#f87171',
    bgSoft: 'rgba(239, 68, 68, 0.12)',
  },
  violet: {
    name: 'Tím Động Cơ (Quy trình)',
    primary: '#8b5cf6',
    secondary: '#7c3aed',
    border: '#a78bfa',
    bgSoft: 'rgba(139, 92, 246, 0.12)',
  },
  slate: {
    name: 'Xám Kim Loại (Trung tính)',
    primary: '#64748b',
    secondary: '#475569',
    border: '#94a3b8',
    bgSoft: 'rgba(100, 116, 139, 0.12)',
  },
};

export interface StructuredIconSpec {
  id: string;
  name: string;
  category: 'brand' | 'module';
  description: string;
  viewBoxSize: number;
  containerShape: ContainerShape;
  containerFill: ContainerFill;
  strokeWidth: number;
  colorTone: BrandColorKey;
  cornerRadius: number;
  accentDot: boolean;
  glyphPath: string;
  secondaryPath?: string;
}

export const SVNDTS_ICON_PRESETS: StructuredIconSpec[] = [
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
