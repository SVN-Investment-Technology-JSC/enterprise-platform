/**
 * Thứ tự phân hệ trong menu, theo cách dùng hằng ngày: việc ai cũng mở mỗi ngày (bảng tin, việc của tôi, hồ sơ cần
 * duyệt, công văn) rồi tới tài liệu; tiếp theo nhân sự, kinh doanh → tài chính (theo chiều tiền), cuối cùng vận hành.
 *
 * Phân hệ chưa có trong danh sách (phân hệ mới thêm) tự đứng sau các phân hệ đã xếp, theo thứ tự danh mục; không cần sửa
 * gì để nó hiện ra. Muốn đặt nó vào chỗ khác thì chèn khoá của nó vào `ORDER`.
 */
const ORDER: readonly string[] = [
  'social',
  'workspace',
  'procedure-engine',
  'procedure',
  'correspondence',
  'chat',
  'shared',
  'hrm',
  'crm',
  'finance',
  'inventory',
  'maintenance',
];

const RANK = new Map(ORDER.map((key, index) => [key, index]));

/**
 * Xếp phân hệ cho menu: phân hệ đang dùng trước, phân hệ chưa kích hoạt (hiện mờ) dồn về cuối; trong mỗi phần theo
 * `ORDER`, phân hệ chưa khai báo giữ thứ tự danh mục.
 */
export function sortForLauncher<T extends { readonly key: string; readonly entitlementStatus?: string }>(
  modules: readonly T[],
): readonly T[] {
  return modules
    .map((module, index) => ({
      module,
      inactive: module.entitlementStatus !== undefined && module.entitlementStatus !== 'active' ? 1 : 0,
      rank: RANK.get(module.key) ?? ORDER.length + index,
    }))
    .sort((a, b) => a.inactive - b.inactive || a.rank - b.rank)
    .map((entry) => entry.module);
}
