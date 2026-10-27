// Cấu hình chung cho các bước seed: URL dịch vụ, danh sách tài khoản, vai trò theo docs/crm/TEST.md mục 1.3.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

/** Nạp .env (gitignore) nếu có; biến đã đặt sẵn trong shell được giữ nguyên. */
export function loadEnv() {
  const file = resolve(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

function required(name, value) {
  if (!value) throw new Error(`Thiếu biến môi trường ${name}. Xem tools/crm/README.md.`);
  return value;
}

export function buildConfig(tenantSlug) {
  const platformApi = (process.env.SVN_SEED_PLATFORM_API_URL ?? 'http://localhost:3333/api').replace(/\/$/, '');
  return {
    tenantSlug,
    tenantName: tenantSlug === 'svn' ? 'SVN Test' : `SVN Test (${tenantSlug})`,
    emailDomain: `${tenantSlug}.local`,
    platformApi,
    inventoryApi: (process.env.INVENTORY_API_URL ?? 'http://localhost:3336/api/inventory').replace(/\/$/, ''),
    workspaceApi: (process.env.WORKSPACE_API_URL ?? 'http://localhost:3337/api/workspace').replace(/\/$/, ''),
    crmApi: (process.env.CRM_API_URL ?? 'http://localhost:3344/api/crm').replace(/\/$/, ''),
    tenantDatabase: {
      host: process.env.SVN_SEED_TENANT_DB_HOST ?? 'localhost',
      port: Number(process.env.SVN_SEED_TENANT_DB_PORT ?? 55436),
    },
    superadmin: {
      email: process.env.SVN_SEED_SUPERADMIN_EMAIL ?? 'superadmin@platform.local',
      get password() {
        return required(
          'SVN_SEED_SUPERADMIN_PASSWORD (hoặc SEED_SUPERADMIN_PASSWORD trong .env)',
          process.env.SVN_SEED_SUPERADMIN_PASSWORD ?? process.env.SEED_SUPERADMIN_PASSWORD,
        );
      },
    },
    get password() {
      const value = required('SVN_SEED_PASSWORD', process.env.SVN_SEED_PASSWORD);
      if (value.length < 6 || value.length > 128) throw new Error('SVN_SEED_PASSWORD phải dài 6 đến 128 ký tự.');
      return value;
    },
    get serviceToken() {
      return required('INTERNAL_SERVICE_TOKEN', process.env.INTERNAL_SERVICE_TOKEN);
    },
  };
}

/** Phân hệ bật cho tenant thí điểm. */
export const ENTITLEMENTS = ['crm', 'inventory', 'finance', 'procedure-engine', 'workspace', 'hrm'];

const SALES_STAFF = ['crm.read', 'crm.opportunity.write', 'crm.quote.write', 'crm.order.write'];
const TEAM_LEAD = [...SALES_STAFF, 'crm.quote.approve'];

/** Vai trò; mỗi vai trò có một Permission cùng tên (tiền tố "Quyền - "). Khớp theo tên khi chạy lại. */
export const ROLES = {
  NV_A: { name: 'BH - Nhân viên kinh doanh nhóm A', actions: SALES_STAFF },
  NV_B: { name: 'BH - Nhân viên kinh doanh nhóm B', actions: SALES_STAFF },
  TN: { name: 'BH - Trưởng nhóm kinh doanh', actions: TEAM_LEAD },
  QL: { name: 'BH - Quản lý kinh doanh', actions: [...TEAM_LEAD, 'crm.read.all', 'crm.report.read', 'inventory.read'] },
  QTBH: { name: 'BH - Quản trị bán hàng', actions: ['crm.manage', 'crm.contract.write'] },
  KTV: { name: 'BH - Kỹ thuật, CSKH', actions: ['crm.read', 'crm.read.all', 'crm.warranty.write'] },
  TK: { name: 'Kho - Thủ kho', actions: ['inventory.read', 'inventory.transaction.write', 'inventory.quality.write'] },
  QLK: { name: 'Kho - Quản lý kho', actions: ['inventory.manage', 'inventory.document.approve'] },
  KT: {
    name: 'KT - Kế toán công nợ',
    actions: ['crm.read', 'crm.read.all', 'crm.receivable.write', 'finance.read', 'finance.receipt.create'],
  },
};

/** Đơn vị trong cơ cấu tổ chức (mã node). */
export const UNITS = [
  { key: 'KD', code: 'SVN-KD', name: 'Kinh doanh' },
  { key: 'KHO', code: 'SVN-KHO', name: 'Kho' },
  { key: 'KT', code: 'SVN-KT', name: 'Kế toán' },
  { key: 'KTH', code: 'SVN-KTH', name: 'Kỹ thuật' },
];

/**
 * Chức danh: thuộc đơn vị nào, báo cáo cho chức danh nào, có phải chức danh trưởng đơn vị không.
 * Thứ tự quan trọng: chức danh cấp trên đứng trước.
 */
export const POSITIONS = [
  { key: 'QL', code: 'SVN-KD-QL', name: 'Quản lý kinh doanh', unit: 'KD', head: true },
  { key: 'TN', code: 'SVN-KD-TN', name: 'Trưởng nhóm kinh doanh A', unit: 'KD', reportsTo: 'QL' },
  { key: 'NVA', code: 'SVN-KD-NVA', name: 'Nhân viên kinh doanh nhóm A', unit: 'KD', reportsTo: 'TN' },
  { key: 'NVB', code: 'SVN-KD-NVB', name: 'Nhân viên kinh doanh nhóm B', unit: 'KD', reportsTo: 'QL' },
  { key: 'QTBH', code: 'SVN-KD-QTBH', name: 'Quản trị bán hàng', unit: 'KD' },
  { key: 'QLK', code: 'SVN-KHO-QLK', name: 'Quản lý kho', unit: 'KHO', head: true },
  { key: 'TK', code: 'SVN-KHO-TK', name: 'Thủ kho', unit: 'KHO', reportsTo: 'QLK' },
  { key: 'KT', code: 'SVN-KT-KT', name: 'Kế toán công nợ', unit: 'KT', head: true },
  { key: 'KTV', code: 'SVN-KTH-KTV', name: 'Kỹ thuật viên', unit: 'KTH', head: true },
];

/** 10 tài khoản nghiệp vụ: ký hiệu, tên, vai trò, chức danh. Email là `<ký hiệu thường>@<tenant>.local`. */
export const ACCOUNTS = [
  { code: 'NV1', fullName: 'NV1 - Nhân viên kinh doanh 1', role: 'NV_A', position: 'NVA' },
  { code: 'NV2', fullName: 'NV2 - Nhân viên kinh doanh 2', role: 'NV_A', position: 'NVA' },
  { code: 'NV3', fullName: 'NV3 - Nhân viên kinh doanh 3', role: 'NV_B', position: 'NVB' },
  { code: 'TN', fullName: 'TN - Trưởng nhóm kinh doanh A', role: 'TN', position: 'TN' },
  { code: 'QL', fullName: 'QL - Quản lý kinh doanh', role: 'QL', position: 'QL' },
  { code: 'QTBH', fullName: 'QTBH - Quản trị bán hàng', role: 'QTBH', position: 'QTBH' },
  { code: 'KTV', fullName: 'KTV - Kỹ thuật viên', role: 'KTV', position: 'KTV' },
  { code: 'TK', fullName: 'TK - Thủ kho', role: 'TK', position: 'TK' },
  { code: 'QLK', fullName: 'QLK - Quản lý kho', role: 'QLK', position: 'QLK' },
  { code: 'KT', fullName: 'KT - Kế toán công nợ', role: 'KT', position: 'KT' },
];

export const accountEmail = (config, code) => `${code.toLowerCase()}@${config.emailDomain}`;
export const adminEmail = (config) => `qtv@${config.emailDomain}`;
