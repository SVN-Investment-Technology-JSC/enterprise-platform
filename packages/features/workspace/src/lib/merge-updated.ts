/**
 * Hợp nhất kết quả sau khi sửa vào dòng đang hiện. Server bỏ hẳn trường rỗng khỏi phản hồi, nên chỉ `{ ...cũ, ...mới }`
 * giữ nguyên giá trị cũ khi người dùng vừa gỡ nó (nhóm về "Chưa phân loại", bỏ khách hàng...): trường nào patch đặt `null`
 * mà phản hồi không trả về thì phải xoá khỏi dòng.
 */
export function mergeUpdated<T extends object>(current: T, updated: Partial<T>, patch: object): T {
  const merged: Record<string, unknown> = { ...current, ...updated };
  for (const [field, value] of Object.entries(patch)) {
    if (value === null && !(field in updated)) delete merged[field];
  }
  return merged as T;
}
