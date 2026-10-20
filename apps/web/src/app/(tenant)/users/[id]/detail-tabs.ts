export type DetailTab = 'overview' | 'access' | 'history';

export const TAB_LABELS: Record<DetailTab, string> = {
  overview: 'Tổng quan',
  access: 'Vai trò và quyền',
  history: 'Lịch sử quyền',
};

/** Tab người xem được thấy: vai trò, quyền và lịch sử chỉ dành cho quản trị tenant. */
export function availableTabs(opts: { isAdmin: boolean }): DetailTab[] {
  return [
    'overview',
    ...(opts.isAdmin ? (['access', 'history'] as const) : []),
  ];
}

/** Tab theo `?tab=`; giá trị lạ hoặc tab không được phép thì về Tổng quan. */
export function resolveTab(
  param: string | null | undefined,
  available: readonly DetailTab[],
): DetailTab {
  return available.find((t) => t === param) ?? 'overview';
}

/** Tab được chọn sau khi bấm phím mũi tên, Home, End trên thanh tab; phím khác trả undefined. */
export function tabAfterKey(
  current: DetailTab,
  available: readonly DetailTab[],
  key: string,
): DetailTab | undefined {
  const index = available.indexOf(current);
  if (index < 0 || available.length === 0) return undefined;
  const last = available.length - 1;
  switch (key) {
    case 'ArrowRight':
      return available[index === last ? 0 : index + 1];
    case 'ArrowLeft':
      return available[index === 0 ? last : index - 1];
    case 'Home':
      return available[0];
    case 'End':
      return available[last];
    default:
      return undefined;
  }
}
