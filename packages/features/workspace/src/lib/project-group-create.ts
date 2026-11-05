import * as api from './workspace-api';

/**
 * Thêm nhóm dự án vào danh mục (cùng API với Cài đặt > Nhóm dự án) và trả tên nhóm vừa tạo, đúng như server đã
 * chuẩn hoá (cắt khoảng trắng thừa), để ô chọn chọn luôn nhóm đó. Lỗi của server (trùng tên, không đủ quyền...) ném
 * nguyên ra để ô thêm hiện ngay dưới ô nhập.
 */
export async function createProjectGroupNamed(name: string, code: string): Promise<string> {
  const list = await api.createProjectGroup({ name, code });
  const folded = name.toLocaleLowerCase('vi');
  return list.items.find((group) => group.name.toLocaleLowerCase('vi') === folded)?.name ?? name;
}
